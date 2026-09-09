import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";
import {
  ACTIVITY_MODEL,
  buildActivityPrompt,
  buildCustomSectionPrompt,
  parseActivityResponse,
  parseCustomSectionResponse,
  type ActivityRecommendationsResult,
  type GenerateOptions,
  type CustomRecommendationSection,
} from "@/lib/activity-recommendations";
import {
  collectExistingTitles,
  redistributeMustDoItems,
  deduplicateAcrossSections,
} from "@/lib/activity-dedup";
import {
  resolveActivityCoordinates,
  resolveCustomSectionCoordinates,
} from "@/lib/activity-geocode";

/** Check if any recommendation items have coordinates but no coordinateSource
 *  (indicating they were cached before the coordinate resolution pipeline). */
function hasUnresolvedCoordinates(data: ActivityRecommendationsResult): boolean {
  const check = (items: Array<{ latitude?: number; longitude?: number; coordinateSource?: string }>) =>
    items.some((i) => i.latitude != null && i.longitude != null && !i.coordinateSource);
  if (check(data.recommendations)) return true;
  if (check(data.nearbyActivities)) return true;
  if (check(data.hikes)) return true;
  if (check(data.cycling)) return true;
  if (check(data.nearbyCities)) return true;
  if (data.customSections?.some((s) => check(s.items))) return true;
  return false;
}

/** DELETE /api/cities/[cityId]/activities — clear cached activity recommendations */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  const cityIdNum = Number(cityId);
  if (!Number.isInteger(cityIdNum)) {
    return NextResponse.json({ error: "Invalid cityId" }, { status: 400 });
  }

  if (!await verifyCityOwnership(cityIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete cached activities entry
  await prisma.cityInfoCache.deleteMany({
    where: { cityId: cityIdNum, type: "activities" },
  });

  return NextResponse.json({ deleted: true });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  const cityIdNum = Number(cityId);
  if (!Number.isInteger(cityIdNum)) {
    return NextResponse.json({ error: "Invalid cityId" }, { status: 400 });
  }

  if (!await verifyCityOwnership(cityIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Check for cached result in cityInfoCache (stored under a special key)
  const cached = await prisma.cityInfoCache.findFirst({
    where: { cityId: cityIdNum, type: "activities" },
  });

  if (cached) {
    const data = JSON.parse(cached.data) as ActivityRecommendationsResult;

    // One-time migration: resolve coordinates for cached data that predates
    // the coordinate resolution pipeline. Check if any item lacks coordinateSource.
    const needsResolution = hasUnresolvedCoordinates(data);
    if (needsResolution) {
      const city = await prisma.city.findUnique({ where: { id: cityIdNum } });
      if (city?.latitude != null && city?.longitude != null) {
        const cityCoords = { lat: city.latitude, lon: city.longitude };
        try {
          const stats = await resolveActivityCoordinates(
            data, cityIdNum, city.name, city.country ?? undefined, cityCoords,
          );
          // Also resolve custom sections
          if (data.customSections) {
            for (const section of data.customSections) {
              await resolveCustomSectionCoordinates(
                section.items, cityIdNum, city.name, city.country ?? undefined, cityCoords,
              );
            }
          }
          console.log(`[activities] Migrated cached coordinates for ${city.name}: ${stats.poiMatched} POI-matched, ${stats.geocoded} geocoded, ${stats.failed} failed`);
          // Re-cache with resolved coordinates
          await prisma.cityInfoCache.update({
            where: { id: cached.id },
            data: { data: JSON.stringify(data) },
          });
        } catch (err) {
          console.error("[activities] Cached coordinate migration failed (non-blocking):", err);
        }
      }
    }

    return NextResponse.json(data);
  }

  return NextResponse.json({ recommendations: [], nearbyCities: [], nearbyActivities: [], hikes: [], cycling: [], customSections: [] });
}

/** Call OpenRouter with streaming, accumulate server-side, then parse.
 *  Streaming often bypasses OpenRouter's queue faster than non-streaming requests. */
async function callAndParse(
  apiKey: string,
  prompt: string,
  attempt: number,
  cityCoords?: { lat: number; lon: number } | null,
): Promise<
  | { ok: true; recommendations: ReturnType<typeof parseActivityResponse>; rawText: string }
  | { ok: false; error: string; status: number; retryable: boolean; rawText?: string }
> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ACTIVITY_MODEL,
      messages: [
        { role: "system", content: "You are a travel advisor. Output ONLY raw JSON. No thinking, no reasoning, no explanation, no markdown fences, no preamble. Start your response with { and end with }." },
        { role: "user", content: prompt },
      ],
      max_tokens: 16000,
      temperature: 0.5,
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[activities] Attempt ${attempt}: OpenRouter HTTP error ${res.status}:`, errText.slice(0, 300));
    return { ok: false, error: `OpenRouter error (${res.status}): ${errText.slice(0, 300)}`, status: 502, retryable: true };
  }

  // Accumulate streamed tokens server-side into a single string
  const decoder = new TextDecoder();
  const reader = res.body?.getReader();
  if (!reader) {
    return { ok: false, error: "No response body from OpenRouter", status: 502, retryable: true };
  }

  let text = "";
  let sseBuffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
            error?: { message?: string };
          };
          if (parsed.error) {
            console.error(`[activities] Attempt ${attempt}: OpenRouter stream error:`, parsed.error.message);
            return { ok: false, error: parsed.error.message ?? "OpenRouter stream error", status: 502, retryable: true };
          }
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) text += content;
        } catch {
          // Skip unparseable SSE chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!text) {
    console.error(`[activities] Attempt ${attempt}: Empty response from model (streaming).`);
    return { ok: false, error: "Empty response from model", status: 502, retryable: true };
  }

  console.log(`[activities] Attempt ${attempt}: Raw model response (first 500 chars):`, text.slice(0, 500));

  const parsed = parseActivityResponse(text, cityCoords);
  console.log(`[activities] Attempt ${attempt}: Parsed counts — recommendations:`, parsed.recommendations.length, "nearbyCities:", parsed.nearbyCities.length, "nearbyActivities:", parsed.nearbyActivities.length, "hikes:", parsed.hikes.length, "cycling:", parsed.cycling.length);

  return { ok: true, recommendations: parsed, rawText: text };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  const cityIdNum = Number(cityId);
  if (!Number.isInteger(cityIdNum)) {
    return NextResponse.json({ error: "Invalid cityId" }, { status: 400 });
  }

  if (!await verifyCityOwnership(cityIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured" },
      { status: 500 },
    );
  }

  const city = await prisma.city.findUnique({ where: { id: cityIdNum } });
  if (!city) {
    return NextResponse.json({ error: "Destination not found" }, { status: 404 });
  }

  // Parse optional generation options from request body
  let options: GenerateOptions | undefined;
  let customPrompt: string | undefined;
  let customSectionId: string | undefined; // for regeneration — replace existing section
  try {
    const body = await req.json();
    if (body && typeof body === "object") {
      options = {
        includeMustDo: body.includeMustDo,
        includeNearbyCities: body.includeNearbyCities,
        includeNearbyActivities: body.includeNearbyActivities,
        includeHikes: body.includeHikes,
        includeCycling: body.includeCycling,
        maxNearbyCitiesKm: body.maxNearbyCitiesKm,
        maxNearbyActivitiesKm: body.maxNearbyActivitiesKm,
      };
      if (typeof body.customPrompt === "string" && body.customPrompt.trim()) {
        customPrompt = body.customPrompt.trim();
      }
      if (typeof body.customSectionId === "string" && body.customSectionId.trim()) {
        customSectionId = body.customSectionId.trim();
      }
    }
  } catch {
    // No body or invalid JSON — use defaults
  }

  // ── Custom section generation ──────────────────────────────────────
  if (customPrompt) {
    const customCoords = city.latitude != null && city.longitude != null
      ? { lat: city.latitude, lon: city.longitude }
      : null;

    // Read existing cache to inject titles for dedup
    let existingForCustom: Partial<ActivityRecommendationsResult> = {};
    const existingCacheForCustom = await prisma.cityInfoCache.findFirst({
      where: { cityId: cityIdNum, type: "activities" },
    });
    if (existingCacheForCustom) {
      try { existingForCustom = JSON.parse(existingCacheForCustom.data); } catch { /* ignore */ }
    }
    const existingTitles = collectExistingTitles(existingForCustom, undefined, customSectionId ?? undefined);

    const customModelPrompt = buildCustomSectionPrompt(city.name, city.country ?? undefined, customPrompt, customCoords, existingTitles);

    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await callAndParse(apiKey, customModelPrompt, attempt, customCoords);
      if (!result.ok) {
        if (!result.retryable || attempt === MAX_ATTEMPTS) {
          return NextResponse.json({ error: result.error }, { status: result.status });
        }
        continue;
      }

      // The model returns JSON with a "title" and "items" array — parse it
      const rawText = result.rawText ?? "";
      const parsed = parseCustomSectionResponse(rawText, customCoords);
      if (!parsed || parsed.items.length === 0) {
        if (attempt < MAX_ATTEMPTS) continue;
        return NextResponse.json({ error: "Could not parse custom recommendations — try again" }, { status: 502 });
      }

      // Resolve coordinates for custom section items
      if (customCoords) {
        try {
          await resolveCustomSectionCoordinates(
            parsed.items, cityIdNum, city.name, city.country ?? undefined, customCoords,
          );
        } catch (err) {
          console.error("[activities] Custom section coordinate resolution failed (non-blocking):", err);
        }
      }

      // Build the new section
      const sectionId = customSectionId ?? `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newSection: CustomRecommendationSection = {
        id: sectionId,
        prompt: customPrompt,
        title: parsed.title,
        items: parsed.items,
      };

      const existingCustom = Array.isArray(existingForCustom.customSections) ? existingForCustom.customSections : [];
      // If regenerating, replace existing section with same ID; otherwise append
      const updatedCustom = customSectionId
        ? existingCustom.map((s) => s.id === customSectionId ? newSection : s)
        : [...existingCustom, newSection];

      const merged: ActivityRecommendationsResult = {
        recommendations: existingForCustom.recommendations ?? [],
        nearbyCities: existingForCustom.nearbyCities ?? [],
        nearbyActivities: existingForCustom.nearbyActivities ?? [],
        hikes: existingForCustom.hikes ?? [],
        cycling: existingForCustom.cycling ?? [],
        customSections: updatedCustom,
        generatedAt: new Date().toISOString(),
        model: ACTIVITY_MODEL,
      };

      // Deduplicate across all sections
      const finalResult = deduplicateAcrossSections(merged);

      await prisma.cityInfoCache.upsert({
        where: { cityId_type: { cityId: cityIdNum, type: "activities" } },
        update: { data: JSON.stringify(finalResult), generatedAt: new Date() },
        create: { cityId: cityIdNum, type: "activities", data: JSON.stringify(finalResult), generatedAt: new Date() },
      });

      return NextResponse.json(finalResult);
    }

    return NextResponse.json({ error: "Could not generate custom recommendations" }, { status: 502 });
  }

  // ── Standard section generation ────────────────────────────────────
  const cityCoords = city.latitude != null && city.longitude != null
    ? { lat: city.latitude, lon: city.longitude }
    : null;

  // Determine which sections were requested
  const requestedMustDo = options?.includeMustDo !== false;
  const requestedNearbyCities = options?.includeNearbyCities !== false;
  const requestedNearbyActivities = options?.includeNearbyActivities !== false;
  const requestedHikes = options?.includeHikes === true;
  const requestedCycling = options?.includeCycling === true;

  // Read existing cache BEFORE the LLM call — needed for both
  // prompt-level dedup (inject existing titles) and post-generation merge.
  let existing: Partial<ActivityRecommendationsResult> = {};
  const existingCache = await prisma.cityInfoCache.findFirst({
    where: { cityId: cityIdNum, type: "activities" },
  });
  if (existingCache) {
    try { existing = JSON.parse(existingCache.data); } catch { /* ignore */ }
  }

  // Determine which section is being regenerated (if any) for prompt-level dedup.
  // When regenerating a single section, inject titles from all OTHER sections so
  // the LLM avoids repeating them.
  const requestedSections = [requestedMustDo, requestedNearbyCities, requestedNearbyActivities, requestedHikes, requestedCycling];
  const singleSectionRegen = requestedSections.filter(Boolean).length === 1;
  let existingTitles: string[] | undefined;
  if (singleSectionRegen && existingCache) {
    const excludeSection = requestedMustDo ? "mustDo" as const
      : requestedNearbyCities ? "nearbyCities" as const
      : requestedNearbyActivities ? "nearbyActivities" as const
      : requestedHikes ? "hikes" as const
      : "cycling" as const;
    existingTitles = collectExistingTitles(existing, excludeSection);
  }

  const prompt = buildActivityPrompt(city.name, city.country ?? undefined, options, cityCoords, existingTitles);

  function hasRequestedContent(parsed: ReturnType<typeof parseActivityResponse>): boolean {
    const results: boolean[] = [];
    if (requestedMustDo) results.push(parsed.recommendations.length > 0);
    if (requestedNearbyCities) results.push(parsed.nearbyCities.length > 0);
    if (requestedNearbyActivities) results.push(parsed.nearbyActivities.length > 0);
    if (requestedHikes) results.push(parsed.hikes.length > 0);
    if (requestedCycling) results.push(parsed.cycling.length > 0);
    return results.length === 0 || results.some(Boolean);
  }

  // Try up to 2 times (initial + 1 retry) if parsing fails
  const MAX_ATTEMPTS = 2;
  let lastError = "Could not parse recommendations — try again";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await callAndParse(apiKey, prompt, attempt, cityCoords);

    if (!result.ok) {
      lastError = result.error;
      if (!result.retryable || attempt === MAX_ATTEMPTS) {
        return NextResponse.json({ error: lastError }, { status: result.status });
      }
      console.log(`[activities] Retrying (attempt ${attempt + 1})...`);
      continue;
    }

    const { recommendations, nearbyCities, nearbyActivities, hikes, cycling } = result.recommendations;

    if (!hasRequestedContent(result.recommendations)) {
      console.error(`[activities] Attempt ${attempt}: All requested sections came back empty.`);
      if (attempt < MAX_ATTEMPTS) {
        console.log(`[activities] Retrying (attempt ${attempt + 1})...`);
        continue;
      }
      return NextResponse.json(
        { error: "Could not parse recommendations — try again" },
        { status: 502 },
      );
    }

    // Success — merge with existing cache: keep non-requested sections unchanged
    const merged: ActivityRecommendationsResult = {
      recommendations: requestedMustDo ? recommendations : (existing.recommendations ?? []),
      nearbyCities: requestedNearbyCities ? nearbyCities : (existing.nearbyCities ?? []),
      nearbyActivities: requestedNearbyActivities ? nearbyActivities : (existing.nearbyActivities ?? []),
      hikes: requestedHikes ? hikes : (existing.hikes ?? []),
      cycling: requestedCycling ? cycling : (existing.cycling ?? []),
      customSections: Array.isArray(existing.customSections) ? existing.customSections : [],
      generatedAt: new Date().toISOString(),
      model: ACTIVITY_MODEL,
    };

    // Redistribute must-do items to hikes/cycling, then deduplicate across sections
    const redistributed = redistributeMustDoItems(merged);

    // Resolve coordinates: match against existing POIs, then geocode remaining items
    if (cityCoords) {
      try {
        const geoStats = await resolveActivityCoordinates(
          redistributed, cityIdNum, city.name, city.country ?? undefined, cityCoords,
        );
        console.log(`[activities] Coordinate resolution: ${geoStats.poiMatched} POI-matched, ${geoStats.geocoded} geocoded, ${geoStats.failed} failed, ${geoStats.skipped} skipped`);
      } catch (err) {
        console.error("[activities] Coordinate resolution failed (non-blocking):", err);
      }
    }

    const finalResult = deduplicateAcrossSections(redistributed);

    // Cache in database (upsert by cityId + type)
    await prisma.cityInfoCache.upsert({
      where: { cityId_type: { cityId: cityIdNum, type: "activities" } },
      update: { data: JSON.stringify(finalResult), generatedAt: new Date() },
      create: { cityId: cityIdNum, type: "activities", data: JSON.stringify(finalResult), generatedAt: new Date() },
    });

    return NextResponse.json(finalResult);
  }

  // Should not reach here, but just in case
  return NextResponse.json({ error: lastError }, { status: 502 });
}
