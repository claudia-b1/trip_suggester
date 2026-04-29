import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { isTimeSlot, type TimeSlot } from "@/lib/slots";

const TOOL: Anthropic.Tool = {
  name: "create_daily_plan",
  description:
    "Distribute the given POIs across the given day plans with time slots. Each POI must be assigned exactly once.",
  input_schema: {
    type: "object",
    properties: {
      assignments: {
        type: "array",
        description: "One entry per POI. Every POI from the input must appear exactly once.",
        items: {
          type: "object",
          properties: {
            dayPlanId: {
              type: "integer",
              description: "The id of a dayPlan from the input.",
            },
            poiId: {
              type: "integer",
              description: "The id of a POI from the input.",
            },
            timeSlot: {
              type: "string",
              enum: ["MORNING", "AFTERNOON", "EVENING"],
            },
            order: {
              type: "integer",
              description:
                "Zero-based position within the (dayPlanId, timeSlot) bucket.",
            },
          },
          required: ["dayPlanId", "poiId", "timeSlot", "order"],
        },
      },
    },
    required: ["assignments"],
  },
};

const SYSTEM = `You are a trip planner. Given the POIs in one city and the day plans for the visit, distribute the POIs across days and time slots (MORNING / AFTERNOON / EVENING).

Rules:
- Assign every POI exactly once.
- Group geographically nearby POIs (close lat/lng) on the same day to reduce travel.
- Mix POI categories within a single day when possible.
- Place at most 2 POIs per (day, time slot).
- Prefer FOOD POIs around mealtimes when reasonable.
- Place NIGHTLIFE POIs in EVENING.
- 'order' is the position within (dayPlanId, timeSlot), starting at 0.

Return your plan via the create_daily_plan tool.`;

type Assignment = {
  dayPlanId: number;
  poiId: number;
  timeSlot: TimeSlot;
  order: number;
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set" },
      { status: 503 },
    );
  }

  const { cityId } = await params;
  const cityIdNum = Number(cityId);

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

  const userPayload = {
    pois: city.pois.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      latitude: p.latitude,
      longitude: p.longitude,
    })),
    dayPlans: city.dayPlans.map((d, idx) => ({
      id: d.id,
      day: idx + 1,
      date: d.date.toISOString().slice(0, 10),
    })),
  };

  const anthropic = new Anthropic({ apiKey });

  let response;
  try {
    response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "create_daily_plan" },
      messages: [{ role: "user", content: JSON.stringify(userPayload) }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Anthropic API error: ${err.message}` },
        { status: 502 },
      );
    }
    throw err;
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json(
      { error: "Model did not return a tool_use block" },
      { status: 502 },
    );
  }

  const input = toolUse.input as { assignments?: unknown };
  if (!Array.isArray(input.assignments)) {
    return NextResponse.json(
      { error: "Model returned malformed assignments" },
      { status: 502 },
    );
  }

  const validDayPlanIds = new Set(city.dayPlans.map((d) => d.id));
  const validPoiIds = new Set(city.pois.map((p) => p.id));
  const seenPoiIds = new Set<number>();
  const assignments: Assignment[] = [];

  for (const raw of input.assignments) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      typeof (raw as { dayPlanId?: unknown }).dayPlanId !== "number" ||
      typeof (raw as { poiId?: unknown }).poiId !== "number" ||
      typeof (raw as { order?: unknown }).order !== "number" ||
      !isTimeSlot((raw as { timeSlot?: unknown }).timeSlot)
    ) {
      return NextResponse.json(
        { error: "Malformed assignment in model output" },
        { status: 502 },
      );
    }
    const a = raw as Assignment;
    if (!validDayPlanIds.has(a.dayPlanId)) {
      return NextResponse.json(
        { error: `Unknown dayPlanId ${a.dayPlanId}` },
        { status: 502 },
      );
    }
    if (!validPoiIds.has(a.poiId)) {
      return NextResponse.json(
        { error: `Unknown poiId ${a.poiId}` },
        { status: 502 },
      );
    }
    if (seenPoiIds.has(a.poiId)) {
      return NextResponse.json(
        { error: `Duplicate assignment for poiId ${a.poiId}` },
        { status: 502 },
      );
    }
    seenPoiIds.add(a.poiId);
    assignments.push(a);
  }

  const dayPlanIds = city.dayPlans.map((d) => d.id);
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
