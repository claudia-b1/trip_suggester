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
/** Null results (failed lookups) expire faster so they get retried sooner. */
const ENRICHMENT_NULL_TTL_DAYS = 7;

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

/**
 * Per-POI enrichment cache — keyed by (placeId, source).
 *
 * @param skipCachedNull  When true, a cached `null` is treated as a cache
 *   miss so the fetcher is retried. Use this for nearby-only places whose
 *   previous null was produced by a wrong city-name query.
 */
export async function withEnrichCache<T>(
  placeId: string,
  source: string,
  fetcher: () => Promise<T | null>,
  ttlDays = ENRICHMENT_TTL_DAYS,
  skipCachedNull = false,
): Promise<T | null> {
  const key = { placeId, source };

  const existing = await prisma.poiEnrichCache.findUnique({
    where: { placeId_source: key },
  });

  if (existing) {
    const ageMs = Date.now() - existing.cachedAt.getTime();
    const parsed = JSON.parse(existing.payload) as T | null;

    // Null results expire faster (ENRICHMENT_NULL_TTL_DAYS) so failed lookups
    // get retried — a place that now has Wikidata/Google data won't stay
    // permanently marked as "nothing found".
    const effectiveTtl = parsed === null
      ? ENRICHMENT_NULL_TTL_DAYS * 24 * 60 * 60 * 1000
      : ttlDays * 24 * 60 * 60 * 1000;

    if (ageMs < effectiveTtl) {
      // If skipCachedNull and the cached value is null, fall through to re-fetch.
      // This handles nearby places whose null was cached via a wrong city-name query.
      if (!skipCachedNull || parsed !== null) return parsed;
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

// ─── Batched variant ─────────────────────────────────────────────────────────

/**
 * Request-scoped batching for `withEnrichCache`.
 *
 * The per-item version above costs a `findUnique` *plus* an `upsert` for every
 * entry. A discover run touches ~260 prescan candidates and ~120 POIs × 2
 * enrichment sources, so that is roughly a thousand separate round trips
 * queued through Prisma's small default pool — paid in full on warm runs too,
 * which is most of why a fully-cached run still takes ~50s.
 *
 * This reads every key the stage will need in one query, then writes everything
 * back in one batch. Lookup semantics (TTL, the shorter null TTL,
 * `skipCachedNull`) are identical to `withEnrichCache`.
 *
 * Usage: `preload()` the ids, `get()` each item, then `flush()` once at the end.
 */
export function createEnrichCacheBatch(source: string) {
  type Entry = { payload: string; cachedAt: Date };

  const loaded = new Map<string, Entry>();
  const pending = new Map<string, string>();
  let preloaded = false;

  function isFresh(entry: Entry, ttlDays: number): { fresh: boolean; parsed: unknown } {
    const parsed = JSON.parse(entry.payload) as unknown;
    const ttl = parsed === null ? ENRICHMENT_NULL_TTL_DAYS : ttlDays;
    const fresh = Date.now() - entry.cachedAt.getTime() < ttl * 24 * 60 * 60 * 1000;
    return { fresh, parsed };
  }

  return {
    /** One query for every key this stage will look at. */
    async preload(placeIds: string[]): Promise<void> {
      const unique = [...new Set(placeIds)];
      if (unique.length === 0) { preloaded = true; return; }

      const rows = await prisma.poiEnrichCache.findMany({
        where: { source, placeId: { in: unique } },
        select: { placeId: true, payload: true, cachedAt: true },
      });
      for (const row of rows) {
        loaded.set(row.placeId, { payload: row.payload, cachedAt: row.cachedAt });
      }
      preloaded = true;
    },

    async get<T>(
      placeId: string,
      fetcher: () => Promise<T | null>,
      ttlDays = ENRICHMENT_TTL_DAYS,
      skipCachedNull = false,
    ): Promise<T | null> {
      // Falling back to the per-item path when un-preloaded keeps this correct
      // if a caller forgets, rather than silently treating every key as a miss.
      if (!preloaded) return withEnrichCache<T>(placeId, source, fetcher, ttlDays, skipCachedNull);

      const existing = loaded.get(placeId);
      if (existing) {
        const { fresh, parsed } = isFresh(existing, ttlDays);
        if (fresh && (!skipCachedNull || parsed !== null)) return parsed as T | null;
      }

      const data = await fetcher();
      pending.set(placeId, JSON.stringify(data));
      // Reflect the write locally so a second get() in the same run sees it.
      loaded.set(placeId, { payload: JSON.stringify(data), cachedAt: new Date() });
      return data;
    },

    /** Write everything fetched this run. Prisma sends the array as one batch. */
    async flush(): Promise<number> {
      if (pending.size === 0) return 0;
      const now = new Date();
      const writes = [...pending].map(([placeId, payload]) =>
        prisma.poiEnrichCache.upsert({
          where: { placeId_source: { placeId, source } },
          update: { payload, cachedAt: now },
          create: { placeId, source, payload },
        }),
      );
      pending.clear();
      await prisma.$transaction(writes);
      return writes.length;
    },
  };
}

