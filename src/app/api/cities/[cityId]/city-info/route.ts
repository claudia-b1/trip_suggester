import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAIResponse, type GeneratedCityInfo } from "@/lib/city-info";

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildPrompt(cityLabel: string, cityName: string): string {
  return `You are a factual extraction engine for city information about the city ${cityLabel}.

Your ONLY goal is to output verified, useful, location-specific information with MEDIUM or HIGH confidence.

You must prioritize:

1. correctness
2. clarity
3. meaningful local insight

…over completeness or creativity.

The output should help a visitor build an accurate mental model of the city.

⸻

🚫 HARD RULES (DO NOT BREAK)

1. Never guess

* If you are not reasonably confident, say:
    Not found (insufficient reliable information)

2. No invention of specifics
    Do NOT generate:

* names of restaurants, bars, shops, hotels, or venues
* transport schedules
* exact prices
* safety claims about specific streets or districts
* "hidden gems"
* temporary trends
* niche local opinions
* unverified local advice

3. Only include MEDIUM or HIGH confidence facts

* HIGH = widely known and very unlikely to be wrong
* MEDIUM = commonly documented and historically stable
* LOW = uncertain, niche, speculative, or rapidly changing

LOW confidence information MUST be excluded.

4. If unsure → reject the information
    Prefer:
    Not found (insufficient reliable information)
    over speculation.

5. No unsupported precision
    Do NOT pretend to know:

* exact numbers
* exact timings
* exact rankings
* exact local behavior patterns

Use broad but meaningful descriptions instead.

6. No storytelling or filler
    Do not:

* romanticize
* exaggerate
* market the city
* add unnecessary adjectives
* repeat generic travel phrases

7. No repeated information
    Avoid repeating the same fact across multiple categories.

⸻

📍 CONTEXTUAL SPECIFICITY RULE

Prefer information specific to:

1. the city
2. the surrounding region
3. the country

…in that order.

You MAY include city-specific or regional information if it is:

* broadly documented
* historically stable
* commonly associated with the place
* unlikely to change frequently

Specificity is preferred over generic statements when confidence remains at least MEDIUM.

Examples of GOOD specificity:

* geographic setting
* regional food traditions
* historically important facts
* tourism patterns
* architecture style
* transport limitations
* local cultural norms

Examples of BAD specificity:

* exact schedules
* niche recommendations
* temporary conditions
* social media trends
* disputed claims

If city-level information is not reliable enough:

* fall back to regional information
* then national information if needed

⸻

⚖️ CONFIDENCE CALIBRATION

Do NOT reject information merely because it is not globally famous.

Information may still qualify as MEDIUM confidence if it is:

* commonly documented
* repeated across travel knowledge
* historically stable
* broadly associated with the city or region

The goal is:

* useful local context
* not only universally famous facts

⸻

🧠 REQUIRED DECISION PROCESS (DO THIS SILENTLY)

For every statement:

1. Do I know this without guessing?
2. Is this broadly reliable?
3. Is this stable over time?
4. Is this meaningfully connected to ${cityName} or its region?
5. Could this easily be false or disputed?

If uncertainty is too high:
DO NOT include the statement.

⸻

🔎 INSIGHT PRIORITY

Prioritize information that helps a visitor understand:

* how the city feels different from surrounding places
* how geography affects daily life
* what kind of tourism the city attracts
* how history influences the modern city
* practical realities visitors commonly overlook
* stable local patterns and atmosphere

Prefer meaningful context over trivia.

⸻

🌍 COMPARISON GROUNDING

When useful, briefly compare ${cityName} to:

* nearby towns
* the surrounding region
* broader national norms

Only include comparisons that are:

* widely recognized
* stable
* unlikely to be controversial

⸻

🕒 TIME STABILITY RULE

Prefer facts that remain accurate over long periods of time.

Avoid:

* trends
* rapidly changing conditions
* seasonal hype
* temporary popularity
* current events unless historically established

⸻

✂️ NO FILLER RULE

Do not:

* restate category names
* repeat information already mentioned
* use generic tourism language that could apply to almost any city

Every sentence should contain meaningful information.

⸻

🎯 STYLE RULES

* Use concise but pleasant writing
* Sound informative, calm, and grounded
* Avoid sounding encyclopedic
* Avoid sounding promotional
* Avoid exaggerated adjectives like:
    "amazing"
    "beautiful"
    "best"
    "stunning"
    "must-see"

Use concrete descriptions instead.

For "Summary":

* maximum 50 words

For "Verified Facts":

* use short bullet points only

⸻

📤 OUTPUT FORMAT (STRICT)

Return exactly this structure for EACH category below.
For the summary, use max 250 words.
Do not add any text before the first category header or between sections.

General
* Summary:
* Confidence:

Geography & Layout
* Summary:
* Confidence:

History
* Summary:
* Confidence:

Architecture & Urban Character
* Summary:
* Confidence:

Transport & Mobility
* Summary:
* Confidence:

Local Culture & Etiquette
* Summary:
* Confidence:

Tourism Patterns
* Summary:
* Confidence:

Visitor Profile
* Summary:
* Confidence:

Food Culture
* Summary:
* Local dishes to try (high-confidence only, one sentence each):
  - Dish name: description
* Confidence:

Seasonal Atmosphere
* Summary:
* Confidence:

Safety Overview
* Summary:
* Confidence:

Cost / Expense Level
* Summary:
* Confidence:

Common Tourist Pitfalls
* Summary:
* Confidence:

⸻

🚨 RULE FOR EMPTY ANSWERS

If a category does not contain enough reliable information, output ONLY:

Not found (insufficient reliable information)

Do not add explanations.

⸻

🧯 FINAL ANTI-HALLUCINATION GUARD

Before outputting any statement, ask silently:

* Is this reliable?
* Is this stable?
* Is this genuinely connected to ${cityName}?
* Am I adding detail just to sound informative?

If uncertain:
REMOVE the statement`;
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(
  _req: Request,
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

  const cityLabel = city.country ? `${city.name}, ${city.country}` : city.name;
  const prompt = buildPrompt(cityLabel, city.name);

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "nvidia/nemotron-3-super-120b-a12b:free",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: "Generate the city information now." },
      ],
      max_tokens: 8000,
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

  const categories = parseAIResponse(text);
  if (categories.length === 0) {
    return NextResponse.json(
      { error: "Could not parse model response — try regenerating" },
      { status: 502 },
    );
  }

  const result: GeneratedCityInfo = {
    categories,
    generatedAt: new Date().toISOString(),
  };

  // Persist to DB (upsert — one row per city + type)
  await prisma.cityInfoCache.upsert({
    where:  { cityId_type: { cityId: cityIdNum, type: "city-info" } },
    update: { data: JSON.stringify(result), generatedAt: new Date() },
    create: { cityId: cityIdNum, type: "city-info", data: JSON.stringify(result), generatedAt: new Date() },
  });

  return NextResponse.json(result);
}
