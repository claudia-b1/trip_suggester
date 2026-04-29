import { callClaudeForPois, type GenerateInput, type RecommendedPoi } from "./_shared";

const SYSTEM = `You are an expert in local food scenes. Suggest 3 to 5 well-known food destinations in the given city: markets, food halls, iconic restaurants, or street-food districts. Favor places that are characteristic of the city. Use real places with accurate latitude and longitude. Keep each description to a single short sentence.`;

export async function generateFood({
  cityName,
}: GenerateInput): Promise<RecommendedPoi[]> {
  const raw = await callClaudeForPois(SYSTEM, `City: ${cityName}`);
  return raw.map((p) => ({ ...p, category: "FOOD" }));
}
