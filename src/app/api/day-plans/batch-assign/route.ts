import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTimeSlot } from "@/lib/slots";
import { batchAssignSchema, parseBody } from "@/lib/api-schemas";
import { getActiveUserId } from "@/lib/active-user";
import { verifyPoiOwnership } from "@/lib/ownership";

/**
 * POST /api/day-plans/batch-assign
 * Assign a POI to multiple day plans at once (used for multi-day accommodation).
 * Body: { poiId: number, dayPlanIds: number[], timeSlot: string }
 */
export async function POST(req: Request) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const raw = await req.json();
  const parsed = parseBody(batchAssignSchema, raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { poiId, dayPlanIds, timeSlot } = parsed.data;

  if (!isTimeSlot(timeSlot)) {
    return NextResponse.json({ error: "Invalid timeSlot" }, { status: 400 });
  }

  if (!await verifyPoiOwnership(poiId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Check every target day plan in one query rather than per-iteration, then
  // reject the whole request if any belongs to someone else — a partial write
  // would be harder to reason about than an outright rejection.
  const ownedCount = await prisma.dayPlan.count({
    where: { id: { in: dayPlanIds }, city: { trip: { userId } } },
  });
  if (ownedCount !== dayPlanIds.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const results = [];
  for (const dayPlanId of dayPlanIds) {
    // Skip if already assigned to this day plan
    const existing = await prisma.dayActivity.findFirst({
      where: { dayPlanId, poiId },
    });
    if (existing) continue;

    const last = await prisma.dayActivity.findFirst({
      where: { dayPlanId, timeSlot },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const nextOrder = last ? last.order + 1 : 0;

    const activity = await prisma.dayActivity.create({
      data: { dayPlanId, poiId, timeSlot, order: nextOrder },
    });
    results.push(activity);
  }

  return NextResponse.json({ created: results.length }, { status: 201 });
}
