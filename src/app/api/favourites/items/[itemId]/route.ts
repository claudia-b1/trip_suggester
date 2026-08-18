import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isCategory } from "@/lib/categories";

/** PATCH /api/favourites/items/:itemId — update item fields + sync to POI ratings */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const data: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.category === "string" && isCategory(body.category)) data.category = body.category;
  if (body.subcategory !== undefined) data.subcategory = body.subcategory || null;
  if (typeof body.country === "string") data.country = body.country.trim();
  if (typeof body.city === "string") data.city = body.city.trim();
  if (body.address !== undefined) data.address = body.address || null;
  if (typeof body.latitude === "number") data.latitude = body.latitude;
  if (typeof body.longitude === "number") data.longitude = body.longitude;
  if (body.description !== undefined) data.description = body.description || null;
  if (body.notes !== undefined) data.notes = body.notes || null;
  if (body.photoUrl !== undefined) data.photoUrl = body.photoUrl || null;
  if (body.website !== undefined) data.website = body.website || null;
  if (typeof body.listId === "number") data.listId = body.listId;
  if (typeof body.visited === "boolean") data.visited = body.visited;
  if (body.personalRating !== undefined) {
    data.personalRating =
      typeof body.personalRating === "number" &&
      body.personalRating >= 1 &&
      body.personalRating <= 5
        ? body.personalRating
        : null;
  }
  if (typeof body.order === "number") data.order = body.order;
  if (body.extraFields !== undefined) {
    data.extraFields = body.extraFields && typeof body.extraFields === "object"
      ? body.extraFields
      : Prisma.DbNull;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  let updated;
  try {
    updated = await prisma.favouriteItem.update({
      where: { id: Number(itemId) },
      data,
      include: { list: { select: { id: true, name: true } } },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("PATCH /api/favourites/items/:itemId error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // ── Sync personalRating & visited to matching PoiRating(s) ──
  try {
    const needsSync =
      data.personalRating !== undefined || data.visited !== undefined;

    if (needsSync) {
      const syncRating = data.personalRating !== undefined;
      const syncVisited = data.visited !== undefined;

      // Find matching POIs by sourcePlaceId or name+city
      let matchingPoiIds: number[] = [];

      if (updated.sourcePlaceId) {
        const pois = await prisma.poi.findMany({
          where: { placeId: updated.sourcePlaceId },
          select: { id: true },
        });
        matchingPoiIds = pois.map((p) => p.id);
      }

      // Fallback: match by name + city (case-insensitive)
      if (matchingPoiIds.length === 0 && updated.name && updated.city) {
        const pois = await prisma.poi.findMany({
          where: {
            name: { equals: updated.name, mode: "insensitive" },
            city: { name: { equals: updated.city, mode: "insensitive" } },
          },
          select: { id: true },
        });
        matchingPoiIds = pois.map((p) => p.id);
      }

      // Upsert PoiRating for each matching POI
      for (const poiId of matchingPoiIds) {
        const upsertData: { rating?: number | null; visited?: boolean } = {};
        if (syncRating) upsertData.rating = updated.personalRating;
        if (syncVisited) upsertData.visited = updated.visited;

        await prisma.poiRating.upsert({
          where: { poiId },
          create: {
            poiId,
            rating: syncRating ? (updated.personalRating ?? null) : null,
            notInterested: false,
            visited: syncVisited ? updated.visited : false,
          },
          update: upsertData,
        });
      }
    }
  } catch {
    // Sync is best-effort — don't fail the main operation
  }

  // ── Sync category & subcategory changes to matching Poi records ──
  try {
    const needsCatSync =
      data.category !== undefined || data.subcategory !== undefined;

    if (needsCatSync) {
      const syncData: Record<string, unknown> = {};
      if (data.category !== undefined) syncData.category = data.category;
      if (data.subcategory !== undefined) syncData.subcategory = data.subcategory ?? null;

      let matchingPoiIds: number[] = [];

      if (updated.sourcePlaceId) {
        const pois = await prisma.poi.findMany({
          where: { placeId: updated.sourcePlaceId },
          select: { id: true },
        });
        matchingPoiIds = pois.map((p) => p.id);
      }

      if (matchingPoiIds.length === 0 && updated.name && updated.city) {
        const pois = await prisma.poi.findMany({
          where: {
            name: { equals: updated.name, mode: "insensitive" },
            city: { name: { equals: updated.city, mode: "insensitive" } },
          },
          select: { id: true },
        });
        matchingPoiIds = pois.map((p) => p.id);
      }

      for (const poiId of matchingPoiIds) {
        await prisma.poi.update({
          where: { id: poiId },
          data: syncData,
        });
      }
    }
  } catch {
    // Category sync is best-effort
  }

  return NextResponse.json(updated);
}

/** DELETE /api/favourites/items/:itemId */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;
  await prisma.favouriteItem.delete({ where: { id: Number(itemId) } });
  return new NextResponse(null, { status: 204 });
}
