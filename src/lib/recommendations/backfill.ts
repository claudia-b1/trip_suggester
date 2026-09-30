/**
 * Post-response enrichment backfill.
 *
 * The discover route returns POIs built from prescan data only
 * (`buildPoiFromPrescan`), because resolving photo URLs and querying Wikidata
 * took 76 of 111 seconds on a cold run — more than half the function budget,
 * for fields that are all display-only and nullable.
 *
 * This fills them in afterwards. It is idempotent and safe to re-run: it only
 * writes fields that are still empty, so a user edit made in the meantime is
 * never clobbered.
 */
import { prisma } from "@/lib/prisma";
import { enrichPlace } from "./enrichment";
import type { DiscoveredPlace } from "./geoapify";
import type { GoogleMeta } from "./google-places";
import type { Category } from "@/lib/categories";
import { pMapSettled } from "@/lib/p-map";

export type BackfillItem = {
  place: DiscoveredPlace;
  category: Category;
  googleMeta: GoogleMeta | null;
};

/** Wikidata and the photo endpoint are both free; this is latency-bound. */
const BACKFILL_CONCURRENCY = 25;

export async function backfillEnrichment(
  cityId: number,
  cityName: string,
  items: BackfillItem[],
): Promise<void> {
  if (items.length === 0) return;

  const start = Date.now();

  // Only touch POIs that still need something. A re-run, or a user who edited
  // a description in the meantime, should not be overwritten.
  const targets = await prisma.poi.findMany({
    where: {
      cityId,
      placeId: { in: items.map((i) => i.place.placeId) },
      OR: [{ photoUrl: null }, { wikidataId: null }],
    },
    select: { id: true, placeId: true, photoUrl: true, description: true, wikidataId: true },
  });

  if (targets.length === 0) return;

  const byPlaceId = new Map(targets.map((t) => [t.placeId, t]));
  const pending = items.filter((i) => byPlaceId.has(i.place.placeId));

  let updated = 0;

  await pMapSettled(
    pending,
    async ({ place, category, googleMeta }) => {
      const target = byPlaceId.get(place.placeId);
      if (!target) return;

      const enriched = await enrichPlace(place, category, cityName, googleMeta);

      // Build a sparse update — absent fields stay as they are.
      const data: Record<string, unknown> = {};
      if (!target.photoUrl && enriched.photoUrl) data.photoUrl = enriched.photoUrl;
      if (!target.wikidataId && enriched.wikidataId) data.wikidataId = enriched.wikidataId;
      if (enriched.inceptionYear != null) data.inceptionYear = enriched.inceptionYear;
      if (enriched.isUnescoSite) data.isUnescoSite = true;
      // Only replace the description when enrichment produced a real one —
      // the prescan path writes a generated fallback, which this improves on,
      // but an empty result must not blank it.
      if (enriched.description && enriched.description !== target.description) {
        data.description = enriched.description;
      }

      if (Object.keys(data).length === 0) return;
      await prisma.poi.update({ where: { id: target.id }, data });
      updated++;
    },
    BACKFILL_CONCURRENCY,
    (err, item) => console.error(`[backfill] failed for "${item.place.name}":`, err),
  );

  console.log(
    `[backfill] ${updated}/${pending.length} POI(s) enriched for city ${cityId} in ${((Date.now() - start) / 1000).toFixed(1)}s`,
  );
}
