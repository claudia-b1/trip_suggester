/**
 * Phase B: LLM-powered POI description generator.
 *
 * Runs in the background after Discover saves POIs. For each POI that lacks
 * an LLM description, generates a 1-2 sentence description using a free
 * OpenRouter model.
 *
 * Caching: results are stored in PoiDescriptionCache (keyed by placeId).
 * Re-running Discover reuses cached descriptions without extra API calls.
 */

import { prisma } from "@/lib/prisma";
import { searchSerper } from "@/lib/serper";

// ── Model config ─────────────────────────────────────────────────────────────
// Fast free model for description generation. Change to swap models.
const DESCRIPTION_MODEL = "nex-agi/nex-n2.5-mini:free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const BATCH_SIZE = 8; // POIs per LLM call (model uses reasoning tokens, keep batches moderate)

type PoiForDescription = {
  id: number;
  name: string;
  placeId: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  rating: number | null;
  userRatingCount: number | null;
  extraFields: Record<string, unknown> | null;
};

type LlmResult = {
  id: number;
  description: string | null;
};

/**
 * Generate LLM descriptions for all POIs in a city that don't have one yet.
 * Returns the number of descriptions generated.
 */
export async function generatePoiDescriptions(
  cityId: number,
  cityName: string,
  countryName?: string,
): Promise<{ processed: number; cached: number; generated: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { processed: 0, cached: 0, generated: 0 };

  // 1. Find POIs needing descriptions
  const pois = await prisma.poi.findMany({
    where: {
      cityId,
      llmDescription: null,
      placeId: { not: null },
    },
    select: {
      id: true,
      name: true,
      placeId: true,
      category: true,
      subcategory: true,
      description: true,
      rating: true,
      userRatingCount: true,
      extraFields: true,
    },
  });

  if (pois.length === 0) return { processed: 0, cached: 0, generated: 0 };

  const validPois: PoiForDescription[] = pois
    .filter((p): p is typeof p & { placeId: string } => p.placeId != null)
    .map((p) => ({
      ...p,
      extraFields: p.extraFields as Record<string, unknown> | null,
    }));

  let cached = 0;
  let generated = 0;
  const uncachedPois: PoiForDescription[] = [];

  // 2. Check cache first
  const placeIds = validPois.map((p) => p.placeId);
  const cachedEntries = await prisma.poiDescriptionCache.findMany({
    where: { placeId: { in: placeIds } },
  });
  const cacheMap = new Map(cachedEntries.map((c) => [c.placeId, c]));

  for (const poi of validPois) {
    const hit = cacheMap.get(poi.placeId);
    if (hit) {
      // Apply cached result to POI
      if (hit.description) {
        await prisma.poi.update({
          where: { id: poi.id },
          data: { llmDescription: hit.description },
        });
      }
      cached++;
    } else {
      uncachedPois.push(poi);
    }
  }

  // 3. Generate descriptions for uncached POIs in batches
  for (let i = 0; i < uncachedPois.length; i += BATCH_SIZE) {
    const batch = uncachedPois.slice(i, i + BATCH_SIZE);
    try {
      const results = await generateBatch(batch, cityName, countryName, apiKey);
      const respondedIds = new Set<number>();

      for (const result of results) {
        const poi = batch.find((p) => p.id === result.id);
        if (!poi) continue;
        respondedIds.add(poi.id);

        // Write to cache
        await prisma.poiDescriptionCache.upsert({
          where: { placeId: poi.placeId },
          create: {
            placeId: poi.placeId,
            description: result.description,
          },
          update: {
            description: result.description,
            generatedAt: new Date(),
          },
        });

        // Update POI
        if (result.description) {
          await prisma.poi.update({
            where: { id: poi.id },
            data: { llmDescription: result.description },
          });
          generated++;
        }
      }

      // Cache null for POIs the LLM omitted entirely (low confidence) so
      // they aren't retried on every run.
      for (const poi of batch) {
        if (!respondedIds.has(poi.id)) {
          await prisma.poiDescriptionCache.upsert({
            where: { placeId: poi.placeId },
            create: { placeId: poi.placeId, description: null },
            update: {}, // already cached — don't overwrite
          });
        }
      }
    } catch (err) {
      console.error(`[poi-descriptions] batch ${i / BATCH_SIZE + 1} failed:`, err);
      // Continue with next batch — don't let one failure block the rest
    }
  }

  console.log(
    `[poi-descriptions] city=${cityName} total=${validPois.length} cached=${cached} generated=${generated}`,
  );

  return { processed: validPois.length, cached, generated };
}

/**
 * Generate descriptions for a batch of POIs via the LLM.
 */
async function generateBatch(
  pois: PoiForDescription[],
  cityName: string,
  countryName: string | undefined,
  apiKey: string,
): Promise<LlmResult[]> {
  // Fetch Serper snippets (currently disabled — returns [])
  const snippets = await Promise.all(
    pois.map(async (poi) => {
      const results = await searchSerper(`${poi.name} ${cityName}`);
      return results.map((r) => r.snippet).join(" ").slice(0, 300);
    }),
  );

  const location = countryName ? `${cityName}, ${countryName}` : cityName;

  // Build the prompt
  const poiLines = pois.map((poi, i) => {
    const parts = [`ID=${poi.id}, "${poi.name}", category=${poi.category}`];
    if (poi.subcategory) parts.push(`subcategory=${poi.subcategory}`);
    const cuisine = poi.extraFields?.cuisine;
    if (typeof cuisine === "string") parts.push(`cuisine=${cuisine}`);
    const placeCategory = poi.extraFields?.placeCategory;
    if (typeof placeCategory === "string") parts.push(`type=${placeCategory}`);
    if (poi.rating != null) parts.push(`rating=${poi.rating}`);
    if (poi.userRatingCount != null) parts.push(`reviews=${poi.userRatingCount}`);
    if (snippets[i]) parts.push(`\n   Web info: ${snippets[i]}`);
    return `${i + 1}. ${parts.join(", ")}`;
  });

  const prompt = `You are a knowledgeable travel writer. For each place listed below in ${location}, write a brief, factual description (1-2 sentences).

RULES:
- Only write a description if you are confident you know what this place is. If unsure, return null for that place.
- Descriptions should be informative and specific to THIS place — not generic category descriptions.
- Mention what makes the place notable, what type of experience it offers, or what it's known for.
- Do NOT repeat the place name in the description.
- Do NOT mention the rating or review count.
- Keep each description under 40 words.

Return ONLY a valid JSON array, one entry per place, in this exact format:
[{"id": <number>, "description": "<string or null>"}]

Places:
${poiLines.join("\n")}`;

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DESCRIPTION_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 8000,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return [];

  // Parse JSON from the response (handle markdown code fences)
  const jsonStr = content.replace(/^```json?\n?/i, "").replace(/\n?```$/i, "").trim();
  try {
    const parsed = JSON.parse(jsonStr) as Array<{ id: number; description: string | null }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r) => typeof r.id === "number")
      .map((r) => ({
        id: r.id,
        description: typeof r.description === "string" && r.description.trim()
          ? r.description.trim()
          : null,
      }));
  } catch {
    console.error("[poi-descriptions] Failed to parse LLM response:", jsonStr.slice(0, 500));
    return [];
  }
}
