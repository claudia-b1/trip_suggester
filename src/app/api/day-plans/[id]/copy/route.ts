import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/day-plans/:id/copy
 * Move activities from this day plan to a target day plan.
 * Body: { targetDayPlanId: number, mode: "replace" | "merge" }
 * - Accommodation activities (category ACCOMMODATION) are excluded from the move.
 * - "replace" deletes non-accommodation activities on the target first, then moves.
 * - "merge" appends moved activities to whatever is already there.
 * - Source activities are always deleted after being moved.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sourceDayPlanId = Number(id);
  const { targetDayPlanId, mode } = await req.json();

  if (typeof targetDayPlanId !== "number") {
    return NextResponse.json({ error: "targetDayPlanId required" }, { status: 400 });
  }
  if (mode !== "replace" && mode !== "merge") {
    return NextResponse.json({ error: "mode must be 'replace' or 'merge'" }, { status: 400 });
  }
  if (sourceDayPlanId === targetDayPlanId) {
    return NextResponse.json({ error: "Cannot move to the same day" }, { status: 400 });
  }

  // Verify both day plans exist
  const [source, target] = await Promise.all([
    prisma.dayPlan.findUnique({ where: { id: sourceDayPlanId } }),
    prisma.dayPlan.findUnique({ where: { id: targetDayPlanId } }),
  ]);
  if (!source || !target) {
    return NextResponse.json({ error: "Day plan not found" }, { status: 404 });
  }

  // Get source activities, excluding accommodation
  const sourceActivities = await prisma.dayActivity.findMany({
    where: { dayPlanId: sourceDayPlanId },
    include: { poi: { select: { category: true } } },
    orderBy: [{ timeSlot: "asc" }, { order: "asc" }],
  });
  const toCopy = sourceActivities.filter((a) => a.poi.category !== "ACCOMMODATION");

  if (toCopy.length === 0) {
    return NextResponse.json({ moved: 0 });
  }

  await prisma.$transaction(async (tx) => {
    if (mode === "replace") {
      // Delete non-accommodation activities on the target day
      const targetActivities = await tx.dayActivity.findMany({
        where: { dayPlanId: targetDayPlanId },
        include: { poi: { select: { category: true } } },
      });
      const toDelete = targetActivities
        .filter((a) => a.poi.category !== "ACCOMMODATION")
        .map((a) => a.id);
      if (toDelete.length > 0) {
        await tx.dayActivity.deleteMany({ where: { id: { in: toDelete } } });
      }
    }

    // Calculate order offsets per slot for merge mode
    const offsets: Record<string, number> = {};
    if (mode === "merge") {
      const existing = await tx.dayActivity.findMany({
        where: { dayPlanId: targetDayPlanId },
        select: { timeSlot: true, order: true },
      });
      for (const act of existing) {
        const cur = offsets[act.timeSlot] ?? -1;
        if (act.order > cur) offsets[act.timeSlot] = act.order;
      }
    }

    // Create activities on the target day
    for (const act of toCopy) {
      const offset = mode === "merge" ? (offsets[act.timeSlot] ?? -1) + 1 : 0;
      await tx.dayActivity.create({
        data: {
          dayPlanId: targetDayPlanId,
          poiId: act.poiId,
          timeSlot: act.timeSlot,
          order: act.order + offset,
        },
      });
    }

    // Delete source activities (move = copy + delete from source)
    await tx.dayActivity.deleteMany({
      where: { id: { in: toCopy.map((a) => a.id) } },
    });
  });

  return NextResponse.json({ moved: toCopy.length });
}
