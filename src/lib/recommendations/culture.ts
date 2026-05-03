/**
 * CULTURE recommendations via OpenTripMap API.
 * Fetches museums, historic sites, architecture, religious buildings and
 * theatres within 10 km of the city centre, then ranks them with the scoring
 * engine.  OTM's `rate` field (0–7) is the primary quality signal.
 */
import { geocodeCity, haversineKm, type GenerateInput, type RecommendedPoi } from "./_shared";
import { scorePoi, topN, type ScoredItem } from "./scoring";
import { withCache } from "./cache";
import { resolveApiValues } from "./subcategories";

const ALL_OTM_KINDS = [
  "architecture",
  "cultural",
  "historic",
  "museums",
  "religion",
  "theatres_and_entertainments",
  "monuments_and_memorials",
];

const PRIMARY_KINDS = ["museums", "historic", "architecture", "cultural", "theatres_and_entertainments"];

// OTM rate ≥4 means the place is prestigious enough to typically have a
// Wikipedia article.
const WIKIPEDIA_RATE_THRESHOLD = 4;

type OtmPoi = {
  xid: string;
  name: string;
  rate: number;
  kinds: string;
  point: { lon: number; lat: number };
};

function kindsToLabel(kinds: string): string {
  const map: Record<string, string> = {
    museums: "museum",
    architecture: "architectural landmark",
    historic: "historic site",
    monuments_and_memorials: "monument",
    religion: "religious site",
    theatres_and_entertainments: "theatre",
    cultural: "cultural site",
  };
  const first = kinds.split(",").map((k) => map[k]).find(Boolean);
  return first ?? "attraction";
}

export async function generateCulture({ cityName, subcategories }: GenerateInput): Promise<RecommendedPoi[]> {
  if (!process.env.OPENTRIPMAP_API_KEY) return [];
  return withCache(cityName, "CULTURE", "opentripmap", () => fetchCulture(cityName, subcategories ?? []));
}

async function fetchCulture(cityName: string, subcats: string[]): Promise<RecommendedPoi[]> {
  const apiKey = process.env.OPENTRIPMAP_API_KEY;

  // Step 1: geocode city via OTM's geoname endpoint (no extra API call cost)
  const geoRes = await fetch(
    `https://api.opentripmap.com/0.1/en/places/geoname?name=${encodeURIComponent(cityName)}&apikey=${apiKey}`,
  );
  if (!geoRes.ok) throw new Error(`OTM geoname error: ${geoRes.status}`);
  const geo = (await geoRes.json()) as { lat: number; lon: number };
  const { lat, lon } = geo;

  // Filter OTM kinds based on selected subcategories
  const activeKinds = resolveApiValues("CULTURE", subcats).filter((k) => ALL_OTM_KINDS.includes(k));
  const kindsParam = (activeKinds.length > 0 ? activeKinds : ALL_OTM_KINDS).join(",");

  // Step 2: fetch up to 100 candidates within 10 km
  const url = new URL("https://api.opentripmap.com/0.1/en/places/radius");
  url.searchParams.set("radius", "10000");
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("kinds", kindsParam);
  url.searchParams.set("rate", "1"); // minimum rate filter
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "100");
  url.searchParams.set("apikey", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`OTM radius error: ${res.status}`);
  const pois = (await res.json()) as OtmPoi[];

  // Step 3: also pull from a 20 km radius to capture nearby-city highlights
  const wideUrl = new URL("https://api.opentripmap.com/0.1/en/places/radius");
  wideUrl.searchParams.set("radius", "20000");
  wideUrl.searchParams.set("lon", String(lon));
  wideUrl.searchParams.set("lat", String(lat));
  wideUrl.searchParams.set("kinds", kindsParam);
  wideUrl.searchParams.set("rate", "3"); // only high-rate at wider radius
  wideUrl.searchParams.set("format", "json");
  wideUrl.searchParams.set("limit", "50");
  wideUrl.searchParams.set("apikey", apiKey);

  const wideRes = await fetch(wideUrl.toString());
  const widePois: OtmPoi[] = wideRes.ok ? ((await wideRes.json()) as OtmPoi[]) : [];

  // Merge, deduplicate by xid
  const seen = new Set<string>();
  const all: OtmPoi[] = [];
  for (const p of [...pois, ...widePois]) {
    if (p.name?.trim() && !seen.has(p.xid)) {
      seen.add(p.xid);
      all.push(p);
    }
  }

  type Candidate = ScoredItem<{ poi: OtmPoi; distanceKm: number }>;

  const scored: Candidate[] = all.map((poi) => {
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
    const isTheatre = kinds.includes("theatres_and_entertainments");
    const DURATION: Record<string, number> = {
      museums: 120, architecture: 45, historic: 60,
      monuments_and_memorials: 30, religion: 30,
      theatres_and_entertainments: 150, cultural: 60,
    };
    const duration = kinds.reduce((best, k) => DURATION[k] ?? best, 60);
    const tipMap: Record<string, string> = {
      museums: "Book tickets online in advance to skip the queue.",
      architecture: "Early morning light makes for great photos.",
      historic: "Guided tours offer much richer context than self-guided visits.",
      monuments_and_memorials: "Visit early to avoid crowds and get the best photos.",
      religion: "Dress modestly and observe any quiet hours.",
      theatres_and_entertainments: "Book seats ahead — popular shows sell out weeks in advance.",
      cultural: "Check if there are any special events or exhibitions on.",
    };
    const tip = kinds.map((k) => tipMap[k]).find(Boolean) ?? "Check opening times before your visit.";
    const otmRating = poi.rate > 0 ? Math.round((poi.rate / 7) * 4) + 1 : undefined;
    return {
      name: poi.name,
      category: "CULTURE",
      description: `A notable ${label} in ${cityName}.`,
      latitude: poi.point.lat,
      longitude: poi.point.lon,
      rating: otmRating,
      bestTimeToVisit: isTheatre ? "evening" : "morning",
      estimatedDurationMinutes: duration,
      tips: tip,
    };
  });
}
