/**
 * Cross-section deduplication for activity recommendations.
 *
 * Three layers:
 * 1. Redistribution — move must-do items to their natural section (hikes/cycling)
 * 2. Cross-section dedup — remove items that appear in multiple sections
 * 3. Title collection — feed existing titles into prompts so the LLM avoids repeats
 */

import { nameSimilarity } from "@/lib/recommendations/scoring";
import { haversineKm } from "@/lib/geo";
import type {
  ActivityRecommendation,
  HikeRecommendation,
  CyclingRecommendation,
  ActivityRecommendationsResult,
} from "@/lib/activity-recommendations";

// ── Constants ────────────────────────────────────────────────────────────────

const NAME_SIMILARITY_THRESHOLD = 0.55;
const COORD_PROXIMITY_KM = 0.5;
const COORD_ASSISTED_NAME_THRESHOLD = 0.35;
const MAX_INJECTED_TITLES = 50;

// ── Core similarity ──────────────────────────────────────────────────────────

type DeduplicatableItem = {
  title: string;
  latitude?: number;
  longitude?: number;
  linkedPlace?: string;
};

/** Check if two items likely refer to the same thing. */
export function isDuplicate(a: DeduplicatableItem, b: DeduplicatableItem): boolean {
  const titleSim = nameSimilarity(a.title, b.title);

  // Direct title match
  if (titleSim >= NAME_SIMILARITY_THRESHOLD) return true;

  // Coordinate-assisted match: nearby + lower name threshold
  if (
    a.latitude != null && a.longitude != null &&
    b.latitude != null && b.longitude != null
  ) {
    const dist = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
    if (dist < COORD_PROXIMITY_KM && titleSim >= COORD_ASSISTED_NAME_THRESHOLD) {
      return true;
    }
  }

  // Cross-check linkedPlace against title
  if (a.linkedPlace) {
    if (nameSimilarity(a.linkedPlace, b.title) >= NAME_SIMILARITY_THRESHOLD) return true;
    if (b.linkedPlace && nameSimilarity(a.linkedPlace, b.linkedPlace) >= NAME_SIMILARITY_THRESHOLD) return true;
  }
  if (b.linkedPlace) {
    if (nameSimilarity(b.linkedPlace, a.title) >= NAME_SIMILARITY_THRESHOLD) return true;
  }

  return false;
}

// ── Redistribution ───────────────────────────────────────────────────────────

const HIKE_KEYWORDS = /\b(trail|hike|hiking|trek|trekking|walking route|walking trail|summit|ascent|ridge walk)\b/i;
const CYCLING_KEYWORDS = /\b(cycl|bike|biking|bicycle|velodrome|bike route|bike path|bike trail)\b/i;

/** Determine if a must-do item naturally belongs in hikes or cycling. */
export function classifyForRedistribution(
  item: ActivityRecommendation,
): "hikes" | "cycling" | null {
  const text = `${item.title} ${item.description ?? ""}`;
  if (CYCLING_KEYWORDS.test(text)) return "cycling";
  if (HIKE_KEYWORDS.test(text)) return "hikes";
  return null;
}

/**
 * Move must-do items to their natural section (hikes/cycling) when that
 * section exists (i.e. the user requested it). Returns a new result object.
 */
export function redistributeMustDoItems(
  result: ActivityRecommendationsResult,
): ActivityRecommendationsResult {
  const hasHikes = result.hikes.length > 0;
  const hasCycling = result.cycling.length > 0;
  if (!hasHikes && !hasCycling) return result;

  const keptRecommendations: ActivityRecommendation[] = [];
  const movedToHikes: HikeRecommendation[] = [];
  const movedToCycling: CyclingRecommendation[] = [];

  for (const rec of result.recommendations) {
    const target = classifyForRedistribution(rec);
    if (target === "hikes" && hasHikes) {
      movedToHikes.push({
        title: rec.title,
        description: rec.description,
        latitude: rec.latitude,
        longitude: rec.longitude,
      });
    } else if (target === "cycling" && hasCycling) {
      movedToCycling.push({
        title: rec.title,
        description: rec.description,
        latitude: rec.latitude,
        longitude: rec.longitude,
      });
    } else {
      keptRecommendations.push(rec);
    }
  }

  if (movedToHikes.length === 0 && movedToCycling.length === 0) return result;

  return {
    ...result,
    recommendations: keptRecommendations,
    hikes: [...result.hikes, ...movedToHikes],
    cycling: [...result.cycling, ...movedToCycling],
  };
}

// ── Cross-section deduplication ──────────────────────────────────────────────

/**
 * Remove items that appear in multiple sections. Higher-priority sections
 * keep their items; lower-priority sections have duplicates removed.
 *
 * Priority (highest first): hikes > cycling > nearbyActivities > must-do > custom sections
 */
export function deduplicateAcrossSections(
  result: ActivityRecommendationsResult,
): ActivityRecommendationsResult {
  const seen: DeduplicatableItem[] = [];

  function dedup<T extends DeduplicatableItem>(items: T[]): T[] {
    const kept: T[] = [];
    for (const item of items) {
      if (seen.some((s) => isDuplicate(item, s))) continue;
      seen.push(item);
      kept.push(item);
    }
    return kept;
  }

  // Process in priority order — items seen first are kept
  const hikes = dedup(result.hikes);
  const cycling = dedup(result.cycling);

  // Nearby activities use "title" as the main field (matches DeduplicatableItem)
  const nearbyActivities = dedup(result.nearbyActivities);

  const recommendations = dedup(result.recommendations);

  // Custom sections: dedup each against everything seen so far
  const customSections = result.customSections.map((section) => ({
    ...section,
    items: dedup(section.items),
  }));

  return {
    ...result,
    recommendations,
    nearbyActivities,
    hikes,
    cycling,
    customSections,
    // nearbyCities are NOT deduped — they're a different entity type
  };
}

// ── Title collection for prompt injection ────────────────────────────────────

type ExcludableSection = "mustDo" | "nearbyCities" | "nearbyActivities" | "hikes" | "cycling";

/**
 * Collect all item titles from existing sections for prompt injection.
 * When regenerating a specific section, exclude that section's own titles.
 * When regenerating a specific custom section, pass its id to exclude it.
 */
export function collectExistingTitles(
  result: Partial<ActivityRecommendationsResult>,
  excludeSection?: ExcludableSection,
  excludeCustomSectionId?: string,
): string[] {
  const titles: string[] = [];

  if (excludeSection !== "mustDo" && Array.isArray(result.recommendations)) {
    for (const r of result.recommendations) titles.push(r.title);
  }
  if (excludeSection !== "nearbyActivities" && Array.isArray(result.nearbyActivities)) {
    for (const a of result.nearbyActivities) titles.push(a.title);
  }
  if (excludeSection !== "hikes" && Array.isArray(result.hikes)) {
    for (const h of result.hikes) titles.push(h.title);
  }
  if (excludeSection !== "cycling" && Array.isArray(result.cycling)) {
    for (const c of result.cycling) titles.push(c.title);
  }
  // Nearby cities are excluded — different entity type
  if (Array.isArray(result.customSections)) {
    for (const s of result.customSections) {
      if (s.id === excludeCustomSectionId) continue;
      for (const item of s.items) titles.push(item.title);
    }
  }

  return titles.slice(0, MAX_INJECTED_TITLES);
}
