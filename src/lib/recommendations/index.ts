/**
 * Recommendations module — public API.
 *
 * The pipeline has three layers:
 *  1. Discovery  — Geoapify Places API (searchPlaces)
 *  2. Scoring    — rule-based engine (scorePoi / topN from scoring.ts)
 *  3. Enrichment — Wikidata + Google Places (enrichPlace from enrichment.ts)
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
  "ENTERTAINMENT",
  "NIGHTLIFE",
  "SHOPPING",
  "WELLNESS",
] as const;

export type RecommendableCategory = (typeof RECOMMENDABLE_CATEGORIES)[number];

/** Human-readable display labels for each category (FOOD shows as "Food & Drinks"). */
export { CATEGORY_LABELS } from "@/lib/categories";

export function isRecommendableCategory(v: unknown): v is RecommendableCategory {
  return (
    typeof v === "string" &&
    (RECOMMENDABLE_CATEGORIES as readonly string[]).includes(v)
  );
}
