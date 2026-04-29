import { callClaudeForPois, type GenerateInput, type RecommendedPoi } from "./_shared";

const SYSTEM = `You are an expert in urban green space and nature. Suggest 3 to 5 well-known nature points of interest in or near the given city: parks, gardens, riversides, beaches, lakes, or scenic viewpoints. Prefer places accessible without long-distance travel. Use real places with accurate latitude and longitude. Keep each description to a single short sentence.`;

export async function generateNature({
  cityName,
}: GenerateInput): Promise<RecommendedPoi[]> {
  const raw = await callClaudeForPois(SYSTEM, `City: ${cityName}`);
  return raw.map((p) => ({ ...p, category: "NATURE" }));
}
