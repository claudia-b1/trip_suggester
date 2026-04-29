import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cities = await prisma.city.findMany({
    where: { tripId: Number(id) },
    orderBy: { order: "asc" },
  });
  return NextResponse.json(cities);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tripId = Number(id);
  const { name, startDate, endDate } = await req.json();

  const last = await prisma.city.findFirst({
    where: { tripId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const nextOrder = last ? last.order + 1 : 0;

  const city = await prisma.city.create({
    data: {
      name,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      order: nextOrder,
      tripId,
    },
  });
  return NextResponse.json(city, { status: 201 });
}
