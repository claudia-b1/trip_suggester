/**
 * Auto-plan route — greedy geographic scheduler.
 *
 * Algorithm:
 *  1. Cluster POIs with coordinates geographically: seed each day from the
 *     first unclaimed POI, then greedily pull in neighbours within MAX_CLUSTER_KM.
 *  2. Distribute leftover POIs (and those without coordinates) round-robin.
 *  3. Within each day sort by category priority, then bin into MORNING /
 *     AFTERNOON / EVENING (max 2 per slot).
 *     – NIGHTLIFE  → EVENING only
 *     – FOOD       → any slot (earlier ones filled first)
 *     – Everything else → MORNING → AFTERNOON → EVENING
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { TimeSlot } from "@/lib/slots";
import { haversineKm } from "@/lib/recommendations/_shared";

const MAX_CLUSTER_KM = 5;
const MAX_PER_SLOT = 2;
const SLOTS: TimeSlot[] = ["MORNING", "AFTERNOON", "EVENING"];

type PlanPoi = {
  id: number;
  category: string;
  latitude: number | null;
  longitude: number | null;
  bestTimeToVisit: string | null;
};

type Assignment = {
  dayPlanId: number;
  poiId: number;
  timeSlot: TimeSlot;
  order: number;
};

const CATEGORY_SORT: Record<string, number> = {
  CULTURE:    0,
  NATURE:     1,
  ENTERTAINMENT: 2,
  SHOPPING:   3,
  WELLNESS:   4,
  FOOD:       5,
  NIGHTLIFE:  6,
};

function preferredSlots(poi: PlanPoi): TimeSlot[] {
  // bestTimeToVisit from the recommendation engine takes priority
  if (poi.bestTimeToVisit === "morning") return ["MORNING", "AFTERNOON", "EVENING"];
  if (poi.bestTimeToVisit === "afternoon") return ["AFTERNOON", "MORNING", "EVENING"];
  if (poi.bestTimeToVisit === "evening") return ["EVENING", "AFTERNOON", "MORNING"];
  // fallback to category heuristic
  if (poi.category === "NIGHTLIFE") return ["EVENING"];
  return ["MORNING", "AFTERNOON", "EVENING"];
}

function buildAssignments(pois: PlanPoi[], dayPlans: { id: number }[]): Assignment[] {
  const withCoords = pois.filter((p) => p.latitude != null && p.longitude != null);
  const withoutCoords = pois.filter((p) => p.latitude == null || p.longitude == null);

  const dayPoiMap = new Map<number, PlanPoi[]>(dayPlans.map((d) => [d.id, []]));
  const unclaimed = new Set(withCoords.map((p) => p.id));
  const byId = new Map(pois.map((p) => [p.id, p]));
  const maxPerDay = MAX_PER_SLOT * SLOTS.length;

  // Geographic clustering: seed each day, pull in nearby POIs
  for (const day of dayPlans) {
    if (unclaimed.size === 0) break;
    const dayPois = dayPoiMap.get(day.id)!;

    const seedId = unclaimed.values().next().value as number;
    const seed = byId.get(seedId)!;
    unclaimed.delete(seedId);
    dayPois.push(seed);

    for (const id of Array.from(unclaimed)) {
      if (dayPois.length >= maxPerDay) break;
      const p = byId.get(id)!;
      const dist = haversineKm(seed.latitude!, seed.longitude!, p.latitude!, p.longitude!);
      if (dist <= MAX_CLUSTER_KM) {
        dayPois.push(p);
        unclaimed.delete(id);
      }
    }
  }

  // Round-robin for leftovers and POIs without coordinates
  const leftover = [
    ...Array.from(unclaimed).map((id) => byId.get(id)!),
    ...withoutCoords,
  ];
  leftover.forEach((p, i) => {
    const day = dayPlans[i % dayPlans.length];
    const dayPois = dayPoiMap.get(day.id)!;
    if (dayPois.length < maxPerDay) dayPois.push(p);
  });

  // Assign time slots within each day
  const result: Assignment[] = [];
  for (const day of dayPlans) {
    const dayPois = dayPoiMap.get(day.id)!;
    dayPois.sort(
      (a, b) => (CATEGORY_SORT[a.category] ?? 9) - (CATEGORY_SORT[b.category] ?? 9),
    );
    const slotCounts: Record<TimeSlot, number> = { MORNING: 0, AFTERNOON: 0, EVENING: 0 };
    for (const poi of dayPois) {
      const slot = preferredSlots(poi).find((s) => slotCounts[s] < MAX_PER_SLOT);
      if (!slot) continue;
      result.push({ dayPlanId: day.id, poiId: poi.id, timeSlot: slot, order: slotCounts[slot] });
      slotCounts[slot]++;
    }
  }
  return result;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const { cityId } = await params;
  const cityIdNum = Number(cityId);

  // Optional: only plan specific days
  let selectedDayPlanIds: number[] | null = null;
  try {
    const body = await req.json();
    if (Array.isArray(body.dayPlanIds) && body.dayPlanIds.length > 0) {
      selectedDayPlanIds = body.dayPlanIds.map(Number).filter(Number.isInteger);
    }
  } catch {
    // no body = plan all days
  }

  const city = await prisma.city.findUnique({
    where: { id: cityIdNum },
    include: {
      pois: true,
      dayPlans: { orderBy: { date: "asc" } },
    },
  });
  if (!city) {
    return NextResponse.json({ error: "City not found" }, { status: 404 });
  }
  if (city.pois.length === 0) {
    return NextResponse.json({ error: "No POIs to plan" }, { status: 400 });
  }
  if (city.dayPlans.length === 0) {
    return NextResponse.json({ error: "No day plans" }, { status: 400 });
  }

  const targetDayPlans = selectedDayPlanIds
    ? city.dayPlans.filter((d) => selectedDayPlanIds!.includes(d.id))
    : city.dayPlans;

  if (targetDayPlans.length === 0) {
    return NextResponse.json({ error: "No matching day plans" }, { status: 400 });
  }

  const assignments = buildAssignments(city.pois, targetDayPlans);

  const dayPlanIds = targetDayPlans.map((d) => d.id);
  await prisma.$transaction([
    prisma.dayActivity.deleteMany({ where: { dayPlanId: { in: dayPlanIds } } }),
    ...assignments.map((a) =>
      prisma.dayActivity.create({
        data: {
          dayPlanId: a.dayPlanId,
          poiId: a.poiId,
          timeSlot: a.timeSlot,
          order: a.order,
        },
      }),
    ),
  ]);

  return NextResponse.json({
    ok: true,
    assigned: assignments.length,
    skipped: city.pois.length - assignments.length,
  });
}
