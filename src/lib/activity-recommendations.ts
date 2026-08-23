/**
 * Activity Recommendations — prompt & model configuration
 *
 * This module separates the generation logic from the UI, making it easy to
 * swap models and iterate on prompts without touching any components.
 */

// ── Types ────────────────────────────────────────────────────────────────────

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
};

export type ActivityRecommendationsResult = {
  recommendations: ActivityRecommendation[];
  nearbyCities: NearbyCityRecommendation[];
  nearbyActivities: NearbyActivityRecommendation[];
  generatedAt: string;
  model: string;
};

/** Options controlling which sections to generate and distance limits */
export type GenerateOptions = {
  includeMustDo?: boolean;
  includeNearbyCities?: boolean;
  includeNearbyActivities?: boolean;
  maxNearbyCitiesKm?: number;
  maxNearbyActivitiesKm?: number;
};

// ── Model config ─────────────────────────────────────────────────────────────
// Change this to swap models. Any OpenRouter-compatible model ID works.

export const ACTIVITY_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

// ── Prompt builder ───────────────────────────────────────────────────────────
// Edit this function to iterate on the prompt. The UI will not change.

export function buildActivityPrompt(
  cityName: string,
  country?: string,
  options?: GenerateOptions,
): string {
  const location = country ? `${cityName}, ${country}` : cityName;
  const includeMustDo = options?.includeMustDo !== false;
  const includeNearbyCities = options?.includeNearbyCities !== false;
  const includeNearbyActivities = options?.includeNearbyActivities !== false;
  const maxCitiesKm = options?.maxNearbyCitiesKm ?? 150;
  const maxActivitiesKm = options?.maxNearbyActivitiesKm ?? 50;

  const sections: string[] = [];
  const outputFields: string[] = [];

  if (includeMustDo) {
    sections.push(`## SECTION 1: Must-do activities (5-10 items)

Focus on:
- Activities and experiences, NOT specific venues or restaurants
- Things unique to this area that you cannot do elsewhere
- Seasonal or cultural experiences worth planning around
- Outdoor activities suited to the geography
- Local customs, events, or traditions to participate in
- Food or drink experiences specific to the region (types of cuisine, local specialties to seek out)

For each recommendation, determine the best-fit category from: CULTURE, FOOD, NATURE, ENTERTAINMENT, NIGHTLIFE, SHOPPING, WELLNESS, ACCOMMODATION.

If the recommendation is tied to a specific named landmark or place, include its approximate GPS coordinates (latitude, longitude).`);

    outputFields.push(`- "recommendations": array of objects with "title" (string), "description" (string), "linkedPlace" (string or null — only for specific named landmarks), "category" (string — one of CULTURE/FOOD/NATURE/ENTERTAINMENT/NIGHTLIFE/SHOPPING/WELLNESS/ACCOMMODATION), "latitude" (number or null), "longitude" (number or null)`);
  }

  if (includeNearbyCities) {
    sections.push(`## SECTION ${includeMustDo ? "2" : "1"}: Nearby cities worth visiting (3-5 items)

Suggest nearby towns or cities that are worth a day trip or side visit from ${cityName}.
- Only include cities within approximately ${maxCitiesKm} km of ${cityName}
- Include approximate distance in km
- Include the country name
- Include approximate GPS coordinates (latitude, longitude) for each city`);

    outputFields.push(`- "nearbyCities": array of objects with "name" (string), "description" (string), "distance" (string like "~25 km"), "country" (string), "latitude" (number), "longitude" (number)`);
  }

  if (includeNearbyActivities) {
    const sectionNum = [includeMustDo, includeNearbyCities].filter(Boolean).length + 1;
    sections.push(`## SECTION ${sectionNum}: Recommended activities nearby (3-6 items)

Suggest specific activities, attractions, or experiences in the area SURROUNDING ${cityName} (within approximately ${maxActivitiesKm} km) but NOT in ${cityName} itself.
- Focus on day-trip worthy activities: scenic drives, natural wonders, historic sites, unique experiences
- Include the town or area name where the activity is located
- Include approximate distance from ${cityName}
- Include approximate GPS coordinates (latitude, longitude)
- Determine the best-fit category from: CULTURE, FOOD, NATURE, ENTERTAINMENT, NIGHTLIFE, SHOPPING, WELLNESS`);

    outputFields.push(`- "nearbyActivities": array of objects with "title" (string), "description" (string), "location" (string — the nearby town/area), "distance" (string like "~30 km"), "category" (string), "latitude" (number or null), "longitude" (number or null)`);
  }

  return `You are a concise travel advisor. Generate recommendations for a visitor to ${location}.

You MUST produce the following sections:

${sections.join("\n\n")}

## CRITICAL VERIFICATION RULES

Before including ANY recommendation, you MUST verify:

1. Is this activity/place ACTUALLY in or directly around ${cityName}? Double-check.
2. Am I confusing ${cityName} with another similarly-named city? Verify the country: ${country ?? "unknown"}.
3. Is this landmark/activity genuinely associated with ${cityName} and not a nearby but different city?
4. Re-read each recommendation one more time and ask: "Would a local from ${cityName} recognize this as being in their city?"

If there is ANY doubt, REMOVE the recommendation. Do NOT guess.

## OTHER RULES

- Each recommendation should be 1-2 sentences
- Be specific to ${location} — no generic travel advice
- If a recommendation is strongly tied to a specific named place or landmark, include it as linkedPlace
- Do NOT invent specific venue names (restaurants, hotels, bars)
- Do NOT include opening hours, prices, or booking information
- Prefer HIGH confidence facts only
- For nearby cities: only include real, well-known places that are genuinely close to ${cityName}
- GPS coordinates should be approximate but reasonable — do NOT use 0,0

## OUTPUT FORMAT

Return a single JSON object with these arrays:
${outputFields.join("\n")}

${!includeMustDo ? '- "recommendations": [] (empty array, not requested)' : ""}
${!includeNearbyCities ? '- "nearbyCities": [] (empty array, not requested)' : ""}
${!includeNearbyActivities ? '- "nearbyActivities": [] (empty array, not requested)' : ""}

Return ONLY valid JSON. No markdown code fences, no explanation text. Just the raw JSON object.`;
}

// ── Response parser ──────────────────────────────────────────────────────────

export function parseActivityResponse(raw: string): {
  recommendations: ActivityRecommendation[];
  nearbyCities: NearbyCityRecommendation[];
  nearbyActivities: NearbyActivityRecommendation[];
} {
  // Try to extract JSON object from response (model may wrap in markdown code block)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: try array format (old format)
    const arrayMatch = raw.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) {
          return {
            recommendations: parseRecommendationArray(parsed),
            nearbyCities: [],
            nearbyActivities: [],
          };
        }
      } catch { /* fall through */ }
    }
    return { recommendations: [], nearbyCities: [], nearbyActivities: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed !== "object" || parsed === null) {
      return { recommendations: [], nearbyCities: [], nearbyActivities: [] };
    }

    const recommendations = Array.isArray(parsed.recommendations)
      ? parseRecommendationArray(parsed.recommendations)
      : [];

    const nearbyCities = Array.isArray(parsed.nearbyCities)
      ? parsed.nearbyCities
          .filter(
            (item: unknown): item is Record<string, unknown> =>
              typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).name === "string",
          )
          .slice(0, 5)
          .map((item: Record<string, unknown>) => ({
            name: String(item.name),
            description: String(item.description ?? ""),
            distance: typeof item.distance === "string" ? item.distance : undefined,
            country: typeof item.country === "string" ? item.country : undefined,
            latitude: typeof item.latitude === "number" ? item.latitude : undefined,
            longitude: typeof item.longitude === "number" ? item.longitude : undefined,
          }))
      : [];

    const nearbyActivities = Array.isArray(parsed.nearbyActivities)
      ? parsed.nearbyActivities
          .filter(
            (item: unknown): item is Record<string, unknown> =>
              typeof item === "object" && item !== null &&
              typeof (item as Record<string, unknown>).title === "string" &&
              !isTemplatePlaceholder(String((item as Record<string, unknown>).title)),
          )
          .slice(0, 6)
          .map((item: Record<string, unknown>) => ({
            title: String(item.title),
            description: String(item.description ?? ""),
            location: String(item.location ?? ""),
            distance: typeof item.distance === "string" ? item.distance : undefined,
            category: typeof item.category === "string" ? item.category : undefined,
            latitude: typeof item.latitude === "number" ? item.latitude : undefined,
            longitude: typeof item.longitude === "number" ? item.longitude : undefined,
          }))
      : [];

    return { recommendations, nearbyCities, nearbyActivities };
  } catch {
    return { recommendations: [], nearbyCities: [], nearbyActivities: [] };
  }
}

function isTemplatePlaceholder(s: string): boolean {
  const lower = s.toLowerCase().trim();
  return lower === "..." || lower === "…" || lower.startsWith("short ") || lower.startsWith("1-2 sentence") || lower.startsWith("name of ");
}

function parseRecommendationArray(arr: unknown[]): ActivityRecommendation[] {
  return arr
    .filter(
      (item: unknown): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).title === "string" &&
        !isTemplatePlaceholder(String((item as Record<string, unknown>).title)),
    )
    .slice(0, 10)
    .map((item) => ({
      title: String(item.title),
      description: String(item.description ?? ""),
      linkedPlace: typeof item.linkedPlace === "string" && item.linkedPlace !== "null" ? item.linkedPlace : undefined,
      category: typeof item.category === "string" ? item.category : undefined,
      latitude: typeof item.latitude === "number" ? item.latitude : undefined,
      longitude: typeof item.longitude === "number" ? item.longitude : undefined,
    }));
}
