/**
 * Activity Recommendations — prompt & model configuration
 *
 * This module separates the generation logic from the UI, making it easy to
 * swap models and iterate on prompts without touching any components.
 */

import { haversineKm } from "@/lib/geo";

// ── Types ────────────────────────────────────────────────────────────────────

export type CoordinateSource = "ai" | "geocoded" | "poi-matched";

export type ActivityRecommendation = {
  title: string;
  description: string;
  /** Optional: a specific place name that could link to a POI */
  linkedPlace?: string;
  /** Category hint for creating a POI (CULTURE, FOOD, NATURE, etc.) */
  category?: string;
  /** Approximate latitude if the model can provide it */
  latitude?: number;
  /** Approximate longitude if the model can provide it */
  longitude?: number;
  /** How the coordinates were obtained */
  coordinateSource?: CoordinateSource;
};

export type NearbyCityRecommendation = {
  name: string;
  description: string;
  /** Approximate distance from the main city */
  distance?: string;
  /** Country of the nearby city */
  country?: string;
  /** Approximate latitude */
  latitude?: number;
  /** Approximate longitude */
  longitude?: number;
  /** How the coordinates were obtained */
  coordinateSource?: CoordinateSource;
};

export type NearbyActivityRecommendation = {
  title: string;
  description: string;
  /** The nearby town/area where this activity is located */
  location: string;
  /** Approximate distance from main city */
  distance?: string;
  /** Category hint */
  category?: string;
  /** Approximate latitude */
  latitude?: number;
  /** Approximate longitude */
  longitude?: number;
  /** How the coordinates were obtained */
  coordinateSource?: CoordinateSource;
};

export type HikeRecommendation = {
  title: string;
  description: string;
  /** Distance of the hike/walk */
  distance?: string;
  /** Estimated duration */
  duration?: string;
  /** Difficulty level */
  difficulty?: string;
  /** Starting point / trailhead */
  startLocation?: string;
  /** Approximate latitude of the start */
  latitude?: number;
  /** Approximate longitude of the start */
  longitude?: number;
  /** How the coordinates were obtained */
  coordinateSource?: CoordinateSource;
};

export type CyclingRecommendation = {
  title: string;
  description: string;
  /** Distance of the route */
  distance?: string;
  /** Estimated duration */
  duration?: string;
  /** Difficulty level */
  difficulty?: string;
  /** Starting point */
  startLocation?: string;
  /** Approximate latitude of the start */
  latitude?: number;
  /** Approximate longitude of the start */
  longitude?: number;
  /** How the coordinates were obtained */
  coordinateSource?: CoordinateSource;
};

/** A user-defined custom recommendation section generated from a free-form prompt */
export type CustomRecommendationSection = {
  /** Unique identifier (nanoid-style) */
  id: string;
  /** The user's original prompt */
  prompt: string;
  /** Short display title derived from the prompt */
  title: string;
  /** Recommendations in the same shape as must-do activities */
  items: ActivityRecommendation[];
};

export type ActivityRecommendationsResult = {
  recommendations: ActivityRecommendation[];
  nearbyCities: NearbyCityRecommendation[];
  nearbyActivities: NearbyActivityRecommendation[];
  hikes: HikeRecommendation[];
  cycling: CyclingRecommendation[];
  customSections: CustomRecommendationSection[];
  generatedAt: string;
  model: string;
};

/** Options controlling which sections to generate and distance limits */
export type GenerateOptions = {
  includeMustDo?: boolean;
  includeNearbyCities?: boolean;
  includeNearbyActivities?: boolean;
  includeHikes?: boolean;
  includeCycling?: boolean;
  maxNearbyCitiesKm?: number;
  maxNearbyActivitiesKm?: number;
};

// ── Model config ─────────────────────────────────────────────────────────────
// Change this to swap models. Any OpenRouter-compatible model ID works.

export const ACTIVITY_MODEL = "inclusionai/ling-3.0-flash-sante:free";

// ── Prompt builder ───────────────────────────────────────────────────────────
// Edit this function to iterate on the prompt. The UI will not change.

export function buildActivityPrompt(
  cityName: string,
  country?: string,
  options?: GenerateOptions,
  coords?: { lat: number; lon: number } | null,
  existingTitles?: string[],
): string {
  const location = country ? `${cityName}, ${country}` : cityName;
  const includeMustDo = options?.includeMustDo !== false;
  const includeNearbyCities = options?.includeNearbyCities !== false;
  const includeNearbyActivities = options?.includeNearbyActivities !== false;
  const includeHikes = options?.includeHikes ?? false;
  const includeCycling = options?.includeCycling ?? false;
  const maxCitiesKm = options?.maxNearbyCitiesKm ?? 150;
  const maxActivitiesKm = options?.maxNearbyActivitiesKm ?? 50;

  const sections: string[] = [];
  const outputFields: string[] = [];

  if (includeMustDo) {
    sections.push(`## SECTION 1: Must-do activities (8-15 items)

Focus on:
- Activities and experiences, NOT specific venues or restaurants
- Things unique to this area that you cannot do elsewhere
- Seasonal or cultural experiences worth planning around
- Outdoor activities suited to the geography
- Local customs, events, or traditions to participate in
- Food or drink experiences specific to the region (types of cuisine, local specialties to seek out)

For each recommendation, determine the best-fit category from: CULTURE, FOOD, NATURE, ENTERTAINMENT, NIGHTLIFE, SHOPPING, GROCERIES, WELLNESS, OUTDOORS, ACCOMMODATION.

If the recommendation is tied to a specific named landmark or place, include its approximate GPS coordinates (latitude, longitude).`);

    outputFields.push(`- "recommendations": array of objects with "title" (string), "description" (string), "linkedPlace" (string or null — only for specific named landmarks), "category" (string — one of CULTURE/FOOD/NATURE/ENTERTAINMENT/NIGHTLIFE/SHOPPING/GROCERIES/WELLNESS/OUTDOORS/ACCOMMODATION), "latitude" (number or null), "longitude" (number or null)`);
  }

  if (includeNearbyCities) {
    sections.push(`## SECTION ${includeMustDo ? "2" : "1"}: Nearby cities worth visiting (5-8 items)

Suggest nearby towns or cities that are worth a day trip or side visit from ${cityName}.
- Only include cities within approximately ${maxCitiesKm} km of ${cityName}
- Include approximate distance in km
- Include the country name
- Include approximate GPS coordinates (latitude, longitude) for each city`);

    outputFields.push(`- "nearbyCities": array of objects with "name" (string), "description" (string), "distance" (string like "~25 km"), "country" (string), "latitude" (number), "longitude" (number)`);
  }

  if (includeNearbyActivities) {
    const sectionNum = [includeMustDo, includeNearbyCities].filter(Boolean).length + 1;
    sections.push(`## SECTION ${sectionNum}: Recommended activities nearby (5-10 items)

Suggest specific activities, attractions, or experiences in the area SURROUNDING ${cityName} (within approximately ${maxActivitiesKm} km) but NOT in ${cityName} itself.
- Focus on day-trip worthy activities: scenic drives, natural wonders, historic sites, unique experiences
- Include the town or area name where the activity is located
- Include approximate distance from ${cityName}
- Include approximate GPS coordinates (latitude, longitude)
- Determine the best-fit category from: CULTURE, FOOD, NATURE, ENTERTAINMENT, NIGHTLIFE, SHOPPING, GROCERIES, WELLNESS, OUTDOORS`);

    outputFields.push(`- "nearbyActivities": array of objects with "title" (string), "description" (string), "location" (string — the nearby town/area), "distance" (string like "~30 km"), "category" (string), "latitude" (number or null), "longitude" (number or null)`);
  }

  if (includeHikes) {
    const sectionNum = [includeMustDo, includeNearbyCities, includeNearbyActivities].filter(Boolean).length + 1;
    sections.push(`## SECTION ${sectionNum}: Hikes & walks (3-8 items)

Suggest hiking trails, walking routes, and scenic walks in and around ${cityName}.
- Include a mix of easy, moderate, and challenging routes when available
- Cover city walks, nature trails, coastal paths, mountain hikes — whatever is relevant to the area
- Include approximate distance (km), estimated duration, and difficulty (easy/moderate/challenging)
- Include the starting point or trailhead location
- Include approximate GPS coordinates for the starting point`);

    outputFields.push(`- "hikes": array of objects with "title" (string), "description" (string), "distance" (string like "~8 km"), "duration" (string like "~2-3 hours"), "difficulty" (string — "easy", "moderate", or "challenging"), "startLocation" (string), "latitude" (number or null), "longitude" (number or null)`);
  }

  if (includeCycling) {
    const sectionNum = [includeMustDo, includeNearbyCities, includeNearbyActivities, includeHikes].filter(Boolean).length + 1;
    sections.push(`## SECTION ${sectionNum}: Cycling routes (3-8 items)

Suggest cycling routes and bike trips in and around ${cityName}.
- Include a mix of recreational rides, road cycling routes, and mountain bike trails when available
- Include routes through scenic areas, along rivers, coastlines, or through countryside
- Include approximate distance (km), estimated duration, and difficulty (easy/moderate/challenging)
- Include the starting point
- Include approximate GPS coordinates for the starting point`);

    outputFields.push(`- "cycling": array of objects with "title" (string), "description" (string), "distance" (string like "~25 km"), "duration" (string like "~1.5 hours"), "difficulty" (string — "easy", "moderate", or "challenging"), "startLocation" (string), "latitude" (number or null), "longitude" (number or null)`);
  }

  // Build a strong location anchor at the very top of the prompt so the model
  // cannot confuse similarly-named cities (e.g. Bale, Croatia vs Bale Mountains, Ethiopia).
  const coordStr = coords
    ? `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`
    : null;
  const countryLabel = country ?? (coordStr ? `the country at coordinates ${coordStr}` : "its country");

  const alreadyRecommended = existingTitles && existingTitles.length > 0
    ? `\n## ALREADY RECOMMENDED\nThese items exist in other sections. Do NOT repeat them or variations of them:\n${existingTitles.map((t) => `- ${t}`).join("\n")}\n`
    : "";

  return `Generate recommendations for a visitor to ${location}.${coordStr ? ` City coordinates: ${coordStr}.` : ""}

LOCATION: "${cityName}" is in ${countryLabel}.${coordStr ? ` Centre: ${coordStr}.` : ""} All results MUST be for this location only.

${sections.join("\n\n")}
${alreadyRecommended}
## RULES
1. EVERY recommendation must be in or directly around ${location}${coordStr ? ` (near ${coordStr})` : ""} — not any other "${cityName}" in another country
2. All GPS coordinates must be near ${coordStr ?? countryLabel} — reject any on the wrong continent
3. Only include places/activities you are HIGHLY confident exist and haven't closed
4. Each recommendation: 1-2 sentences, specific and actionable, not generic advice
5. No duplicates across sections. No opening hours, prices, or booking information
6. Do NOT invent venue names unless highly confident they exist at this location
7. If tied to a named landmark, include it as linkedPlace

If there is ANY doubt, remove the item.

## OUTPUT
Return ONLY a single JSON object (no reasoning, no explanation, no markdown):
${outputFields.join("\n")}`;
}

// ── Coordinate validation ────────────────────────────────────────────────────

/**
 * Validate and sanitize coordinates against basic range and proximity to city.
 * Returns undefined for both if invalid, out-of-range, or too far from city.
 */
function validateCoords(
  lat: number | undefined,
  lon: number | undefined,
  cityCoords: { lat: number; lon: number } | null | undefined,
  maxDistKm: number,
): { latitude: number | undefined; longitude: number | undefined; coordinateSource?: CoordinateSource } {
  if (lat == null || lon == null) return { latitude: undefined, longitude: undefined };
  // Basic range check
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { latitude: undefined, longitude: undefined };
  // Reject (0, 0) — almost certainly a hallucination
  if (lat === 0 && lon === 0) return { latitude: undefined, longitude: undefined };
  // Proximity check against city center
  if (cityCoords) {
    const dist = haversineKm(cityCoords.lat, cityCoords.lon, lat, lon);
    if (dist > maxDistKm) return { latitude: undefined, longitude: undefined };
  }
  return { latitude: lat, longitude: lon, coordinateSource: "ai" as CoordinateSource };
}

// ── Response parser ──────────────────────────────────────────────────────────

export function parseActivityResponse(
  raw: string,
  cityCoords?: { lat: number; lon: number } | null,
): {
  recommendations: ActivityRecommendation[];
  nearbyCities: NearbyCityRecommendation[];
  nearbyActivities: NearbyActivityRecommendation[];
  hikes: HikeRecommendation[];
  cycling: CyclingRecommendation[];
} {
  const empty = { recommendations: [] as ActivityRecommendation[], nearbyCities: [] as NearbyCityRecommendation[], nearbyActivities: [] as NearbyActivityRecommendation[], hikes: [] as HikeRecommendation[], cycling: [] as CyclingRecommendation[] };

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/gm, "").replace(/^```\s*$/gm, "").trim();

  // Try to extract JSON object from response
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: try array format (old format)
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) {
          return { ...empty, recommendations: parseRecommendationArray(parsed, cityCoords) };
        }
      } catch { /* fall through */ }
    }
    return empty;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed !== "object" || parsed === null) {
      return empty;
    }

    // Resolve alternative key names the model might use
    const recsArr = parsed.recommendations ?? parsed.must_do ?? parsed.mustDo ?? parsed.must_do_activities ?? parsed.activities;
    const nearbyCitiesArr = parsed.nearbyCities ?? parsed.nearby_cities ?? parsed.nearbyCitiesWorthVisiting;
    const nearbyActivitiesArr = parsed.nearbyActivities ?? parsed.nearby_activities ?? parsed.recommendedActivitiesNearby;
    const hikesArr = parsed.hikes ?? parsed.hikes_and_walks ?? parsed.hikesAndWalks;
    const cyclingArr = parsed.cycling ?? parsed.cycling_routes ?? parsed.cyclingRoutes;

    const recommendations = Array.isArray(recsArr)
      ? parseRecommendationArray(recsArr, cityCoords)
      : [];

    const nearbyCities = Array.isArray(nearbyCitiesArr)
      ? nearbyCitiesArr
          .filter(
            (item: unknown): item is Record<string, unknown> =>
              typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).name === "string",
          )
          .slice(0, 8)
          .map((item: Record<string, unknown>) => ({
            name: String(item.name),
            description: String(item.description ?? ""),
            distance: typeof item.distance === "string" ? item.distance : undefined,
            country: typeof item.country === "string" ? item.country : undefined,
            ...validateCoords(
              typeof item.latitude === "number" ? item.latitude : undefined,
              typeof item.longitude === "number" ? item.longitude : undefined,
              cityCoords, 500,
            ),
          }))
      : [];

    const nearbyActivities = Array.isArray(nearbyActivitiesArr)
      ? nearbyActivitiesArr
          .filter(
            (item: unknown): item is Record<string, unknown> =>
              typeof item === "object" && item !== null &&
              typeof (item as Record<string, unknown>).title === "string" &&
              !isTemplatePlaceholder(String((item as Record<string, unknown>).title)),
          )
          .slice(0, 10)
          .map((item: Record<string, unknown>) => ({
            title: String(item.title),
            description: String(item.description ?? ""),
            location: String(item.location ?? ""),
            distance: typeof item.distance === "string" ? item.distance : undefined,
            category: typeof item.category === "string" ? item.category : undefined,
            ...validateCoords(
              typeof item.latitude === "number" ? item.latitude : undefined,
              typeof item.longitude === "number" ? item.longitude : undefined,
              cityCoords, 150,
            ),
          }))
      : [];

    const hikes = Array.isArray(hikesArr)
      ? hikesArr
          .filter(
            (item: unknown): item is Record<string, unknown> =>
              typeof item === "object" && item !== null &&
              typeof (item as Record<string, unknown>).title === "string" &&
              !isTemplatePlaceholder(String((item as Record<string, unknown>).title)),
          )
          .slice(0, 8)
          .map((item: Record<string, unknown>) => ({
            title: String(item.title),
            description: String(item.description ?? ""),
            distance: typeof item.distance === "string" ? item.distance : undefined,
            duration: typeof item.duration === "string" ? item.duration : undefined,
            difficulty: typeof item.difficulty === "string" ? item.difficulty : undefined,
            startLocation: typeof item.startLocation === "string" ? item.startLocation : undefined,
            ...validateCoords(
              typeof item.latitude === "number" ? item.latitude : undefined,
              typeof item.longitude === "number" ? item.longitude : undefined,
              cityCoords, 100,
            ),
          }))
      : [];

    const cycling = Array.isArray(cyclingArr)
      ? cyclingArr
          .filter(
            (item: unknown): item is Record<string, unknown> =>
              typeof item === "object" && item !== null &&
              typeof (item as Record<string, unknown>).title === "string" &&
              !isTemplatePlaceholder(String((item as Record<string, unknown>).title)),
          )
          .slice(0, 8)
          .map((item: Record<string, unknown>) => ({
            title: String(item.title),
            description: String(item.description ?? ""),
            distance: typeof item.distance === "string" ? item.distance : undefined,
            duration: typeof item.duration === "string" ? item.duration : undefined,
            difficulty: typeof item.difficulty === "string" ? item.difficulty : undefined,
            startLocation: typeof item.startLocation === "string" ? item.startLocation : undefined,
            ...validateCoords(
              typeof item.latitude === "number" ? item.latitude : undefined,
              typeof item.longitude === "number" ? item.longitude : undefined,
              cityCoords, 100,
            ),
          }))
      : [];

    return { recommendations, nearbyCities, nearbyActivities, hikes, cycling };
  } catch {
    return empty;
  }
}

function isTemplatePlaceholder(s: string): boolean {
  const lower = s.toLowerCase().trim();
  return lower === "..." || lower === "…" || lower.startsWith("short ") || lower.startsWith("1-2 sentence") || lower.startsWith("name of ");
}

function parseRecommendationArray(
  arr: unknown[],
  cityCoords?: { lat: number; lon: number } | null,
): ActivityRecommendation[] {
  return arr
    .filter(
      (item: unknown): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).title === "string" &&
        !isTemplatePlaceholder(String((item as Record<string, unknown>).title)),
    )
    .slice(0, 15)
    .map((item) => ({
      title: String(item.title),
      description: String(item.description ?? ""),
      linkedPlace: typeof item.linkedPlace === "string" && item.linkedPlace !== "null" ? item.linkedPlace : undefined,
      category: typeof item.category === "string" ? item.category : undefined,
      ...validateCoords(
        typeof item.latitude === "number" ? item.latitude : undefined,
        typeof item.longitude === "number" ? item.longitude : undefined,
        cityCoords, 50,
      ),
    }));
}

// ── Custom section prompt & parser ──────────────────────────────────────────

/**
 * Build a prompt for a user-defined custom recommendation section.
 * The response uses the same item shape as must-do activities so they
 * render with identical cards (category badges, Add-as-POI, coordinates).
 */
export function buildCustomSectionPrompt(
  cityName: string,
  country: string | undefined,
  userPrompt: string,
  coords?: { lat: number; lon: number } | null,
  existingTitles?: string[],
): string {
  const location = country ? `${cityName}, ${country}` : cityName;
  const coordStr = coords
    ? `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`
    : null;
  const countryLabel = country ?? (coordStr ? `the country at coordinates ${coordStr}` : "its country");

  const alreadyRecommended = existingTitles && existingTitles.length > 0
    ? `\n## ALREADY RECOMMENDED\nThese items exist in other sections. Do NOT repeat them or variations of them:\n${existingTitles.map((t) => `- ${t}`).join("\n")}\n`
    : "";

  return `A user planning a trip to ${location}${coordStr ? ` (coordinates: ${coordStr})` : ""} asked:

"${userPrompt}"

LOCATION: "${cityName}" is in ${countryLabel}. All results MUST be for this location only.

Generate 5-12 specific recommendations for ${location}.
${alreadyRecommended}
## RULES
- EVERY recommendation must be in or around ${location}${coordStr ? ` (near ${coordStr})` : ""}
- Each recommendation: specific, 1-2 sentences, no generic advice
- Category for each: CULTURE, FOOD, NATURE, ENTERTAINMENT, NIGHTLIFE, SHOPPING, GROCERIES, WELLNESS, OUTDOORS, or ACCOMMODATION
- If tied to a named landmark, include linkedPlace + GPS coordinates
- No invented venue names, no hours/prices, no duplicates with other sections

Also generate a short display title (2-5 words) for the section header.

## OUTPUT
Return ONLY a JSON object (no reasoning, no explanation, no markdown):
{"title": "short title", "items": [{"title": "string", "description": "string", "linkedPlace": "string or null", "category": "string", "latitude": number or null, "longitude": number or null}]}`;
}

/** Parse the model response for a custom section into a title + items array. */
export function parseCustomSectionResponse(
  raw: string,
  cityCoords?: { lat: number; lon: number } | null,
): {
  title: string;
  items: ActivityRecommendation[];
} | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/gm, "").replace(/^```\s*$/gm, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: try to parse as an array (items only)
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) {
          const items = parseRecommendationArray(parsed, cityCoords);
          if (items.length > 0) return { title: "Custom", items };
        }
      } catch { /* fall through */ }
    }
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed !== "object" || parsed === null) return null;

    const title = typeof parsed.title === "string" && parsed.title.trim()
      ? parsed.title.trim()
      : "Custom";

    const itemsArr = parsed.items ?? parsed.recommendations ?? parsed.results;
    if (!Array.isArray(itemsArr)) return null;

    const items = parseRecommendationArray(itemsArr, cityCoords);
    if (items.length === 0) return null;

    return { title, items };
  } catch {
    return null;
  }
}
