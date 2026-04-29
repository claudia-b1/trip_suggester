import { callClaudeForPois, type GenerateInput, type RecommendedPoi } from "./_shared";

const SYSTEM = `You are an expert in cultural attractions. Suggest 3 to 5 well-known cultural points of interest in the given city: museums, historic sites, religious buildings, monuments, theatres, or galleries. Use real places with accurate latitude and longitude. Keep each description to a single short sentence.`;

export async function generateCulture({
  cityName,
}: GenerateInput): Promise<RecommendedPoi[]> {
  const raw = await callClaudeForPois(SYSTEM, `City: ${cityName}`);
  return raw.map((p) => ({ ...p, category: "CULTURE" }));
}
