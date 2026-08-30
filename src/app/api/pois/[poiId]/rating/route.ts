import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyPoiOwnership } from "@/lib/ownership";

/** PUT /api/pois/:poiId/rating — upsert rating/notInterested/visited + sync to favourites */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ poiId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { poiId } = await params;
  const poiIdNum = Number(poiId);

  if (!await verifyPoiOwnership(poiIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const data: { rating?: number | null; notInterested?: boolean; visited?: boolean } = {};

  if (body.rating !== undefined) {
    data.rating =
      typeof body.rating === "number" && body.rating >= 1 && body.rating <= 5
        ? body.rating
        : null;
  }
  if (typeof body.notInterested === "boolean") {
    data.notInterested = body.notInterested;
  }
  if (typeof body.visited === "boolean") {
    data.visited = body.visited;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const result = await prisma.poiRating.upsert({
    where: { poiId_userId: { poiId: poiIdNum, userId } },
    create: {
      poiId: poiIdNum,
      userId,
      rating: data.rating ?? null,
      notInterested: data.notInterested ?? false,
      visited: data.visited ?? false,
    },
    update: data,
  });

  // ── Sync rating & visited to matching FavouriteItem(s) ──
  try {
    const syncData: Record<string, unknown> = {};
    if (data.rating !== undefined) syncData.personalRating = data.rating;
    if (data.visited !== undefined) syncData.visited = data.visited;

    if (Object.keys(syncData).length > 0) {
      // Look up the POI to find its placeId and name/city for matching
      const poi = await prisma.poi.findUnique({
        where: { id: Number(poiId) },
        select: { placeId: true, name: true, city: { select: { name: true } } },
      });

      if (poi) {
        // Match by sourcePlaceId first, fallback to name+city (case-insensitive)
        if (poi.placeId) {
          await prisma.favouriteItem.updateMany({
            where: { sourcePlaceId: poi.placeId },
            data: syncData,
          });
        } else if (poi.name && poi.city?.name) {
          await prisma.favouriteItem.updateMany({
            where: {
              name: { equals: poi.name, mode: "insensitive" },
              city: { equals: poi.city.name, mode: "insensitive" },
            },
            data: syncData,
          });
        }
      }
    }
  } catch {
    // Sync is best-effort — don't fail the main operation
  }

  return NextResponse.json(result);
}
