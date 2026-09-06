import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { createTripSchema, parseBody } from "@/lib/api-schemas";

export async function GET() {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const trips = await prisma.trip.findMany({
    where: { userId },
    orderBy: { startDate: "asc" },
  });
  return NextResponse.json(trips);
}

export async function POST(req: Request) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const raw = await req.json();
  const parsed = parseBody(createTripSchema, raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { name, startDate, endDate } = parsed.data;
  const trip = await prisma.trip.create({
    data: {
      name,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      userId,
    },
  });
  return NextResponse.json(trip, { status: 201 });
}
