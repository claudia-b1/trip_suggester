import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTimeSlot } from "@/lib/slots";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await prisma.dayActivity.delete({ where: { id: Number(id) } });
  return new NextResponse(null, { status: 204 });
}

/** PATCH /api/day-activities/:id — move activity to a different day/slot */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const activityId = Number(id);
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { dayPlanId, timeSlot, order } = body;

  const data: { dayPlanId?: number; timeSlot?: string; order?: number } = {};
  if (typeof dayPlanId === "number") data.dayPlanId = dayPlanId;
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
