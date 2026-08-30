import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";

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

  const { name, startDate, endDate } = await req.json();
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
