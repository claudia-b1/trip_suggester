import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyTripOwnership } from "@/lib/ownership";
import { syncFavouritesToCity } from "@/lib/favourite-poi-sync";

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
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  const tripId = Number(id);
  if (!await verifyTripOwnership(tripId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { name, nickname, startDate, endDate, country, countryCode, latitude, longitude, timezone, parentCityId, type } = await req.json();

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
      ...(type === "stop" && { type: "stop" }),
    },
  });

  // ── Auto-add matching favourites as POIs ──────────────────────────────
  if (latitude != null && longitude != null && country) {
    try {
      await syncFavouritesToCity(
        city.id,
        latitude,
        longitude,
        country,
        null, // no discover radius set yet — uses default 10km
        userId,
      );
    } catch {
      // Best-effort — don't fail city creation
    }
  }

  return NextResponse.json(city, { status: 201 });
}
