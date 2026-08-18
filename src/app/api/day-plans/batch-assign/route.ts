import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTimeSlot } from "@/lib/slots";

/**
 * POST /api/day-plans/batch-assign
 * Assign a POI to multiple day plans at once (used for multi-day accommodation).
 * Body: { poiId: number, dayPlanIds: number[], timeSlot: string }
 */
export async function POST(req: Request) {
  const { poiId, dayPlanIds, timeSlot } = await req.json();

  if (typeof poiId !== "number") {
    return NextResponse.json({ error: "poiId required" }, { status: 400 });
  }
  if (!Array.isArray(dayPlanIds) || dayPlanIds.length === 0) {
    return NextResponse.json({ error: "dayPlanIds required" }, { status: 400 });
  }
  if (!isTimeSlot(timeSlot)) {
    return NextResponse.json({ error: "Invalid timeSlot" }, { status: 400 });
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
