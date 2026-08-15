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
  /**
   * Coordinate cross-validation penalty (0–70): how far the Geoapify
   * coordinates are from the Google Places coordinates.
   * Logarithmic decay — 0 m → 0, ~10 m → ~10, ~50 m → ~31, ~500 m → ~48, ≥8 km → 70 (max).
   * No Google match → 70. Subtracted from total; total clamped to 0.
   */
  googleCoordScore?: number;
};

export type ScoredItem<T> = T & { _score: number };

export type ScoreBreakdown = {
  rating: number;
  proximity: number;
  notability: number;
  categoryMatch: number;
  hiddenGem: number;
  unesco: number;
  photo: number;
  preferences: number;
  googleCoord: number;
  total: number;
};

export function scorePoiDetailed(f: ScoringFactors): ScoreBreakdown {
  // ── 1. Rating quality (0–30) ──────────────────────────────────────────────
  const rating =
    f.rating !== undefined && f.ratingMax > 0
      ? (f.rating / f.ratingMax) * 30
      : 15; // No rating → assume average

  // ── 2. Proximity (0–15) ───────────────────────────────────────────────────
  const distKm = f.distanceKm ?? 5;
  const proximity = Math.max(0, 15 - distKm);

  // ── 3. Notability (0–25) ──────────────────────────────────────────────────
  let notability = 0;
  if (f.hasWikipedia) notability += 10;
  if (f.reviewCount !== undefined) {
    if      (f.reviewCount >= 50_000) notability += 15;
    else if (f.reviewCount >= 10_000) notability += 11;
    else if (f.reviewCount >= 1_000)  notability += 7;
    else if (f.reviewCount >= 100)    notability += 3;
  }

  // ── 4. Primary category match (0–15) ─────────────────────────────────────
  let categoryMatch = 0;
  if (f.primaryTags?.length && f.tags?.length) {
    const hits = f.tags.filter((t) => f.primaryTags!.includes(t)).length;
    categoryMatch = Math.min(15, hits * 5);
  }

  // ── 5. Hidden-gem bonus (0–5 base, up to 15 with preference) ──────────────
  let hiddenGem = 0;
  const hiddenGemWeight = f.preferences?.includes("hidden_gems") ? 15 : 5;
  if (
    f.rating !== undefined &&
    f.ratingMax > 0 &&
    f.rating / f.ratingMax >= 0.8 &&
    distKm <= 5 &&
    !f.hasWikipedia
  ) {
    hiddenGem = hiddenGemWeight;
  }

  // ── 6. UNESCO World Heritage Site (+5) ─────────────────────────────────────
  const unesco = f.isUnescoSite ? 5 : 0;

  // ── 7. Has photo (0–5) ────────────────────────────────────────────────────
  const photo = f.hasImage ? 5 : 0;

  // ── 8. Google coordinate cross-validation penalty (0–100) ────────────────
  // Logarithmic decay: 0 m → 0 penalty, ≥500 m → 100 penalty.
  const googleCoordPenalty = f.googleCoordScore ?? 0;

  // ── 9. Preference adjustments ─────────────────────────────────────────────
  let preferences = 0;
  if (f.preferences?.length) {
    if (f.preferences.includes("off_the_beaten_path")) {
      if (f.hasWikipedia) preferences -= 8;
      if (!f.hasWikipedia && (f.reviewCount ?? 0) < 200) preferences += 8;
    }
    if (f.preferences.includes("budget_friendly")) {
      if (f.priceLevel !== undefined) {
        if (f.priceLevel <= 1) preferences += 8;
        if (f.priceLevel >= 3) preferences -= 8;
      }
    }
    if (f.preferences.includes("family_friendly")) {
      if (f.poiCategory === "NIGHTLIFE") preferences -= 10;
      const familyTags = ["zoo", "aquarium", "park", "garden", "theme_park", "water_park"];
      if (f.tags?.some((t) => familyTags.includes(t))) preferences += 10;
    }
  }

  const rawTotal = rating + proximity + notability + categoryMatch + hiddenGem + unesco + photo + preferences;
  const total = Math.max(0, rawTotal - googleCoordPenalty);

  return { rating, proximity, notability, categoryMatch, hiddenGem, unesco, photo, googleCoord: -googleCoordPenalty, preferences, total };
}

export function scorePoi(f: ScoringFactors): number {
  return scorePoiDetailed(f).total;
}

/** Return the top N items from an array, by descending `_score`. */
export function topN<T>(items: ScoredItem<T>[], n: number): ScoredItem<T>[] {
  return [...items].sort((a, b) => b._score - a._score).slice(0, n);
}

// ─── New two-formula scoring (regular vs nearby) ──────────────────────────────

/**
 * Scoring formula for regular city-radius POIs.
 *
 * Max points: 30 (rating) + 15 (proximity) + 25 (notability) + 10 (wikidata)
 *             + 25 (UNESCO) + 5 (photo) + 10 (category match) = 120
 * Minus coord mismatch penalty: 0–70.
 *
 * Quality gate (enforced in route.ts): rating ≥ 4.0 AND ≥ 15 reviews.
 */
export function scoreRegularPoi(f: {
  rating?: number;
  reviewCount?: number;
  distanceKm?: number;
  hasWikidataId?: boolean;
  isUnescoSite?: boolean;
  hasPhoto?: boolean;
  googleCoordScore?: number;
  tags?: string[];
  primaryTags?: string[];
  preferences?: string[];
  poiCategory?: string;
  priceLevel?: number;
}): ScoreBreakdown {
  // Rating (0–30): Google 0–5 scale
  const rating = f.rating !== undefined ? (f.rating / 5) * 30 : 15;

  // Proximity (0–15): 0 km → 15, ≥15 km → 0
  const distKm = f.distanceKm ?? 5;
  const proximity = Math.max(0, 15 - distKm);

  // Notability: wikidataId (0/10) + review count tiers (0–25)
  let notability = 0;
  if (f.hasWikidataId) notability += 10;
  if (f.reviewCount !== undefined) {
    if      (f.reviewCount >= 50_000) notability += 25;
    else if (f.reviewCount >= 25_000) notability += 18;
    else if (f.reviewCount >= 5_000)  notability += 12;
    else if (f.reviewCount >= 1_000)  notability += 8;
    else if (f.reviewCount >= 500)    notability += 5;
    else                               notability += 2;
  }

  // UNESCO (0–25)
  const unesco = f.isUnescoSite ? 25 : 0;

  // Photo (0–5)
  const photo = f.hasPhoto ? 5 : 0;

  // Category match (0–10): number of matching OSM tags × 5, capped at 10
  let categoryMatch = 0;
  if (f.primaryTags?.length && f.tags?.length) {
    const hits = f.tags.filter((t) => f.primaryTags!.includes(t)).length;
    categoryMatch = Math.min(10, hits * 5);
  }

  // Coord mismatch penalty (0–70)
  const googleCoordPenalty = f.googleCoordScore ?? 0;

  const rawTotal = rating + proximity + notability + unesco + photo + categoryMatch;
  const total = Math.max(0, rawTotal - googleCoordPenalty);

  return {
    rating, proximity, notability, categoryMatch,
    hiddenGem: 0, unesco, photo, preferences: 0,
    googleCoord: -googleCoordPenalty, total,
  };
}

/**
 * Scoring formula for nearby (ring-search) POIs.
 *
 * No proximity component — nearby places are intentionally far from the city centre.
 * Max points: 30 (rating) + 25 (notability) + 15 (wikidata) + 20 (UNESCO) + 5 (photo) = 95
 * Minus coord mismatch penalty: 0–70.
 *
 * Quality gate (enforced in route.ts): rating ≥ 4.0 AND ≥ 1,000 reviews. No exceptions.
 */
export function scoreNearbyPoi(f: {
  rating?: number;
  reviewCount?: number;
  hasWikidataId?: boolean;
  isUnescoSite?: boolean;
  hasPhoto?: boolean;
  googleCoordScore?: number;
}): ScoreBreakdown {
  // Rating (0–30): Google 0–5 scale
  const rating = f.rating !== undefined ? (f.rating / 5) * 30 : 15;

  // Notability: wikidataId (0/15) + review count tiers (0–25)
  // Tiers start at 1 000 (matching the quality gate minimum)
  let notability = 0;
  if (f.hasWikidataId) notability += 15;
  if (f.reviewCount !== undefined) {
    if      (f.reviewCount >= 50_000) notability += 25;
    else if (f.reviewCount >= 25_000) notability += 18;
    else if (f.reviewCount >= 10_000) notability += 12;
    else if (f.reviewCount >= 5_000)  notability += 12;
    else if (f.reviewCount >= 2_500)  notability += 8;
    else if (f.reviewCount >= 1_000)  notability += 4;
  }

  // UNESCO (0–20)
  const unesco = f.isUnescoSite ? 20 : 0;

  // Photo (0–5)
  const photo = f.hasPhoto ? 5 : 0;

  // Coord mismatch penalty (0–70)
  const googleCoordPenalty = f.googleCoordScore ?? 0;

  const rawTotal = rating + notability + unesco + photo;
  const total = Math.max(0, rawTotal - googleCoordPenalty);

  return {
    rating, proximity: 0, notability, categoryMatch: 0,
    hiddenGem: 0, unesco, photo, preferences: 0,
    googleCoord: -googleCoordPenalty, total,
  };
}
