import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTimeSlot } from "@/lib/slots";
import { getActiveUserId } from "@/lib/active-user";
import { verifyDayActivityOwnership, verifyDayPlanOwnership } from "@/lib/ownership";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  if (!await verifyDayActivityOwnership(Number(id), userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.dayActivity.delete({ where: { id: Number(id) } });
  return new NextResponse(null, { status: 204 });
}

/** PATCH /api/day-activities/:id — move activity to a different day/slot */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  const activityId = Number(id);
  if (!await verifyDayActivityOwnership(activityId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { dayPlanId, timeSlot, order } = body;

  const data: { dayPlanId?: number; timeSlot?: string; order?: number } = {};
  if (typeof dayPlanId === "number") {
    // Owning the activity isn't enough — the destination day plan must be the
    // user's too, or this becomes a way to move items into someone else's trip.
    if (!await verifyDayPlanOwnership(dayPlanId, userId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    data.dayPlanId = dayPlanId;
  }
  if (typeof timeSlot === "string" && isTimeSlot(timeSlot)) data.timeSlot = timeSlot;
  if (typeof order === "number") data.order = order;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // If moving to a new slot, append at end
  if (data.dayPlanId || data.timeSlot) {
    const targetDayPlanId = data.dayPlanId ?? (await prisma.dayActivity.findUnique({ where: { id: activityId }, select: { dayPlanId: true } }))?.dayPlanId;
    const targetSlot = data.timeSlot ?? (await prisma.dayActivity.findUnique({ where: { id: activityId }, select: { timeSlot: true } }))?.timeSlot;
    if (targetDayPlanId && targetSlot) {
      const last = await prisma.dayActivity.findFirst({
        where: { dayPlanId: targetDayPlanId, timeSlot: targetSlot, id: { not: activityId } },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      if (data.order == null) data.order = last ? last.order + 1 : 0;
    }
  }

  const updated = await prisma.dayActivity.update({
    where: { id: activityId },
    data,
  });
  return NextResponse.json(updated);
}
