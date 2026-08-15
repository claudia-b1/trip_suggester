/**
 * NIGHTLIFE recommendations via Geoapify Places API.
 * Fetches bars, pubs, nightclubs and entertainment venues within 5 km of the
 * city centre, then ranks them with the rule-based scoring engine.
 */
import { geocodeCity, haversineKm, type GenerateInput, type RecommendedPoi } from "./_shared";
import { scorePoi, topN, type ScoredItem } from "./scoring";
import { withCache } from "./cache";
import { resolveApiValues } from "./subcategories";

const ALL_GEOAPIFY_CATEGORIES = [
  "adult.nightclub",
  "catering.bar",
  "catering.pub",
  "adult.casino",
  "entertainment.escape_game",
  "entertainment.bowling_alley",
].join(",");

const PRIMARY_TAGS = ["nightclub", "bar", "pub", "casino"];

type GeoapifyFeature = {
  properties: {
    name?: string;
    lat: number;
    lon: number;
    categories?: string[];
    rating?: number;
    datasource?: { raw?: { opening_hours?: string } };
  };
};

export async function generateNightlife({ cityName, subcategories }: GenerateInput): Promise<RecommendedPoi[]> {
  return withCache(cityName, "NIGHTLIFE", "geoapify", () => fetchNightlife(cityName, subcategories ?? []));
}

async function fetchNightlife(cityName: string, subcats: string[]): Promise<RecommendedPoi[]> {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) throw new Error("GEOAPIFY_API_KEY is not set");

  const center = await geocodeCity(cityName);

  const apiValues = resolveApiValues("NIGHTLIFE", subcats);
  const geoapifyCategories = apiValues.join(",") || ALL_GEOAPIFY_CATEGORIES;

  const url = new URL("https://api.geoapify.com/v2/places");
  url.searchParams.set("categories", geoapifyCategories);
  url.searchParams.set("filter", `circle:${center.lon},${center.lat},5000`);
  url.searchParams.set("bias", `proximity:${center.lon},${center.lat}`);
  url.searchParams.set("limit", "50");
  url.searchParams.set("apiKey", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Geoapify places error: ${res.status}`);

  const data = (await res.json()) as { features: GeoapifyFeature[] };

  type Candidate = ScoredItem<{ p: GeoapifyFeature["properties"]; distanceKm: number }>;

  const scored: Candidate[] = data.features
    .filter((f) => typeof f.properties.name === "string" && f.properties.name.trim())
    .map((f) => {
      const p = f.properties;
      const distanceKm = haversineKm(center.lat, center.lon, p.lat, p.lon);
      const tags = (p.categories ?? []).map((c) => c.split(".").pop()!);
      const _score = scorePoi({
        rating: p.rating,
        ratingMax: 5,
        distanceKm,
        tags,
        primaryTags: PRIMARY_TAGS,
      });
      return { p, distanceKm, _score };
    });

  return topN(scored, 15).map(({ p }) => {
    const kind = (p.categories?.[0] ?? "catering.bar").split(".").pop()!;
    const DURATION: Record<string, number> = {
      nightclub: 180, bar: 90, pub: 90, casino: 120, escape_game: 75, bowling_alley: 90,
    };
    const tipMap: Record<string, string> = {
      nightclub: "Dress code may apply — check in advance.",
      bar: "Happy hour is usually between 5–7 PM.",
      pub: "Try the local draught — pubs often have regional specialities.",
      casino: "Set a budget before you go in.",
      escape_game: "Book a time slot online to avoid waiting.",
      bowling_alley: "Lane hire can get busy on weekends — book ahead.",
    };
    return {
      name: p.name!,
      category: "NIGHTLIFE",
      description: `A popular ${kind.replace(/_/g, " ")} in ${cityName}.`,
      latitude: p.lat,
      longitude: p.lon,
      rating: p.rating ?? undefined,
      bestTimeToVisit: "evening",
      estimatedDurationMinutes: DURATION[kind] ?? 90,
      tips: tipMap[kind] ?? "Best experienced in the evening.",
    } satisfies RecommendedPoi;
  });
}
