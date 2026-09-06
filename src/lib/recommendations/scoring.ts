/**
 * Rule-based POI ranking engine.
 *
 * Scores each POI candidate on 0–100 across these dimensions:
 *  30 pts – quality / rating
 *  15 pts – proximity to city centre  (0 km → 15, ≥15 km → 0)
 *  25 pts – notability (Wikidata +10; review tiers: ≥100→+3, ≥250→+5, ≥500→+7, ≥1K→+9, ≥2.5K→+11, ≥5K→+13, ≥10K→+14, ≥50K→+15)
 *  15 pts – primary category match
 *   5 pts – hidden-gem bonus  (rating ≥80%, close, not Wikipedia-famous)
 *  15 pts – UNESCO World Heritage site (reduced from 25)
 *   5 pts – has image / photo
 *   5 pts – verified info completeness (opening hours + phone + website)
 */

// ─── Name similarity helpers ──────────────────────────────────────────────────

/** Tokenize a name into lowercase words, stripping common noise. */
function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Token-overlap similarity between two place names (0–1).
 * Uses Jaccard on token sets + longest-common-substring bonus for
 * transliteration variants (e.g. "Piazza del Duomo" vs "Duomo Square").
 */
export function nameSimilarity(a: string, b: string): number {
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  if (tokA.length === 0 || tokB.length === 0) return 0;

  const setA = new Set(tokA);
  const setB = new Set(tokB);
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = intersection / union;

  // Bonus: if one name contains the other as a substring (case-insensitive)
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  const containsBonus = la.includes(lb) || lb.includes(la) ? 0.3 : 0;

  return Math.min(1, jaccard + containsBonus);
}

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
    else if (f.reviewCount >= 10_000) notability += 14;
    else if (f.reviewCount >= 5_000)  notability += 13;
    else if (f.reviewCount >= 2_500)  notability += 11;
    else if (f.reviewCount >= 1_000)  notability += 9;
    else if (f.reviewCount >= 500)    notability += 7;
    else if (f.reviewCount >= 250)    notability += 5;
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

  // ── 6. UNESCO World Heritage Site (+15) ────────────────────────────────────
  const unesco = f.isUnescoSite ? 15 : 0;

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
 *             + 15 (UNESCO) + 5 (photo) + 10 (category match) + 5 (info completeness) = 115
 * Minus coord mismatch penalty: 0–70 (capped at 10 for high name similarity).
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
  /** Whether the place has opening hours info */
  hasOpeningHours?: boolean;
  /** Whether the place has a phone number */
  hasPhone?: boolean;
  /** Whether the place has a website */
  hasWebsite?: boolean;
  /** Name similarity between Geoapify and Google match (0–1) */
  nameMatchScore?: number;
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
    else if (f.reviewCount >= 10_000) notability += 15;
    else if (f.reviewCount >= 5_000)  notability += 13;
    else if (f.reviewCount >= 2_500)  notability += 11;
    else if (f.reviewCount >= 1_000)  notability += 9;
    else if (f.reviewCount >= 500)    notability += 7;
    else if (f.reviewCount >= 250)    notability += 5;
    else if (f.reviewCount >= 100)    notability += 3;
    else                               notability += 2;
  }

  // UNESCO (0–15) — reduced from 25 to prevent overshadowing quality signals
  const unesco = f.isUnescoSite ? 15 : 0;

  // Photo (0–5)
  const photo = f.hasPhoto ? 5 : 0;

  // Category match (0–10): number of matching OSM tags × 5, capped at 10
  let categoryMatch = 0;
  if (f.primaryTags?.length && f.tags?.length) {
    const hits = f.tags.filter((t) => f.primaryTags!.includes(t)).length;
    categoryMatch = Math.min(10, hits * 5);
  }

  // Info completeness bonus (0–5): rewards places with verified contact/hours info
  let infoCompleteness = 0;
  if (f.hasOpeningHours) infoCompleteness += 2;
  if (f.hasPhone)        infoCompleteness += 1;
  if (f.hasWebsite)      infoCompleteness += 2;

  // Coord mismatch penalty (0–70), capped at 10 for high name similarity
  let googleCoordPenalty = f.googleCoordScore ?? 0;
  if (f.nameMatchScore !== undefined && f.nameMatchScore >= 0.7 && googleCoordPenalty > 10) {
    // Names match well — likely the same place with offset coords (entrance vs parking lot)
    googleCoordPenalty = 10;
  }

  const rawTotal = rating + proximity + notability + unesco + photo + categoryMatch + infoCompleteness;
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
 * Max points: 30 (rating) + 25 (notability) + 15 (wikidata) + 15 (UNESCO) + 5 (photo)
 *             + 10 (geo-isolation bonus) = 100
 * Minus coord mismatch penalty: 0–70 (capped at 10 for high name similarity).
 *
 * Quality gate (enforced in route.ts): rating ≥ 4.0 AND ≥ 200 reviews,
 * with Wikidata presence overriding the review count minimum.
 */
export function scoreNearbyPoi(f: {
  rating?: number;
  reviewCount?: number;
  hasWikidataId?: boolean;
  isUnescoSite?: boolean;
  hasPhoto?: boolean;
  googleCoordScore?: number;
  /** Distance from city centre in km — used for geo-isolation bonus */
  distanceFromCityKm?: number;
  /** Name similarity between Geoapify and Google match (0–1) */
  nameMatchScore?: number;
}): ScoreBreakdown {
  // Rating (0–30): Google 0–5 scale
  const rating = f.rating !== undefined ? (f.rating / 5) * 30 : 15;

  // Notability: wikidataId (0/15) + review count tiers (0–25)
  // Tiers now start at 200 (matching the lowered quality gate)
  let notability = 0;
  if (f.hasWikidataId) notability += 15;
  if (f.reviewCount !== undefined) {
    if      (f.reviewCount >= 50_000) notability += 25;
    else if (f.reviewCount >= 25_000) notability += 20;
    else if (f.reviewCount >= 10_000) notability += 16;
    else if (f.reviewCount >= 5_000)  notability += 13;
    else if (f.reviewCount >= 2_500)  notability += 10;
    else if (f.reviewCount >= 1_000)  notability += 7;
    else if (f.reviewCount >= 500)    notability += 5;
    else if (f.reviewCount >= 200)    notability += 3;
  }

  // UNESCO (0–15) — reduced from 20 to prevent overshadowing quality signals
  const unesco = f.isUnescoSite ? 15 : 0;

  // Photo (0–5)
  const photo = f.hasPhoto ? 5 : 0;

  // Geo-isolation bonus (0–10): places far from major cities naturally have fewer
  // reviews. Give them a boost so a charming hilltop village with 200 reviews
  // isn't penalised vs a suburban attraction with 2000.
  const distFromCity = f.distanceFromCityKm ?? 0;
  const geoIsolation = distFromCity >= 20 ? 10 : distFromCity >= 10 ? 5 : 0;

  // Coord mismatch penalty (0–70), capped at 10 for high name similarity
  let googleCoordPenalty = f.googleCoordScore ?? 0;
  if (f.nameMatchScore !== undefined && f.nameMatchScore >= 0.7 && googleCoordPenalty > 10) {
    googleCoordPenalty = 10;
  }

  const rawTotal = rating + notability + unesco + photo + geoIsolation;
  const total = Math.max(0, rawTotal - googleCoordPenalty);

  return {
    rating, proximity: 0, notability, categoryMatch: 0,
    hiddenGem: geoIsolation, unesco, photo, preferences: 0,
    googleCoord: -googleCoordPenalty, total,
  };
}
