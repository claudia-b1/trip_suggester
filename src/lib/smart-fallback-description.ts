/**
 * Phase A: Smart fallback description builder.
 *
 * When all enrichment sources (Wikipedia, Google editorial, Wikidata) return
 * empty, this builds a useful description from existing metadata so no POI
 * ever shows a blank description.
 */

import { CATEGORY_LABELS, type Category, isCategory } from "@/lib/categories";

export function buildFallbackDescription(data: {
  category: string;
  subcategory?: string | null;
  /** Geoapify placeCategory label, e.g. "Restaurant", "Winery" */
  placeCategory?: string | null;
  /** OSM cuisine tag, e.g. "italian;pizza" */
  cuisine?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  cityName: string;
}): string {
  const parts: string[] = [];

  // 1. Build the place type label
  const cuisines = data.cuisine
    ?.split(/[;,]/)
    .map((c) => c.trim())
    .filter(Boolean) ?? [];
  const primaryCuisine = cuisines[0]
    ? cuisines[0].charAt(0).toUpperCase() + cuisines[0].slice(1)
    : null;

  if (primaryCuisine && data.placeCategory) {
    // "Italian restaurant" / "Seafood cafe"
    parts.push(`${primaryCuisine} ${data.placeCategory.toLowerCase()}`);
  } else if (data.placeCategory) {
    parts.push(data.placeCategory);
  } else if (data.subcategory) {
    // Use subcategory as a readable label (replace underscores, capitalize)
    parts.push(
      data.subcategory
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    );
  } else if (isCategory(data.category)) {
    parts.push(CATEGORY_LABELS[data.category as Category]);
  }

  // 2. Add city
  if (data.cityName) {
    parts.push(`in ${data.cityName}`);
  }

  let result = parts.join(" ");

  // 3. Add rating info
  if (data.rating != null && data.userRatingCount != null && data.userRatingCount > 0) {
    const countStr =
      data.userRatingCount >= 10000
        ? `${Math.round(data.userRatingCount / 1000)}K`
        : data.userRatingCount >= 1000
          ? `${(data.userRatingCount / 1000).toFixed(1)}K`
          : `${data.userRatingCount}`;
    result += ` · ${data.rating.toFixed(1)}★ (${countStr} reviews)`;
  }

  return result;
}
