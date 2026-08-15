import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTimeSlot } from "@/lib/slots";

/** DELETE /api/day-plans/:id/activities — remove all activities for this day plan */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await prisma.dayActivity.deleteMany({ where: { dayPlanId: Number(id) } });
  return new NextResponse(null, { status: 204 });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const dayPlanId = Number(id);
  const { poiId, timeSlot } = await req.json();

  if (!isTimeSlot(timeSlot)) {
    return NextResponse.json({ error: "Invalid timeSlot" }, { status: 400 });
  }
  if (typeof poiId !== "number") {
    return NextResponse.json({ error: "poiId required" }, { status: 400 });
  }

  const last = await prisma.dayActivity.findFirst({
    where: { dayPlanId, timeSlot },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const nextOrder = last ? last.order + 1 : 0;

  const activity = await prisma.dayActivity.create({
    data: { dayPlanId, poiId, timeSlot, order: nextOrder },
  });
  return NextResponse.json(activity, { status: 201 });
}
