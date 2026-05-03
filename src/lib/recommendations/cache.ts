/**
 * Two-tier POI cache backed by SQLite.
 *
 * Tier 1 — Discovery cache  (`PoiCache`)
 *   Key: (cityName, category, source)
 *   Stores raw discovery results (DiscoveredPlace[]) and ranked/enriched results.
 *   TTL: 7 days by default.
 *
 * Tier 2 — Enrichment cache (`PoiEnrichCache`)
 *   Key: (placeId, source) where source = "wikidata" | "google"
 *   Stores per-POI enrichment objects.
 *   TTL: 14 days by default (enrichment data changes less often).
 */
import { prisma } from "@/lib/prisma";

const DISCOVERY_TTL_DAYS = 30;
const ENRICHMENT_TTL_DAYS = 30;

/** Generic discovery cache — stores any JSON-serialisable value. */
export async function withCache<T>(
  cityName: string,
  category: string,
  source: string,
  fetcher: () => Promise<T>,
  ttlDays = DISCOVERY_TTL_DAYS,
): Promise<T> {
  const key = { cityName: cityName.toLowerCase().trim(), category, source };

  const existing = await prisma.poiCache.findUnique({
    where: { cityName_category_source: key },
  });

  if (existing) {
    const ageMs = Date.now() - existing.cachedAt.getTime();
    if (ageMs < ttlDays * 24 * 60 * 60 * 1000) {
      return JSON.parse(existing.payload) as T;
    }
  }

  const data = await fetcher();

  await prisma.poiCache.upsert({
    where: { cityName_category_source: key },
    update: { payload: JSON.stringify(data), cachedAt: new Date() },
    create: { ...key, payload: JSON.stringify(data) },
  });

  return data;
}

/** Per-POI enrichment cache — keyed by (placeId, source). */
export async function withEnrichCache<T>(
  placeId: string,
  source: string,
  fetcher: () => Promise<T | null>,
  ttlDays = ENRICHMENT_TTL_DAYS,
): Promise<T | null> {
  const key = { placeId, source };

  const existing = await prisma.poiEnrichCache.findUnique({
    where: { placeId_source: key },
  });

  if (existing) {
    const ageMs = Date.now() - existing.cachedAt.getTime();
    if (ageMs < ttlDays * 24 * 60 * 60 * 1000) {
      return JSON.parse(existing.payload) as T;
    }
  }

  const data = await fetcher();

  // Cache even null results to avoid hammering APIs for unknown places
  await prisma.poiEnrichCache.upsert({
    where: { placeId_source: key },
    update: { payload: JSON.stringify(data), cachedAt: new Date() },
    create: { ...key, payload: JSON.stringify(data) },
  });

  return data;
}

