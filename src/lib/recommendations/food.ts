/**
 * FOOD recommendations via Geoapify Places API.
 * Fetches restaurants, cafés, bakeries and food courts within 5 km of the city
 * centre, then ranks them with the rule-based scoring engine.
 */
import { geocodeCity, haversineKm, type GenerateInput, type RecommendedPoi } from "./_shared";
import { scorePoi, topN, type ScoredItem } from "./scoring";
import { withCache } from "./cache";
import { resolveApiValues, resolveSpecialFlags } from "./subcategories";

const ALL_GEOAPIFY_CATEGORIES = [
  "catering.restaurant",
  "catering.cafe",
  "catering.fast_food",
  "catering.food_court",
  "catering.ice_cream",
  "commercial.food_and_drink.bakery",
].join(",");

// Tags matched against Geoapify category leaf names for the category-match score
const PRIMARY_TAGS = ["restaurant", "cafe", "bakery", "food_court", "fast_food"];

type GeoapifyFeature = {
  properties: {
    name?: string;
    lat: number;
    lon: number;
    categories?: string[];
    rating?: number;
    datasource?: { raw?: { cuisine?: string } };
  };
};

export async function generateFood({ cityName, subcategories, cuisineFilter }: GenerateInput): Promise<RecommendedPoi[]> {
  return withCache(cityName, "FOOD", "geoapify", () => fetchFood(cityName, subcategories ?? [], cuisineFilter));
}

async function fetchFood(cityName: string, subcats: string[], cuisineFilter?: string): Promise<RecommendedPoi[]> {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) throw new Error("GEOAPIFY_API_KEY is not set");

  const center = await geocodeCity(cityName);

  // Resolve which Geoapify categories to fetch based on selected subcategories
  const specials = resolveSpecialFlags("FOOD", subcats);
  const apiValues = resolveApiValues("FOOD", subcats);
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
  let features = data.features.filter((f) => typeof f.properties.name === "string" && f.properties.name.trim());

  // Post-fetch filters for special subcategories
  if (specials.has("vegetarian")) {
    features = features.filter((f) => {
      const cuisine = (f.properties.datasource?.raw?.cuisine ?? "").toLowerCase();
      return cuisine.includes("vegetarian") || cuisine.includes("vegan");
    });
  }
  if (specials.has("fine_dining") && !specials.has("vegetarian")) {
    features = features.filter((f) => (f.properties.rating ?? 0) >= 4);
  }
  if (cuisineFilter) {
    const cfl = cuisineFilter.toLowerCase();
    features = features.filter((f) => {
      const cuisine = (f.properties.datasource?.raw?.cuisine ?? "").toLowerCase();
      return cuisine.includes(cfl);
    });
  }

  // PRIMARY_TAGS for scoring — derived from active api values
  const PRIMARY_TAGS = ["restaurant", "cafe", "bakery", "food_court", "fast_food"];

  type Candidate = ScoredItem<{ p: GeoapifyFeature["properties"]; distanceKm: number }>;

  const scored: Candidate[] = features
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
    const cuisine = p.datasource?.raw?.cuisine;
    const kind = (p.categories?.[0] ?? "catering.restaurant").split(".").pop()!;
    const description = cuisine
      ? `A ${cuisine} ${kind.replace(/_/g, " ")} in ${cityName}.`
      : `A popular ${kind.replace(/_/g, " ")} in ${cityName}.`;

    const DURATION: Record<string, number> = {
      restaurant: 75, cafe: 45, fast_food: 20, food_court: 45, bakery: 20, ice_cream: 15,
    };
    const isMorningKind = kind === "cafe" || kind === "bakery" || kind === "ice_cream";
    const tipMap: Record<string, string> = {
      restaurant: "Book ahead for dinner — popular spots fill up fast.",
      cafe: "Great spot for a slow morning with coffee and a book.",
      bakery: "Arrive early for the freshest pastries.",
      fast_food: "Quick and filling — ideal between sightseeing stops.",
      food_court: "Lots of variety, perfect for groups with mixed tastes.",
      ice_cream: "A sweet treat after a long day of exploring.",
    };

    return {
      name: p.name!,
      category: "FOOD",
      description,
      latitude: p.lat,
      longitude: p.lon,
      rating: p.rating ?? undefined,
      bestTimeToVisit: isMorningKind ? "morning" : "afternoon",
      estimatedDurationMinutes: DURATION[kind] ?? 45,
      tips: tipMap[kind] ?? "Check opening hours before visiting.",
    } satisfies RecommendedPoi;
  });
}
