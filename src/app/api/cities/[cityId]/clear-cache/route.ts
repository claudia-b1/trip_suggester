/**
 * POST /api/cities/[cityId]/clear-cache
 *
 * Clears cached discovery and enrichment data for a city so the next
 * Discover run fetches completely fresh results.
 *
 * Deletes:
 *  - PoiCache rows matching the city name (discovery cache)
 *  - PoiEnrichCache rows for POIs in this city (enrichment cache)
 *  - CityInfoCache rows for this city (AI-generated info)
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  const cityIdNum = Number(cityId);
  if (!Number.isInteger(cityIdNum)) {
    return NextResponse.json({ error: "Invalid cityId" }, { status: 400 });
  }

  if (!(await verifyCityOwnership(cityIdNum, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Get city name for discovery cache lookup
  const city = await prisma.city.findUnique({
    where: { id: cityIdNum },
    select: { name: true },
  });
  if (!city) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cityNameKey = city.name.toLowerCase().trim();

  // Get placeIds for POIs in this city (to clear enrichment cache)
  const pois = await prisma.poi.findMany({
    where: { cityId: cityIdNum, placeId: { not: null } },
    select: { placeId: true },
  });
  const placeIds = pois.map((p) => p.placeId).filter((id): id is string => id !== null);

  // Clear all caches in parallel
  const [discovery, enrichment, cityInfo] = await Promise.all([
    // Discovery cache (keyed by city name)
    prisma.poiCache.deleteMany({
      where: { cityName: cityNameKey },
    }),
    // Enrichment cache (keyed by placeId)
    placeIds.length > 0
      ? prisma.poiEnrichCache.deleteMany({
          where: { placeId: { in: placeIds } },
        })
      : Promise.resolve({ count: 0 }),
    // City info cache (AI-generated)
    prisma.cityInfoCache.deleteMany({
      where: { cityId: cityIdNum },
    }),
  ]);

  return NextResponse.json({
    cleared: {
      discovery: discovery.count,
      enrichment: enrichment.count,
      cityInfo: cityInfo.count,
    },
  });
}
