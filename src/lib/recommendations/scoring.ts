/**
 * Rule-based POI ranking engine.
 *
 * Scores each POI candidate on 0–100 across these dimensions:
 *  30 pts – quality / rating
 *  15 pts – proximity to city centre  (0 km → 15, ≥15 km → 0)
 *  25 pts – notability (Wikidata +10; review tiers: ≥100→+3, ≥1K→+7, ≥10K→+11, ≥50K→+15)
 *  15 pts – primary category match
 *   5 pts – hidden-gem bonus  (rating ≥80%, close, not Wikipedia-famous)
 *   5 pts – UNESCO World Heritage site
 *   5 pts – has image / photo
 */

export type ScoringFactors = {
  /** Quality rating from the source API (e.g. 0–7 for OTM, 0–5 for Geoapify). */
  rating?: number;
  /** Upper bound of the rating scale for normalisation. */
  ratingMax: number;
  /** Approximate number of reviews / user contributions. */
  reviewCount?: number;
  /** Distance from the city centre in km. */
  distanceKm?: number;
  /** True when the place has a Wikipedia / Wikidata article. */
  hasWikipedia?: boolean;
  /** True when the place has a photo. */
  hasImage?: boolean;
  /** All category/kind tags returned by the API. */
  tags?: string[];
  /** Subset of tags that are a strong match for the requested category. */
  primaryTags?: string[];
  /** User preference tags that adjust scoring weights. */
  preferences?: string[];
  /** The POI category being scored (e.g. "NIGHTLIFE"). */
  poiCategory?: string;
  /** Price level 0–4. */
  priceLevel?: number;
  /** True when the place is a UNESCO World Heritage Site. */
  isUnescoSite?: boolean;
};

export type ScoredItem<T> = T & { _score: number };

export function scorePoi(f: ScoringFactors): number {
  let score = 0;

  // ── 1. Rating quality (0–30) ──────────────────────────────────────────────
  if (f.rating !== undefined && f.ratingMax > 0) {
    score += (f.rating / f.ratingMax) * 30;
  } else {
    // No rating data → assume average (2.5 / 5) = 15 pts
    score += 15;
  }

  // ── 2. Proximity (0–15) ───────────────────────────────────────────────────
  const distKm = f.distanceKm ?? 5;
  score += Math.max(0, 15 - distKm);

  // ── 3. Notability (0–25) ──────────────────────────────────────────────────
  if (f.hasWikipedia) score += 10;
  // Stepped review-count tiers
  if (f.reviewCount !== undefined) {
    if      (f.reviewCount >= 50_000) score += 15;
    else if (f.reviewCount >= 10_000) score += 11;
    else if (f.reviewCount >= 1_000)  score += 7;
    else if (f.reviewCount >= 100)    score += 3;
  }

  // ── 4. Primary category match (0–15) ─────────────────────────────────────
  if (f.primaryTags?.length && f.tags?.length) {
    const hits = f.tags.filter((t) => f.primaryTags!.includes(t)).length;
    score += Math.min(15, hits * 5);
  }

  // ── 5. Hidden-gem bonus (0–5 base, up to 15 with preference) ──────────────
  const hiddenGemWeight = f.preferences?.includes("hidden_gems") ? 15 : 5;
  if (
    f.rating !== undefined &&
    f.ratingMax > 0 &&
    f.rating / f.ratingMax >= 0.8 &&
    distKm <= 5 &&
    !f.hasWikipedia
  ) {
    score += hiddenGemWeight;
  }

  // ── 6. UNESCO World Heritage Site (+5) ─────────────────────────────────────
  if (f.isUnescoSite) score += 5;

  // ── 7. Has photo (0–5) ────────────────────────────────────────────────────
  if (f.hasImage) score += 5;

  // ── 8. Preference adjustments ─────────────────────────────────────────────
  if (f.preferences?.length) {
    // "off_the_beaten_path" — penalise Wikipedia-famous, boost obscure
    if (f.preferences.includes("off_the_beaten_path")) {
      if (f.hasWikipedia) score -= 8;
      if (!f.hasWikipedia && (f.reviewCount ?? 0) < 200) score += 8;
    }
    // "budget_friendly" — penalise expensive, boost cheap/free
    if (f.preferences.includes("budget_friendly")) {
      if (f.priceLevel !== undefined) {
        if (f.priceLevel <= 1) score += 8;
        if (f.priceLevel >= 3) score -= 8;
      }
    }
    // "family_friendly" — penalise nightlife, boost parks/zoos
    if (f.preferences.includes("family_friendly")) {
      if (f.poiCategory === "NIGHTLIFE") score -= 10;
      const familyTags = ["zoo", "aquarium", "park", "garden", "theme_park", "water_park"];
      if (f.tags?.some((t) => familyTags.includes(t))) score += 10;
    }
  }

  return score;
}

/** Return the top N items from an array, by descending `_score`. */
export function topN<T>(items: ScoredItem<T>[], n: number): ScoredItem<T>[] {
  return [...items].sort((a, b) => b._score - a._score).slice(0, n);
}
