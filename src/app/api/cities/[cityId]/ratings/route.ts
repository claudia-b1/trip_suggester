import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";

/** GET /api/cities/:cityId/ratings — all ratings for POIs in this city (for active user) */
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

  const ratings = await prisma.poiRating.findMany({
    where: { poi: { cityId: cityIdNum }, userId },
    select: { poiId: true, rating: true, notInterested: true },
  });

  const result: Record<number, number> = {};
  const notInterested: number[] = [];

  for (const r of ratings) {
    if (r.rating) result[r.poiId] = r.rating;
    if (r.notInterested) notInterested.push(r.poiId);
  }

  return NextResponse.json({ ratings: result, notInterested });
}

/** POST /api/cities/:cityId/ratings/migrate — bulk import from localStorage */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  const cityIdNum = Number(cityId);
  if (!await verifyCityOwnership(cityIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { ratings, notInterested } = body as {
    ratings?: Record<string, number>;
    notInterested?: number[];
  };

  // Get all POI IDs for this city to validate
  const pois = await prisma.poi.findMany({
    where: { cityId: cityIdNum },
    select: { id: true },
  });
  const validPoiIds = new Set(pois.map((p) => p.id));

  const upserts: Promise<unknown>[] = [];

  if (ratings) {
    for (const [poiIdStr, rating] of Object.entries(ratings)) {
      const poiId = Number(poiIdStr);
      if (!validPoiIds.has(poiId)) continue;
      if (typeof rating !== "number" || rating < 1 || rating > 5) continue;
      upserts.push(
        prisma.poiRating.upsert({
          where: { poiId_userId: { poiId, userId } },
          create: { poiId, userId, rating, notInterested: false },
          update: { rating },
        }),
      );
    }
  }

  if (notInterested) {
    for (const poiId of notInterested) {
      if (!validPoiIds.has(poiId)) continue;
      upserts.push(
        prisma.poiRating.upsert({
          where: { poiId_userId: { poiId, userId } },
          create: { poiId, userId, notInterested: true },
          update: { notInterested: true },
        }),
      );
    }
  }

  await Promise.all(upserts);
  return NextResponse.json({ migrated: upserts.length }, { status: 200 });
}
