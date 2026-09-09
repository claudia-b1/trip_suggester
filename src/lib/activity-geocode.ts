/**
 * Post-processing coordinate resolver for AI-generated activity recommendations.
 *
 * Strategy:
 * 1. Match recommendation items against existing POIs and PoiCandidates (free)
 * 2. Geocode unmatched items that have a specific named place (API calls)
 * 3. Validate all results against city center distance
 */

import { prisma } from "@/lib/prisma";
import { geocodeAddress } from "@/lib/geocode";
import { haversineKm } from "@/lib/geo";
import type {
  ActivityRecommendation,
  NearbyCityRecommendation,
  NearbyActivityRecommendation,
  HikeRecommendation,
  CyclingRecommendation,
  CoordinateSource,
} from "@/lib/activity-recommendations";

// ── Types ────────────────────────────────────────────────────────────────────

type CityCoords = { lat: number; lon: number };

/** An item that could potentially be geocoded */
type GeoCandidate = {
  /** Which section + index so we can write coordinates back */
  section: "recommendations" | "nearbyActivities" | "hikes" | "cycling" | "nearbyCities";
  index: number;
  /** What to search for in POI matching */
  matchName: string;
  /** Geocode queries to try in order (first success wins) */
  geocodeQueries: string[];
  /** 1 = highest priority (linkedPlace), 2 = location/startLocation, 3 = title */
  priority: 1 | 2 | 3;
  /** Max distance from city center (km) for validation */
  maxDistKm: number;
};

/** A cached POI or candidate with verified coordinates */
type PoiCoordEntry = {
  name: string;
  nameLower: string;
  /** Normalized: lowercase, diacritics stripped, trimmed */
  nameNorm: string;
  latitude: number;
  longitude: number;
};

// ── Configuration ────────────────────────────────────────────────────────────

/** Max items to geocode via external API per generation */
const GEOCODE_BUDGET = 25;
/** Delay between sequential geocode calls (ms) */
const GEOCODE_DELAY_MS = 100;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip diacritics and normalize for fuzzy matching */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Verbs that indicate a generic activity, not a specific place */
const GENERIC_VERBS = new Set([
  "try", "watch", "enjoy", "take", "go",
  "experience", "attend", "sample", "learn",
  "taste", "join", "participate", "relax", "swim", "shop", "dine",
  "eat", "drink", "rent", "book",
]);

/** Words that signal the title is purely generic (no specific location) */
const GENERIC_WORDS = new Set([
  "local", "traditional", "sunset", "sunrise", "cuisine", "nightlife",
  "street", "food", "market", "beach", "restaurant", "bar", "cafe",
]);

/**
 * Check if a title is a generic activity with no specific place name.
 * "Try local cuisine" → true (generic verb + no proper noun)
 * "Cycle the Parenzana Trail" → false (has a proper noun after the verb)
 * "Explore Brijuni National Park" → false (has a proper noun)
 */
function isGenericActivity(title: string): boolean {
  const words = title.split(/\s+/);
  const firstWord = words[0]?.toLowerCase().replace(/[^a-z]/g, "");
  if (!GENERIC_VERBS.has(firstWord)) return false;

  // If there are capitalized words after the verb (proper nouns), it's probably a place
  // Skip articles/prepositions: the, a, an, in, at, of, to, for, and, or, with, from, around, along, through, near
  const skipWords = new Set(["the", "a", "an", "in", "at", "of", "to", "for", "and", "or", "with", "from", "around", "along", "through", "near", "some", "its"]);
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (skipWords.has(w.toLowerCase())) continue;
    // A word starting with uppercase is likely a proper noun (place name)
    if (w.length > 1 && w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase()) {
      return false;
    }
  }

  // Also check for generic words — if the title is something like "try local cuisine"
  const lower = title.toLowerCase();
  if ([...GENERIC_WORDS].some((w) => lower.includes(w))) return true;

  return true;
}

/** Match a name against the POI coordinate entries */
function findPoiMatch(
  name: string,
  entries: PoiCoordEntry[],
): PoiCoordEntry | null {
  const norm = normalize(name);
  if (!norm) return null;

  // Exact normalized match
  for (const entry of entries) {
    if (entry.nameNorm === norm) return entry;
  }
  // Substring: POI name contains the search name or vice versa (min 4 chars to avoid false positives)
  if (norm.length >= 4) {
    for (const entry of entries) {
      if (entry.nameNorm.length >= 4) {
        if (entry.nameNorm.includes(norm) || norm.includes(entry.nameNorm)) return entry;
      }
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve accurate coordinates for activity recommendation items.
 * Mutates the arrays in-place, setting latitude/longitude/coordinateSource.
 *
 * @returns Summary of what was resolved (for logging)
 */
export async function resolveActivityCoordinates(
  result: {
    recommendations: ActivityRecommendation[];
    nearbyCities: NearbyCityRecommendation[];
    nearbyActivities: NearbyActivityRecommendation[];
    hikes: HikeRecommendation[];
    cycling: CyclingRecommendation[];
  },
  cityId: number,
  cityName: string,
  country: string | undefined,
  cityCoords: CityCoords,
): Promise<{ poiMatched: number; geocoded: number; failed: number; skipped: number }> {
  const stats = { poiMatched: 0, geocoded: 0, failed: 0, skipped: 0 };
  const countryStr = country ?? "";
  const locationSuffix = countryStr ? `${cityName}, ${countryStr}` : cityName;

  // ── Step A: Load existing POI data ──────────────────────────────────────

  const [pois, candidates] = await Promise.all([
    prisma.poi.findMany({
      where: { cityId, latitude: { not: null }, longitude: { not: null } },
      select: { name: true, latitude: true, longitude: true },
    }),
    prisma.poiCandidate.findMany({
      where: { cityId, latitude: { not: null }, longitude: { not: null } },
      select: { name: true, latitude: true, longitude: true },
    }),
  ]);

  const poiEntries: PoiCoordEntry[] = [
    // POIs first (higher quality / already added)
    ...pois.map((p) => ({
      name: p.name,
      nameLower: p.name.toLowerCase(),
      nameNorm: normalize(p.name),
      latitude: p.latitude!,
      longitude: p.longitude!,
    })),
    ...candidates.map((c) => ({
      name: c.name,
      nameLower: c.name.toLowerCase(),
      nameNorm: normalize(c.name),
      latitude: c.latitude!,
      longitude: c.longitude!,
    })),
  ];

  // ── Step B: Classify items ──────────────────────────────────────────────

  const geoCandidates: GeoCandidate[] = [];

  // Must-do recommendations
  result.recommendations.forEach((rec, i) => {
    if (rec.linkedPlace) {
      // Items with a named place link — always geocode (highest priority)
      geoCandidates.push({
        section: "recommendations", index: i,
        matchName: rec.linkedPlace,
        geocodeQueries: [
          `${rec.linkedPlace}, ${locationSuffix}`,
          countryStr ? `${rec.linkedPlace}, ${countryStr}` : null,
          rec.linkedPlace,
        ].filter(Boolean) as string[],
        priority: 1, maxDistKm: 50,
      });
    } else if (rec.latitude != null && rec.longitude != null && !isGenericActivity(rec.title)) {
      // Items without linkedPlace — only re-geocode if the LLM already provided
      // coordinates (indicating it's location-specific). Skip items with null coords
      // since they're generic activities that would just resolve to the city center.
      geoCandidates.push({
        section: "recommendations", index: i,
        matchName: rec.title,
        geocodeQueries: [
          `${rec.title}, ${locationSuffix}`,
          countryStr ? `${rec.title}, ${countryStr}` : null,
        ].filter(Boolean) as string[],
        priority: 3, maxDistKm: 50,
      });
    } else {
      stats.skipped++;
    }
  });

  // Nearby activities
  result.nearbyActivities.forEach((act, i) => {
    // Skip useless location values
    const hasRealLocation = act.location && !["multiple", "various", "n/a", ""].includes(act.location.toLowerCase().trim());
    if (hasRealLocation) {
      geoCandidates.push({
        section: "nearbyActivities", index: i,
        matchName: act.title,
        geocodeQueries: [
          `${act.title}, ${act.location}, ${countryStr}`.replace(/, $/, ""),
          `${act.title}, ${countryStr || locationSuffix}`,
          act.title,
        ],
        priority: 2, maxDistKm: 150,
      });
    } else if (!isGenericActivity(act.title)) {
      geoCandidates.push({
        section: "nearbyActivities", index: i,
        matchName: act.title,
        geocodeQueries: [
          `${act.title}, ${locationSuffix}`,
          countryStr ? `${act.title}, ${countryStr}` : null,
        ].filter(Boolean) as string[],
        priority: 3, maxDistKm: 150,
      });
    } else {
      stats.skipped++;
    }
  });

  // Hikes
  result.hikes.forEach((hike, i) => {
    if (hike.startLocation) {
      geoCandidates.push({
        section: "hikes", index: i,
        matchName: hike.title,
        geocodeQueries: [
          `${hike.title}, ${locationSuffix}`,
          `${hike.startLocation}, ${locationSuffix}`,
          countryStr ? `${hike.title}, ${countryStr}` : null,
        ].filter(Boolean) as string[],
        priority: 2, maxDistKm: 100,
      });
    } else if (!isGenericActivity(hike.title)) {
      geoCandidates.push({
        section: "hikes", index: i,
        matchName: hike.title,
        geocodeQueries: [
          `${hike.title}, ${locationSuffix}`,
          countryStr ? `${hike.title}, ${countryStr}` : null,
        ].filter(Boolean) as string[],
        priority: 3, maxDistKm: 100,
      });
    } else {
      stats.skipped++;
    }
  });

  // Cycling
  result.cycling.forEach((route, i) => {
    if (route.startLocation) {
      geoCandidates.push({
        section: "cycling", index: i,
        matchName: route.title,
        geocodeQueries: [
          `${route.title}, ${locationSuffix}`,
          `${route.startLocation}, ${locationSuffix}`,
          countryStr ? `${route.title}, ${countryStr}` : null,
        ].filter(Boolean) as string[],
        priority: 2, maxDistKm: 100,
      });
    } else if (!isGenericActivity(route.title)) {
      geoCandidates.push({
        section: "cycling", index: i,
        matchName: route.title,
        geocodeQueries: [
          `${route.title}, ${locationSuffix}`,
          countryStr ? `${route.title}, ${countryStr}` : null,
        ].filter(Boolean) as string[],
        priority: 3, maxDistKm: 100,
      });
    } else {
      stats.skipped++;
    }
  });

  // Nearby cities — these are proper city names, very geocodable
  result.nearbyCities.forEach((city, i) => {
    geoCandidates.push({
      section: "nearbyCities", index: i,
      matchName: city.name,
      geocodeQueries: [
        city.country ? `${city.name}, ${city.country}` : `${city.name}, ${countryStr}`.replace(/, $/, ""),
        city.name,
      ],
      priority: 1, maxDistKm: 500,
    });
  });

  // Sort by priority (1 first)
  geoCandidates.sort((a, b) => a.priority - b.priority);

  // ── Step C: POI matching ────────────────────────────────────────────────

  const needsGeocode: GeoCandidate[] = [];

  for (const candidate of geoCandidates) {
    const match = findPoiMatch(candidate.matchName, poiEntries);
    if (match) {
      // Validate matched coordinates are within range
      const dist = haversineKm(cityCoords.lat, cityCoords.lon, match.latitude, match.longitude);
      if (dist <= candidate.maxDistKm) {
        applyCoords(result, candidate, match.latitude, match.longitude, "poi-matched");
        stats.poiMatched++;
        continue;
      }
    }
    needsGeocode.push(candidate);
  }

  // ── Step D: Geocode unmatched items ─────────────────────────────────────

  const toGeocode = needsGeocode.slice(0, GEOCODE_BUDGET);
  stats.skipped += needsGeocode.length - toGeocode.length;

  for (let i = 0; i < toGeocode.length; i++) {
    const candidate = toGeocode[i];
    if (i > 0) await sleep(GEOCODE_DELAY_MS);

    // Try each query variation until one succeeds with valid coordinates
    let resolved = false;
    for (const query of candidate.geocodeQueries) {
      try {
        const geo = await geocodeAddress(query, countryStr || undefined);
        if (geo) {
          const dist = haversineKm(cityCoords.lat, cityCoords.lon, geo.lat, geo.lng);
          if (dist <= candidate.maxDistKm) {
            applyCoords(result, candidate, geo.lat, geo.lng, "geocoded");
            stats.geocoded++;
            resolved = true;
            break;
          }
        }
      } catch {
        // Try next query
      }
    }
    if (resolved) continue;
    stats.failed++;
  }

  return stats;
}

/** Also resolve coordinates for custom section items (same pattern, simpler) */
export async function resolveCustomSectionCoordinates(
  items: ActivityRecommendation[],
  cityId: number,
  cityName: string,
  country: string | undefined,
  cityCoords: CityCoords,
): Promise<void> {
  const countryStr = country ?? "";
  const locationSuffix = countryStr ? `${cityName}, ${countryStr}` : cityName;

  // Load POI data
  const [pois, candidates] = await Promise.all([
    prisma.poi.findMany({
      where: { cityId, latitude: { not: null }, longitude: { not: null } },
      select: { name: true, latitude: true, longitude: true },
    }),
    prisma.poiCandidate.findMany({
      where: { cityId, latitude: { not: null }, longitude: { not: null } },
      select: { name: true, latitude: true, longitude: true },
    }),
  ]);

  const poiEntries: PoiCoordEntry[] = [
    ...pois.map((p) => ({
      name: p.name, nameLower: p.name.toLowerCase(), nameNorm: normalize(p.name),
      latitude: p.latitude!, longitude: p.longitude!,
    })),
    ...candidates.map((c) => ({
      name: c.name, nameLower: c.name.toLowerCase(), nameNorm: normalize(c.name),
      latitude: c.latitude!, longitude: c.longitude!,
    })),
  ];

  let geocodeCount = 0;

  for (let i = 0; i < items.length; i++) {
    const rec = items[i];
    const name = rec.linkedPlace || rec.title;
    if (isGenericActivity(rec.title) && !rec.linkedPlace) continue;

    // Try POI match first
    const match = findPoiMatch(name, poiEntries);
    if (match) {
      const dist = haversineKm(cityCoords.lat, cityCoords.lon, match.latitude, match.longitude);
      if (dist <= 50) {
        items[i] = { ...rec, latitude: match.latitude, longitude: match.longitude, coordinateSource: "poi-matched" };
        continue;
      }
    }

    // Geocode (within budget) — try multiple query variations
    if (geocodeCount < GEOCODE_BUDGET) {
      if (geocodeCount > 0) await sleep(GEOCODE_DELAY_MS);
      const queries = rec.linkedPlace
        ? [
            `${rec.linkedPlace}, ${locationSuffix}`,
            countryStr ? `${rec.linkedPlace}, ${countryStr}` : null,
            rec.linkedPlace,
          ].filter(Boolean) as string[]
        : [
            `${rec.title}, ${locationSuffix}`,
            countryStr ? `${rec.title}, ${countryStr}` : null,
          ].filter(Boolean) as string[];

      let resolved = false;
      for (const query of queries) {
        try {
          const geo = await geocodeAddress(query, countryStr || undefined);
          if (geo) {
            const dist = haversineKm(cityCoords.lat, cityCoords.lon, geo.lat, geo.lng);
            if (dist <= 50) {
              items[i] = { ...rec, latitude: geo.lat, longitude: geo.lng, coordinateSource: "geocoded" };
              resolved = true;
              break;
            }
          }
        } catch { /* try next query */ }
      }
      geocodeCount++;
      if (resolved) continue;
    }
  }
}

// ── Internal helper ──────────────────────────────────────────────────────────

function applyCoords(
  result: {
    recommendations: ActivityRecommendation[];
    nearbyCities: NearbyCityRecommendation[];
    nearbyActivities: NearbyActivityRecommendation[];
    hikes: HikeRecommendation[];
    cycling: CyclingRecommendation[];
  },
  candidate: GeoCandidate,
  lat: number,
  lng: number,
  source: CoordinateSource,
): void {
  const arr = result[candidate.section];
  const item = arr[candidate.index];
  if (!item) return;
  // Mutate in-place (type-safe since all types have latitude/longitude/coordinateSource)
  (item as { latitude?: number; longitude?: number; coordinateSource?: CoordinateSource }).latitude = lat;
  (item as { latitude?: number; longitude?: number; coordinateSource?: CoordinateSource }).longitude = lng;
  (item as { latitude?: number; longitude?: number; coordinateSource?: CoordinateSource }).coordinateSource = source;
}
