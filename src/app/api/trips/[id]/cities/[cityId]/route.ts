import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyTripOwnership } from "@/lib/ownership";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id, cityId } = await params;
  const tripId = Number(id);
  if (!await verifyTripOwnership(tripId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const cityIdNum = Number(cityId);
  if (!Number.isInteger(cityIdNum)) {
    return NextResponse.json({ error: "Invalid cityId" }, { status: 400 });
  }
  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (body.startDate) data.startDate = new Date(body.startDate);
  if (body.endDate) data.endDate = new Date(body.endDate);
  if (typeof body.country === "string") data.country = body.country;
  if (typeof body.countryCode === "string") data.countryCode = body.countryCode;
  if (typeof body.latitude === "number") data.latitude = body.latitude;
  if (typeof body.longitude === "number") data.longitude = body.longitude;
  if (typeof body.timezone === "string") data.timezone = body.timezone;
  if (typeof body.order === "number") data.order = body.order;
  if ("nickname" in body) data.nickname = body.nickname === "" ? null : (body.nickname ?? null);
  if (body.type === "destination" || body.type === "stop") data.type = body.type;
  if (typeof body.discoverRadiusKm === "number") data.discoverRadiusKm = body.discoverRadiusKm;

  // Handle parentCityId changes (convert to sub-destination or detach)
  if ("parentCityId" in body) {
    const newParentId = body.parentCityId;
    if (newParentId === null) {
      // Detach: promote back to top-level destination
      data.parentCityId = null;
    } else if (typeof newParentId === "number") {
      // Cannot make a city its own parent
      if (newParentId === cityIdNum) {
        return NextResponse.json({ error: "A destination cannot be its own parent" }, { status: 400 });
      }
      // Validate parent exists, belongs to same trip, and is not itself a subcity
      const parent = await prisma.city.findUnique({
        where: { id: newParentId },
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
      // Make sure this city doesn't have subcities of its own (would create 3 levels)
      const existingSubcities = await prisma.city.count({ where: { parentCityId: cityIdNum } });
      if (existingSubcities > 0) {
        return NextResponse.json(
          { error: "Cannot convert a destination with sub-destinations — detach them first" },
          { status: 400 },
        );
      }
      data.parentCityId = newParentId;
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  const city = await prisma.city.update({ where: { id: cityIdNum }, data });
  return NextResponse.json(city);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id, cityId } = await params;
  if (!await verifyTripOwnership(Number(id), userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.city.delete({ where: { id: Number(cityId) } });
  return new NextResponse(null, { status: 204 });
}
