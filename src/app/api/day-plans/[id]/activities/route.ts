import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isTimeSlot } from "@/lib/slots";
import { createActivitySchema, parseBody } from "@/lib/api-schemas";
import { getActiveUserId } from "@/lib/active-user";
import { verifyDayPlanOwnership, verifyPoiOwnership } from "@/lib/ownership";

/** DELETE /api/day-plans/:id/activities — remove all activities for this day plan */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  if (!await verifyDayPlanOwnership(Number(id), userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.dayActivity.deleteMany({ where: { dayPlanId: Number(id) } });
  return new NextResponse(null, { status: 204 });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  const dayPlanId = Number(id);
  if (!await verifyDayPlanOwnership(dayPlanId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await req.json();
  const parsed = parseBody(createActivitySchema, raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { poiId, timeSlot } = parsed.data;
  if (!isTimeSlot(timeSlot)) {
    return NextResponse.json({ error: "Invalid timeSlot" }, { status: 400 });
  }

  // The POI is a separate id from the body — check it independently.
  if (!await verifyPoiOwnership(poiId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
