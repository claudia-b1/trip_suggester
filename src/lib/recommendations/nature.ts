/**
 * NATURE recommendations via OpenTripMap API.
 * Fetches parks, gardens, beaches, rivers, and natural viewpoints within
 * 15 km of the city centre, then ranks them with the scoring engine.
 */
import { geocodeCity, haversineKm, type GenerateInput, type RecommendedPoi } from "./_shared";
import { scorePoi, topN, type ScoredItem } from "./scoring";
import { withCache } from "./cache";
import { resolveApiValues } from "./subcategories";

const ALL_OTM_KINDS = [
  "natural",
  "parks",
  "gardens",
  "beaches",
  "rivers_waterfalls",
  "mountains",
  "forests",
];

const PRIMARY_KINDS = ["parks", "gardens", "natural", "beaches"];

const WIKIPEDIA_RATE_THRESHOLD = 3;

type OtmPoi = {
  xid: string;
  name: string;
  rate: number;
  kinds: string;
  point: { lon: number; lat: number };
};

function kindsToLabel(kinds: string): string {
  const map: Record<string, string> = {
    parks: "park",
    gardens: "garden",
    beaches: "beach",
    rivers_waterfalls: "riverside or waterfall",
    mountains: "mountain or hill",
    forests: "forest",
    natural: "natural area",
  };
  const first = kinds.split(",").map((k) => map[k]).find(Boolean);
  return first ?? "natural attraction";
}

export async function generateNature({ cityName, subcategories }: GenerateInput): Promise<RecommendedPoi[]> {
  if (!process.env.OPENTRIPMAP_API_KEY) return [];
  return withCache(cityName, "NATURE", "opentripmap", () => fetchNature(cityName, subcategories ?? []));
}

async function fetchNature(cityName: string, subcats: string[]): Promise<RecommendedPoi[]> {
  const apiKey = process.env.OPENTRIPMAP_API_KEY;

  const geoRes = await fetch(
    `https://api.opentripmap.com/0.1/en/places/geoname?name=${encodeURIComponent(cityName)}&apikey=${apiKey}`,
  );
  if (!geoRes.ok) throw new Error(`OTM geoname error: ${geoRes.status}`);
  const geo = (await geoRes.json()) as { lat: number; lon: number };
  const { lat, lon } = geo;

  // Filter OTM kinds based on selected subcategories
  const activeKinds = resolveApiValues("NATURE", subcats).filter((k) => ALL_OTM_KINDS.includes(k));
  const kindsParam = (activeKinds.length > 0 ? activeKinds : ALL_OTM_KINDS).join(",");

  // Nature spots can be a bit further out – use 15 km
  const url = new URL("https://api.opentripmap.com/0.1/en/places/radius");
  url.searchParams.set("radius", "15000");
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("kinds", kindsParam);
  url.searchParams.set("rate", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "100");
  url.searchParams.set("apikey", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`OTM radius error: ${res.status}`);
  const pois = (await res.json()) as OtmPoi[];

  type Candidate = ScoredItem<{ poi: OtmPoi; distanceKm: number }>;

  const scored: Candidate[] = pois
    .filter((p) => p.name?.trim())
    .map((poi) => {
      const distanceKm = haversineKm(lat, lon, poi.point.lat, poi.point.lon);
      const tags = poi.kinds.split(",");
      const _score = scorePoi({
        rating: poi.rate,
        ratingMax: 7,
        distanceKm,
        hasWikipedia: poi.rate >= WIKIPEDIA_RATE_THRESHOLD,
        tags,
        primaryTags: PRIMARY_KINDS,
      });
      return { poi, distanceKm, _score };
    });

  return topN(scored, 15).map(({ poi }) => {
    const label = kindsToLabel(poi.kinds);
    const kinds = poi.kinds.split(",");
    const DURATION: Record<string, number> = {
      parks: 60, gardens: 45, beaches: 180,
      rivers_waterfalls: 90, mountains: 240, forests: 90, natural: 60,
    };
    const duration = kinds.reduce((best, k) => DURATION[k] ?? best, 60);
    const isBeach = kinds.includes("beaches");
    const isMountain = kinds.includes("mountains") || kinds.includes("forests");
    const tipMap: Record<string, string> = {
      parks: "A morning visit avoids the midday heat and weekend crowds.",
      gardens: "Spring and early summer usually see the best blooms.",
      beaches: "Arrive before 10 AM for the best spots and cooler temperatures.",
      rivers_waterfalls: "Water levels are highest after rain — spectacular views then.",
      mountains: "Start early to be back before afternoon thunderstorms.",
      forests: "Wear sturdy shoes and bring insect repellent.",
      natural: "Stick to marked paths to protect the habitat.",
    };
    const tip = kinds.map((k) => tipMap[k]).find(Boolean) ?? "Check the weather forecast before visiting.";
    const otmRating = poi.rate > 0 ? Math.round((poi.rate / 7) * 4) + 1 : undefined;
    return {
      name: poi.name,
      category: "NATURE",
      description: `A scenic ${label} near ${cityName}.`,
      latitude: poi.point.lat,
      longitude: poi.point.lon,
      rating: otmRating,
      bestTimeToVisit: isBeach ? "afternoon" : (isMountain ? "morning" : "morning"),
      estimatedDurationMinutes: duration,
      tips: tip,
    };
  });
}
