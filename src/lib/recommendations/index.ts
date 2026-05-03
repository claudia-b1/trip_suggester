/**
 * Recommendations module — public API.
 *
 * The pipeline has three layers:
 *  1. Discovery  — Geoapify Places API (searchPlaces)
 *  2. Scoring    — rule-based engine (scorePoi / topN from scoring.ts)
 *  3. Enrichment — Wikidata + Google Places (enrichPlace from enrichment.ts)
 *
 * Legacy per-category generators (food.ts, nightlife.ts) are superseded
 * and kept only for historical reference. OTM files have been removed.
 */
export type { GenerateInput, RecommendedPoi } from "./_shared";

export { searchPlaces, type DiscoveredPlace } from "./geoapify";
export { enrichPlace, PRICE_LABELS } from "./enrichment";
export { scorePoi, topN } from "./scoring";
export { withCache, withEnrichCache } from "./cache";
export { SUBCATEGORIES, resolveApiValues, resolveSpecialFlags } from "./subcategories";

export const RECOMMENDABLE_CATEGORIES = [
  "CULTURE",
  "FOOD",
  "NATURE",
  "NIGHTLIFE",
  "OUTDOORS",
] as const;

export type RecommendableCategory = (typeof RECOMMENDABLE_CATEGORIES)[number];

export function isRecommendableCategory(v: unknown): v is RecommendableCategory {
  return (
    typeof v === "string" &&
    (RECOMMENDABLE_CATEGORIES as readonly string[]).includes(v)
  );
}