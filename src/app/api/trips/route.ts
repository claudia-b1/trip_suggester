import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const trips = await prisma.trip.findMany({ orderBy: { startDate: "asc" } });
  return NextResponse.json(trips);
}

export async function POST(req: Request) {
  const { name, startDate, endDate } = await req.json();
  const trip = await prisma.trip.create({
    data: {
      name,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    },
  });
  return NextResponse.json(trip, { status: 201 });
}
