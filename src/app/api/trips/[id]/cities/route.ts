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
    include: {
      subcities: { orderBy: { order: "asc" } },
    },
  });
  return NextResponse.json(cities);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tripId = Number(id);
  const { name, nickname, startDate, endDate, country, countryCode, latitude, longitude, timezone, parentCityId } = await req.json();

  // Validate parentCityId if provided
  if (parentCityId != null) {
    const parent = await prisma.city.findUnique({
      where: { id: parentCityId },
      select: { tripId: true, parentCityId: true },
    });
    if (!parent) {
      return NextResponse.json({ error: "Parent destination not found" }, { status: 404 });
    }
    if (parent.tripId !== tripId) {
      return NextResponse.json({ error: "Parent destination must belong to the same trip" }, { status: 400 });
    }
    if (parent.parentCityId !== null) {
      return NextResponse.json(
        { error: "Sub-destinations cannot have their own sub-destinations (one level deep)" },
        { status: 400 },
      );
    }
  }

  // Compute order among siblings (same parentCityId)
  const last = await prisma.city.findFirst({
    where: { tripId, parentCityId: parentCityId ?? null },
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
      ...(parentCityId != null && { parentCityId }),
      ...(nickname && { nickname }),
      ...(country && { country }),
      ...(countryCode && { countryCode }),
      ...(latitude != null && { latitude }),
      ...(longitude != null && { longitude }),
      ...(timezone && { timezone }),
    },
  });
  return NextResponse.json(city, { status: 201 });
}
