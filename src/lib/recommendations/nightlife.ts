import { callClaudeForPois, type GenerateInput, type RecommendedPoi } from "./_shared";

const SYSTEM = `You are an expert in nightlife. Suggest 3 to 5 well-known nightlife points of interest in the given city: bar districts, live-music venues, rooftop bars, jazz clubs, or notable late-night neighborhoods. Use real places with accurate latitude and longitude. Keep each description to a single short sentence.`;

export async function generateNightlife({
  cityName,
}: GenerateInput): Promise<RecommendedPoi[]> {
  const raw = await callClaudeForPois(SYSTEM, `City: ${cityName}`);
  return raw.map((p) => ({ ...p, category: "NIGHTLIFE" }));
}
