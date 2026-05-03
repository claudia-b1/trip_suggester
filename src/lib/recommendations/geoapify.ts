/**
 * Geoapify Places API — Primary discovery layer.
 *
 * Free plan: 3,000 credits/day. Each 20 places = 1 credit → ~60,000 places/day.
 * No extra API key needed — uses the existing GEOAPIFY_API_KEY.
 *
 * Docs: https://apidocs.geoapify.com/docs/places/
 * Note: filter uses lon,lat order (GeoJSON convention).
 */
import type { RecommendableCategory } from "./index";
import { geocodeCity } from "./_shared";

const GEOAPIFY_BASE = "https://api.geoapify.com/v2/places";

// ─── Category mappings ────────────────────────────────────────────────────────

const CATEGORY_CATEGORIES: Record<RecommendableCategory, string> = {
  CULTURE:   "entertainment.museum,entertainment.culture,tourism.sights.memorial,tourism.sights.castle,tourism.sights.fort,tourism.sights.ruines,tourism.sights.archaeological_site,tourism.sights.place_of_worship,heritage,building.historic",
  FOOD:      "catering.restaurant,catering.cafe,catering.fast_food,catering.ice_cream",
  NATURE:    "leisure.park,natural.forest,natural.water,natural.mountain,national_park,beach,leisure.park.garden,leisure.park.nature_reserve",
  NIGHTLIFE: "catering.bar,adult.nightclub,adult.casino,entertainment.cinema",
  OUTDOORS:  "tourism.attraction.viewpoint,sport.stadium,entertainment.theme_park,entertainment.zoo,entertainment.aquarium,entertainment.water_park,entertainment.activity_park",
};

const SUBCAT_CATEGORIES: Record<string, string> = {
  // CULTURE
  museums:       "entertainment.museum",
  art:           "entertainment.culture.gallery",
  historic:      "tourism.sights.castle,tourism.sights.fort,tourism.sights.ruines,tourism.sights.archaeological_site,tourism.sights.memorial",
  architecture:  "tourism.sights.tower,building.historic,tourism.sights.bridge",
  religion:      "tourism.sights.place_of_worship,religion.place_of_worship",
  theatre:       "entertainment.culture.theatre,entertainment.cinema",
  // FOOD
  restaurant:    "catering.restaurant",
  fine_dining:   "catering.restaurant",
  cafe:          "catering.cafe",
  fast_food:     "catering.fast_food",
  vegetarian:    "catering.restaurant",
  bakery:        "commercial.food_and_drink.bakery,catering.cafe",
  ice_cream:     "catering.ice_cream,catering.cafe.ice_cream,commercial.food_and_drink.ice_cream",
  // NATURE
  parks:         "leisure.park,leisure.park.garden",
  beaches:       "beach",
  mountains:     "natural.mountain",
  water:         "natural.water",
  reserves:      "leisure.park.nature_reserve,natural.protected_area",
  // NIGHTLIFE
  bars:          "catering.bar",
  clubs:         "adult.nightclub",
  entertainment: "entertainment.cinema,entertainment.bowling_alley,entertainment.amusement_arcade",
  casino:        "adult.casino",
  // OUTDOORS
  viewpoints:    "tourism.attraction.viewpoint",
  sport:         "sport.sports_centre,sport.stadium",
  amusements:    "entertainment.theme_park,entertainment.activity_park",
  water_parks:   "entertainment.water_park",
  zoos:          "entertainment.zoo,entertainment.aquarium",
  national_parks:"national_park,leisure.park.nature_reserve",
};

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape returned by the Geoapify discovery layer. */
export type DiscoveredPlace = {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  placeCategory: string;
  sourceRating?: number;
  priceLevel?: number;
  description?: string;
  tel?: string;
  website?: string;
  openingHours?: string;
  photoUrl?: string;
  address?: string;
};

// Raw Geoapify Places feature shape
type GeoFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    place_id?: string;
    name?: string;
    lat?: number;
    lon?: number;
    categories?: string[];
    formatted?: string;
    address_line1?: string;
    website?: string;
    opening_hours?: string;
    phone?: string;
    datasource?: {
      raw?: {
        name?: string;
        website?: string;
        phone?: string;
        opening_hours?: string;
        "addr:street"?: string;
        "addr:housenumber"?: string;
      };
    };
  };
};

// ─── Public API ───────────────────────────────────────────────────────────────

export async function searchPlaces(
  cityName: string,
  category: RecommendableCategory,
  subcategoryIds: string[],
  limit = 50,
): Promise<DiscoveredPlace[]> {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) throw new Error("GEOAPIFY_API_KEY is not set");

  const center = await geocodeCity(cityName);

  // Build category param
  let categories: string;
  if (subcategoryIds.length > 0) {
    const resolved = subcategoryIds
      .map((id) => SUBCAT_CATEGORIES[id])
      .filter(Boolean)
      .join(",");
    categories = resolved || CATEGORY_CATEGORIES[category];
  } else {
    categories = CATEGORY_CATEGORIES[category];
  }

  // Conditions for special subcategories
  const conditions: string[] = [];
  if (subcategoryIds.includes("vegetarian")) conditions.push("vegetarian");

  const url = new URL(GEOAPIFY_BASE);
  url.searchParams.set("categories", categories);
  // Geoapify filter uses lon,lat order
  url.searchParams.set("filter", `circle:${center.lon},${center.lat},10000`);
  url.searchParams.set("bias", `proximity:${center.lon},${center.lat}`);
  url.searchParams.set("limit", String(Math.min(limit, 500)));
  url.searchParams.set("lang", "en");
  url.searchParams.set("apiKey", apiKey);
  if (conditions.length > 0) url.searchParams.set("conditions", conditions.join(","));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Geoapify Places ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { features: GeoFeature[] };

  // Category cross-contamination filters per category
  const hasCatPrefix = (f: GeoFeature, prefixes: string[]) =>
    f.properties.categories?.some((c) => prefixes.some((p) => c.startsWith(p))) ?? false;

  const CROSS_FILTERS: Partial<Record<RecommendableCategory, string[]>> = {
    CULTURE:   ["catering.", "commercial.food"],           // no restaurants in culture
    NATURE:    ["catering.", "commercial.", "sport."],      // no restaurants/shops in nature
    OUTDOORS:  ["catering.", "commercial.food"],            // no restaurants in outdoors
    NIGHTLIFE: ["tourism.sights.", "entertainment.museum"], // no museums in nightlife
  };

  const blockPrefixes = CROSS_FILTERS[category];

  return (data.features ?? [])
    .filter((f) => f.properties.name && f.geometry?.coordinates)
    .filter((f) => !blockPrefixes || !hasCatPrefix(f, blockPrefixes))
    .reduce<GeoFeature[]>((acc, f) => {
      // Deduplicate by place_id and by name (case-insensitive)
      const id = f.properties.place_id;
      const name = f.properties.name!.toLowerCase().trim();
      if (acc.some((a) => (
        (id && a.properties.place_id === id) ||
        a.properties.name!.toLowerCase().trim() === name
      ))) return acc;
      acc.push(f);
      return acc;
    }, [])
    .map((f): DiscoveredPlace => {
      const p = f.properties;
      const raw = p.datasource?.raw;
      const [lon, lat] = f.geometry.coordinates;

      // Primary category label from the first category string
      const catStr = (p.categories?.[0] ?? "place").split(".").pop() ?? "place";
      const placeCategory = catStr.charAt(0).toUpperCase() + catStr.slice(1).replace(/_/g, " ");

      return {
        placeId:      p.place_id ?? `geo-${lon}-${lat}`,
        name:         p.name!,
        latitude:     p.lat ?? lat,
        longitude:    p.lon ?? lon,
        placeCategory,
        description:  undefined,
        tel:          p.phone ?? raw?.phone ?? undefined,
        website:      p.website ?? raw?.website ?? undefined,
        openingHours: p.opening_hours ?? raw?.opening_hours ?? undefined,
        photoUrl:     undefined,      // enriched by Wikidata/Google step
        address:      p.formatted ?? p.address_line1 ?? undefined,
      };
    });
}
