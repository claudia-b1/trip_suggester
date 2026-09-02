import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCategory } from "@/lib/categories";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  const cityIdNum = Number(cityId);
  if (!await verifyCityOwnership(cityIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const pois = await prisma.poi.findMany({
    where: { cityId: cityIdNum },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(pois);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  if (!await verifyCityOwnership(Number(cityId), userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();
  const { name, category, subcategory, description, latitude, longitude, photoUrl, website, placeId, favouriteItemId, phoneNumber, openingHours, priceLevel, fee, address, notes } = body;

  if (!isCategory(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const cityIdNum = Number(cityId);
  const favItemId = typeof favouriteItemId === "number" ? favouriteItemId : null;

  const poi = await prisma.poi.create({
    data: {
      name,
      category,
      subcategory: typeof subcategory === "string" && subcategory.trim() ? subcategory.trim() : null,
      description: description || null,
      latitude: typeof latitude === "number" ? latitude : null,
      longitude: typeof longitude === "number" ? longitude : null,
      photoUrl: typeof photoUrl === "string" && photoUrl ? photoUrl : null,
      website: typeof website === "string" && website ? website : null,
      placeId: typeof placeId === "string" && placeId ? placeId : null,
      phoneNumber: typeof phoneNumber === "string" ? phoneNumber : null,
      openingHours: typeof openingHours === "string" ? openingHours : null,
      priceLevel: typeof priceLevel === "number" ? priceLevel : null,
      fee: typeof fee === "string" ? fee : null,
      address: typeof address === "string" ? address : null,
      notes: typeof notes === "string" ? notes : null,
      favouriteItemId: favItemId,
      cityId: cityIdNum,
    },
  });

  // If this POI is linked to a favourite, clear any previous dismissal
  // so the sync recognises it's been re-added intentionally.
  if (favItemId) {
    await prisma.dismissedFavouriteCity.deleteMany({
      where: { favouriteItemId: favItemId, cityId: cityIdNum },
    });
  }

  return NextResponse.json(poi, { status: 201 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  const id = Number(cityId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid cityId" }, { status: 400 });
  }
  if (!await verifyCityOwnership(id, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.poi.deleteMany({ where: { cityId: id } });
  return new NextResponse(null, { status: 204 });
}
