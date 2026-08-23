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
};

export type NearbyCityRecommendation = {
  name: string;
  description: string;
  /** Approximate distance from the main city */
  distance?: string;
};

export type ActivityRecommendationsResult = {
  recommendations: ActivityRecommendation[];
  nearbyCities: NearbyCityRecommendation[];
  generatedAt: string;
  model: string;
};

// ── Model config ─────────────────────────────────────────────────────────────
// Change this to swap models. Any OpenRouter-compatible model ID works.

export const ACTIVITY_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

// ── Prompt builder ───────────────────────────────────────────────────────────
// Edit this function to iterate on the prompt. The UI will not change.

export function buildActivityPrompt(cityName: string, country?: string): string {
  const location = country ? `${cityName}, ${country}` : cityName;

  return `You are a concise travel advisor. Generate recommendations for a visitor to ${location}.

You MUST produce TWO sections:

## SECTION 1: Must-do activities (5-10 items)

Focus on:
- Activities and experiences, NOT specific venues or restaurants
- Things unique to this area that you cannot do elsewhere
- Seasonal or cultural experiences worth planning around
- Outdoor activities suited to the geography
- Local customs, events, or traditions to participate in
- Food or drink experiences specific to the region (types of cuisine, local specialties to seek out)

## SECTION 2: Nearby cities worth visiting (3-5 items)

Suggest nearby towns or cities that are worth a day trip or side visit from ${cityName}. Include approximate distance.

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

## OUTPUT FORMAT

Return a single JSON object with two arrays:
- "recommendations": array of objects, each with "title" (string), "description" (string), "linkedPlace" (string or null)
- "nearbyCities": array of objects, each with "name" (string), "description" (string), "distance" (string like "~25 km")

Return ONLY valid JSON. No markdown code fences, no explanation text. Just the raw JSON object.`;
}

// ── Response parser ──────────────────────────────────────────────────────────

export function parseActivityResponse(raw: string): {
  recommendations: ActivityRecommendation[];
  nearbyCities: NearbyCityRecommendation[];
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
          };
        }
      } catch { /* fall through */ }
    }
    return { recommendations: [], nearbyCities: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed !== "object" || parsed === null) {
      return { recommendations: [], nearbyCities: [] };
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
          }))
      : [];

    return { recommendations, nearbyCities };
  } catch {
    return { recommendations: [], nearbyCities: [] };
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
    }));
}
