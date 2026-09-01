import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { isCategory } from "@/lib/categories";
import { syncFavouriteToTrips } from "@/lib/favourite-poi-sync";

/** GET /api/favourites/items — filtered items */
export async function GET(req: Request) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const url = new URL(req.url);
  const city = url.searchParams.get("city");
  const country = url.searchParams.get("country");
  const category = url.searchParams.get("category");
  const search = url.searchParams.get("search");
  const listId = url.searchParams.get("listId");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { list: { userId } };
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
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { name, category, subcategory, country, city, address, latitude, longitude, description, notes, photoUrl, website, phoneNumber, openingHours, priceLevel, fee, sourcePlaceId, listId, extraFields } = body;

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

  // Verify list exists and belongs to the active user
  const list = await prisma.favouriteList.findUnique({ where: { id: listId } });
  if (!list || list.userId !== userId) {
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
      phoneNumber: phoneNumber || null,
      openingHours: openingHours || null,
      priceLevel: typeof priceLevel === "number" ? priceLevel : null,
      fee: fee || null,
      sourcePlaceId: sourcePlaceId || null,
      extraFields: extraFields && typeof extraFields === "object" ? extraFields : undefined,
      listId,
    },
    include: { list: { select: { id: true, name: true } } },
  });

  // ── Auto-create POI in matching trip cities (distance-based) ────────────
  try {
    await syncFavouriteToTrips(
      {
        id: item.id,
        name: item.name,
        category: item.category,
        subcategory: item.subcategory,
        description: item.description,
        latitude: item.latitude,
        longitude: item.longitude,
        photoUrl: item.photoUrl,
        website: item.website,
        sourcePlaceId: item.sourcePlaceId,
        country: item.country,
      },
      userId,
    );
  } catch {
    // Auto-POI creation is best-effort — don't fail the favourite save
  }

  return NextResponse.json(item, { status: 201 });
}
