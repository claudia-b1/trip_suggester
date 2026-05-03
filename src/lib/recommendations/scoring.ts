/**
 * Rule-based POI ranking engine.
 *
 * Scores each POI candidate on 0–100 across these dimensions:
 *  30 pts – quality / rating
 *  20 pts – proximity to city centre  (0 km → 20, ≥20 km → 0)
 *  20 pts – notability (Wikipedia indicator, review count)
 *  15 pts – primary category match
 *  10 pts – hidden-gem bonus  (high quality, close, not Wikipedia-famous)
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
};

export type ScoredItem<T> = T & { _score: number };

export function scorePoi(f: ScoringFactors): number {
  let score = 0;

  // ── 1. Rating quality (0–30) ──────────────────────────────────────────────
  if (f.rating !== undefined && f.ratingMax > 0) {
    score += (f.rating / f.ratingMax) * 30;
  } else {
    score += 10; // neutral when no rating data
  }

  // ── 2. Proximity (0–20) ───────────────────────────────────────────────────
  const distKm = f.distanceKm ?? 5;
  score += Math.max(0, 20 - distKm);

  // ── 3. Notability (0–20) ──────────────────────────────────────────────────
  if (f.hasWikipedia) score += 12;
  if (f.reviewCount !== undefined && f.reviewCount > 0) {
    // Logarithmic: 10 reviews → +4, 1000 reviews → +8, 1M reviews → (capped at 8)
    score += Math.min(8, Math.log10(f.reviewCount + 1) * 4);
  }

  // ── 4. Primary category match (0–15) ─────────────────────────────────────
  if (f.primaryTags?.length && f.tags?.length) {
    const hits = f.tags.filter((t) => f.primaryTags!.includes(t)).length;
    score += Math.min(15, hits * 5);
  }

  // ── 5. Hidden-gem bonus (0–10) ────────────────────────────────────────────
  // Well-rated, nearby, but not globally famous
  if (
    f.rating !== undefined &&
    f.ratingMax > 0 &&
    f.rating / f.ratingMax >= 0.6 &&
    distKm <= 5 &&
    !f.hasWikipedia
  ) {
    score += 10;
  }

  // ── 6. Has photo (0–5) ────────────────────────────────────────────────────
  if (f.hasImage) score += 5;

  return score;
}

/** Return the top N items from an array, by descending `_score`. */
export function topN<T>(items: ScoredItem<T>[], n: number): ScoredItem<T>[] {
  return [...items].sort((a, b) => b._score - a._score).slice(0, n);
}
