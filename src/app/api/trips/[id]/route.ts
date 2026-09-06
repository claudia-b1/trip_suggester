import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyTripOwnership } from "@/lib/ownership";
import { updateTripSchema, parseBody } from "@/lib/api-schemas";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  const tripId = Number(id);
  if (!await verifyTripOwnership(tripId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(trip);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  const tripId = Number(id);
  if (!Number.isInteger(tripId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  if (!await verifyTripOwnership(tripId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await req.json();
  const parsed = parseBody(updateTripSchema, raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const body = parsed.data;
  const data: Record<string, unknown> = {};
  if (body.name) data.name = body.name.trim();
  if (body.startDate) data.startDate = new Date(body.startDate);
  if (body.endDate) data.endDate = new Date(body.endDate);
  if (body.archived !== undefined) data.archived = body.archived;
  if (body.coverImage !== undefined) data.coverImage = body.coverImage;
  const trip = await prisma.trip.update({ where: { id: tripId }, data });
  return NextResponse.json(trip);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  const tripId = Number(id);
  if (!await verifyTripOwnership(tripId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.trip.delete({ where: { id: tripId } });
  return new NextResponse(null, { status: 204 });
}
