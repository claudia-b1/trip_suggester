import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";
import {
  ACTIVITY_MODEL,
  buildActivityPrompt,
  parseActivityResponse,
  type ActivityRecommendationsResult,
  type GenerateOptions,
} from "@/lib/activity-recommendations";

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
    return NextResponse.json(JSON.parse(cached.data));
  }

  return NextResponse.json({ recommendations: [], nearbyCities: [], nearbyActivities: [], hikes: [], cycling: [] });
}

/** Call OpenRouter and parse the response. Returns parsed sections or an error string. */
async function callAndParse(
  apiKey: string,
  prompt: string,
  attempt: number,
): Promise<
  | { ok: true; recommendations: ReturnType<typeof parseActivityResponse> }
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
        { role: "system", content: "You are a helpful travel advisor. Respond only with valid JSON. Do not include any explanation, reasoning, or markdown — just the raw JSON object." },
        { role: "user", content: prompt },
      ],
      max_tokens: 8000,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[activities] Attempt ${attempt}: OpenRouter HTTP error ${res.status}:`, errText.slice(0, 300));
    return { ok: false, error: `OpenRouter error (${res.status}): ${errText.slice(0, 300)}`, status: 502, retryable: true };
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (data.error) {
    console.error(`[activities] Attempt ${attempt}: OpenRouter returned error:`, data.error.message);
    return { ok: false, error: data.error.message ?? "OpenRouter returned an error", status: 502, retryable: true };
  }

  const text = data.choices?.[0]?.message?.content ?? "";

  if (!text) {
    console.error(`[activities] Attempt ${attempt}: Empty response from model. Full data:`, JSON.stringify(data).slice(0, 1000));
    return { ok: false, error: "Empty response from model", status: 502, retryable: true };
  }

  console.log(`[activities] Attempt ${attempt}: Raw model response (first 500 chars):`, text.slice(0, 500));

  const parsed = parseActivityResponse(text);
  console.log(`[activities] Attempt ${attempt}: Parsed counts — recommendations:`, parsed.recommendations.length, "nearbyCities:", parsed.nearbyCities.length, "nearbyActivities:", parsed.nearbyActivities.length, "hikes:", parsed.hikes.length, "cycling:", parsed.cycling.length);

  return { ok: true, recommendations: parsed };
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
    }
  } catch {
    // No body or invalid JSON — use defaults
  }

  const prompt = buildActivityPrompt(city.name, city.country ?? undefined, options);

  // Determine which sections were requested
  const requestedMustDo = options?.includeMustDo !== false;
  const requestedNearbyCities = options?.includeNearbyCities !== false;
  const requestedNearbyActivities = options?.includeNearbyActivities !== false;
  const requestedHikes = options?.includeHikes === true;
  const requestedCycling = options?.includeCycling === true;

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
    const result = await callAndParse(apiKey, prompt, attempt);

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
    let existing: Partial<ActivityRecommendationsResult> = {};
    const existingCache = await prisma.cityInfoCache.findFirst({
      where: { cityId: cityIdNum, type: "activities" },
    });
    if (existingCache) {
      try { existing = JSON.parse(existingCache.data); } catch { /* ignore */ }
    }

    const finalResult: ActivityRecommendationsResult = {
      recommendations: requestedMustDo ? recommendations : (existing.recommendations ?? []),
      nearbyCities: requestedNearbyCities ? nearbyCities : (existing.nearbyCities ?? []),
      nearbyActivities: requestedNearbyActivities ? nearbyActivities : (existing.nearbyActivities ?? []),
      hikes: requestedHikes ? hikes : (existing.hikes ?? []),
      cycling: requestedCycling ? cycling : (existing.cycling ?? []),
      generatedAt: new Date().toISOString(),
      model: ACTIVITY_MODEL,
    };

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
