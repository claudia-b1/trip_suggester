import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET /api/cities/:cityId/ratings — all ratings for POIs in this city */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const { cityId } = await params;

  const ratings = await prisma.poiRating.findMany({
    where: { poi: { cityId: Number(cityId) } },
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
  const { cityId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { ratings, notInterested } = body as {
    ratings?: Record<string, number>;
    notInterested?: number[];
  };

  // Get all POI IDs for this city to validate
  const pois = await prisma.poi.findMany({
    where: { cityId: Number(cityId) },
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
          where: { poiId },
          create: { poiId, rating, notInterested: false },
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
          where: { poiId },
          create: { poiId, notInterested: true },
          update: { notInterested: true },
        }),
      );
    }
  }

  await Promise.all(upserts);
  return NextResponse.json({ migrated: upserts.length }, { status: 200 });
}
