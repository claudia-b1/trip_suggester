import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCategory } from "@/lib/categories";

/** GET /api/favourites/items — filtered items */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const city = url.searchParams.get("city");
  const country = url.searchParams.get("country");
  const category = url.searchParams.get("category");
  const search = url.searchParams.get("search");
  const listId = url.searchParams.get("listId");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (city) where.city = { equals: city, mode: "insensitive" };
  if (country) where.country = { equals: country, mode: "insensitive" };
  if (category && isCategory(category)) where.category = category;
  if (listId) where.listId = Number(listId);
  if (search) where.name = { contains: search, mode: "insensitive" };

  const items = await prisma.favouriteItem.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { list: { select: { id: true, name: true } } },
  });

  return NextResponse.json(items);
}

/** POST /api/favourites/items — create a favourite item */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { name, category, subcategory, country, city, address, latitude, longitude, description, notes, photoUrl, website, sourcePlaceId, listId, extraFields } = body;

  // Validate required fields
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!isCategory(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (typeof country !== "string" || !country.trim()) {
    return NextResponse.json({ error: "country is required" }, { status: 400 });
  }
  if (typeof city !== "string" || !city.trim()) {
    return NextResponse.json({ error: "city is required" }, { status: 400 });
  }
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return NextResponse.json({ error: "latitude and longitude are required" }, { status: 400 });
  }
  if (typeof listId !== "number") {
    return NextResponse.json({ error: "listId is required" }, { status: 400 });
  }

  // Verify list exists
  const list = await prisma.favouriteList.findUnique({ where: { id: listId } });
  if (!list) {
    return NextResponse.json({ error: "List not found" }, { status: 404 });
  }

  const item = await prisma.favouriteItem.create({
    data: {
      name: name.trim(),
      category,
      subcategory: subcategory || null,
      country: country.trim(),
      city: city.trim(),
      address: address || null,
      latitude,
      longitude,
      description: description || null,
      notes: notes || null,
      photoUrl: photoUrl || null,
      website: website || null,
      sourcePlaceId: sourcePlaceId || null,
      extraFields: extraFields && typeof extraFields === "object" ? extraFields : undefined,
      listId,
    },
    include: { list: { select: { id: true, name: true } } },
  });

  // ── Auto-create POI in matching trip cities ────────────────────────────
  // Find cities whose name+country match this favourite (case-insensitive)
  try {
    const matchingCities = await prisma.city.findMany({
      where: {
        name: { equals: city.trim(), mode: "insensitive" },
        ...(country.trim() ? { country: { equals: country.trim(), mode: "insensitive" } } : {}),
      },
      select: { id: true },
    });

    for (const mc of matchingCities) {
      // Check if a POI with same sourcePlaceId or name already exists in this city
      const existingPoi = await prisma.poi.findFirst({
        where: {
          cityId: mc.id,
          OR: [
            ...(sourcePlaceId ? [{ placeId: sourcePlaceId }] : []),
            { name: { equals: name.trim(), mode: "insensitive" as const } },
          ],
        },
        select: { id: true },
      });

      if (!existingPoi) {
        await prisma.poi.create({
          data: {
            name: name.trim(),
            category,
            subcategory: subcategory || null,
            description: description || null,
            latitude,
            longitude,
            photoUrl: photoUrl || null,
            website: website || null,
            placeId: sourcePlaceId || null,
            cityId: mc.id,
          },
        });
      }
    }
  } catch {
    // Auto-POI creation is best-effort — don't fail the favourite save
  }

  return NextResponse.json(item, { status: 201 });
}
