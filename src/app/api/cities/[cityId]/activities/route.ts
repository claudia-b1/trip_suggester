import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
  const { cityId } = await params;
  const cityIdNum = Number(cityId);
  if (!Number.isInteger(cityIdNum)) {
    return NextResponse.json({ error: "Invalid cityId" }, { status: 400 });
  }

  // Check for cached result in cityInfoCache (stored under a special key)
  const cached = await prisma.cityInfoCache.findFirst({
    where: { cityId: cityIdNum, type: "activities" },
  });

  if (cached) {
    return NextResponse.json(JSON.parse(cached.data));
  }

  return NextResponse.json({ recommendations: [], nearbyCities: [], nearbyActivities: [] });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const { cityId } = await params;
  const cityIdNum = Number(cityId);
  if (!Number.isInteger(cityIdNum)) {
    return NextResponse.json({ error: "Invalid cityId" }, { status: 400 });
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
    return NextResponse.json({ error: "City not found" }, { status: 404 });
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
        maxNearbyCitiesKm: body.maxNearbyCitiesKm,
        maxNearbyActivitiesKm: body.maxNearbyActivitiesKm,
      };
    }
  } catch {
    // No body or invalid JSON — use defaults
  }

  const prompt = buildActivityPrompt(city.name, city.country ?? undefined, options);

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
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `OpenRouter error (${res.status}): ${text.slice(0, 300)}` },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (data.error) {
    return NextResponse.json(
      { error: data.error.message ?? "OpenRouter returned an error" },
      { status: 502 },
    );
  }

  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) {
    return NextResponse.json({ error: "Empty response from model" }, { status: 502 });
  }

  const { recommendations, nearbyCities, nearbyActivities } = parseActivityResponse(text);
  // At least one section should have content
  if (recommendations.length === 0 && nearbyCities.length === 0 && nearbyActivities.length === 0) {
    return NextResponse.json(
      { error: "Could not parse recommendations — try again" },
      { status: 502 },
    );
  }

  const result: ActivityRecommendationsResult = {
    recommendations,
    nearbyCities,
    nearbyActivities,
    generatedAt: new Date().toISOString(),
    model: ACTIVITY_MODEL,
  };

  // Cache in database (upsert by cityId + type)
  await prisma.cityInfoCache.upsert({
    where: { cityId_type: { cityId: cityIdNum, type: "activities" } },
    update: { data: JSON.stringify(result), generatedAt: new Date() },
    create: { cityId: cityIdNum, type: "activities", data: JSON.stringify(result), generatedAt: new Date() },
  });

  return NextResponse.json(result);
}
