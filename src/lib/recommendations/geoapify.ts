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
import { geocodeCity, haversineKm } from "./_shared";

const GEOAPIFY_BASE = "https://api.geoapify.com/v2/places";

// ─── Category mappings ────────────────────────────────────────────────────────

export const CATEGORY_CATEGORIES: Record<RecommendableCategory, string> = {
  CULTURE:    "entertainment.museum,entertainment.culture,tourism.sights.memorial,tourism.sights.castle,tourism.sights.fort,tourism.sights.ruines,tourism.sights.archaeological_site,tourism.sights.place_of_worship,tourism.sights.tower,tourism.sights.bridge,tourism.sights.monastery,tourism.sights.city_gate,heritage,building.historic,tourism.attraction",
  FOOD:       "catering.restaurant,catering.cafe,catering.fast_food,catering.ice_cream,catering.food_court,commercial.food_and_drink.bakery,commercial.food_and_drink.ice_cream,craft.winery,tourism.winery,commercial.food_and_drink.wine,catering.wine_bar",
  NATURE:     "leisure.park,natural.forest,natural.water,natural.mountain,national_park,beach,leisure.park.garden,leisure.park.nature_reserve,natural.protected_area,natural.water.hot_spring,natural.water.spring,natural.water.whitewater,waterway.whitewater,tourism.attraction.viewpoint",
  ENTERTAINMENT: "entertainment.theme_park,entertainment.zoo,entertainment.aquarium,entertainment.water_park,entertainment.activity_park,entertainment.planetarium,leisure.playground",
  NIGHTLIFE:  "catering.bar,catering.pub,catering.biergarten,adult.nightclub,adult.casino,entertainment.cinema,entertainment.culture.theatre",
  SHOPPING:   "commercial.shopping_mall,commercial.marketplace,commercial.clothing,commercial.gift_and_souvenir,commercial.department_store",
  GROCERIES:  "commercial.supermarket,commercial.food_and_drink.bakery,commercial.food_and_drink.butcher,commercial.food_and_drink.seafood,commercial.food_and_drink",
  WELLNESS:   "leisure.spa,sport.fitness.fitness_centre,service.beauty.spa",
  OUTDOORS:   "sport.climbing,sport.diving,sport.horse_riding,sport.swimming_pool,sport.pitch,sport.track,sport.dive_center,leisure.park.nature_reserve,natural.mountain,beach",
};

export const SUBCAT_CATEGORIES: Record<string, string> = {
  // CULTURE
  museums:           "entertainment.museum,heritage",
  art:               "entertainment.culture.gallery",
  historic:          "tourism.sights.castle,tourism.sights.fort,tourism.sights.ruines,tourism.sights.archaeological_site,tourism.sights.memorial,tourism.sights,tourism.attraction",
  architecture:      "tourism.sights.tower,building.historic,tourism.sights.bridge,tourism.sights.city_gate",
  religion:          "tourism.sights.place_of_worship,religion.place_of_worship,tourism.sights.monastery",
  theatre_cinema:    "entertainment.culture.theatre,entertainment.cinema",
  // FOOD
  restaurant:        "catering.restaurant,catering",
  fine_dining:       "catering.restaurant",
  cafe:              "catering.cafe",
  fast_food:         "catering.fast_food",
  bakery:            "commercial.food_and_drink.bakery",
  ice_cream:         "catering.ice_cream,catering.cafe.ice_cream,commercial.food_and_drink.ice_cream",
  food_markets:      "commercial.marketplace,catering.food_court",
  wineries:          "craft.winery,tourism.winery",
  wine_shops:        "commercial.food_and_drink.wine",
  wine_bars:         "catering.wine_bar,catering.bar",
  // NATURE
  parks:             "leisure.park,leisure.park.garden,natural",
  beaches:           "beach",
  mountains:         "natural.mountain",
  lakes_rivers:      "natural.water,natural.water.lake,natural.water.river,natural.water.river_system",
  waterfalls:        "natural.water.whitewater,waterway.whitewater",
  reserves:          "leisure.park.nature_reserve,natural.protected_area,national_park",
  viewpoints:        "tourism.attraction.viewpoint",
  scenic:            "tourism.attraction.viewpoint,natural.water.whitewater",
  // ENTERTAINMENT
  theme_parks:       "entertainment.theme_park,entertainment.activity_park,entertainment",
  water_parks:       "entertainment.water_park",
  zoos:              "entertainment.zoo,entertainment.aquarium",
  sport:             "sport.sports_centre,sport.stadium,sport.pitch,sport.swimming_pool,sport.track,sport.horse_riding,sport.dive_center,sport.ice_rink,sport",
  games:             "entertainment.activity_park,leisure.playground",
  // NIGHTLIFE
  bars:              "catering.bar,catering.pub,catering.biergarten",
  clubs:             "adult.nightclub,adult",
  live_music:        "entertainment.culture,catering.bar",
  comedy_shows:      "entertainment.culture.theatre",
  casino:            "adult.casino",
  // SHOPPING
  shopping_malls:    "commercial.shopping_mall,commercial.department_store,commercial",
  local_markets:     "commercial.marketplace,commercial.market_place",
  boutiques:         "commercial.clothing",
  souvenirs:         "commercial.gift_and_souvenir",
  shopping_streets:  "commercial.shopping_mall,commercial.clothing",
  // GROCERIES
  supermarket:       "commercial.supermarket,commercial.food_and_drink",
  shop_bakery:       "commercial.food_and_drink.bakery",
  butcher:           "commercial.food_and_drink.butcher",
  fishmonger:        "commercial.food_and_drink.seafood",
  // WELLNESS
  spas:              "leisure.spa,service.beauty.spa",
  wellness_centres:  "leisure.spa,sport.fitness.fitness_centre,service.beauty.spa",
  yoga_fitness:      "sport.fitness.fitness_centre",
  // OUTDOORS
  hiking:            "leisure.park.nature_reserve,natural.mountain,tourism.attraction.viewpoint",
  cycling:           "sport.cycling,sport.track",
  kayaking:          "sport.swimming_pool,natural.water",
  climbing:          "sport.climbing",
  surfing:           "beach,sport.swimming_pool",
  skiing:            "sport.skiing,sport.ice_rink",
  diving:            "sport.dive_center,sport.diving",
  horseback:         "sport.horse_riding",
  sailing:           "sport.swimming_pool,natural.water",
  fishing:           "natural.water,leisure.fishing",
};

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape returned by the Geoapify discovery layer. */
export type DiscoveredPlace = {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  placeCategory: string;
  /** Raw Geoapify category strings, e.g. ["entertainment.museum", "tourism.sights"] */
  categories: string[];
  sourceRating?: number;
  priceLevel?: number;
  description?: string;
  tel?: string;
  website?: string;
  openingHours?: string;
  photoUrl?: string;
  address?: string;
  /** Raw cuisine tag from OSM data (e.g. "italian;pizza") — FOOD only. */
  cuisine?: string;
  /** Wikidata Q-identifier from OSM tag, e.g. "Q1234". Used for scoring without an API call. */
  wikidataId?: string;
  /** OSM fee tag, e.g. "yes", "no", "5 EUR". */
  fee?: string;
  /** True when the OSM data marks this as a UNESCO World Heritage Site. */
  isUnescoSite?: boolean;
  /** OSM tourism tag, e.g. "museum", "attraction", "viewpoint". */
  tourism?: string;
  /** OSM addr:street tag — used to sharpen the Google Places search query. */
  streetName?: string;
  /** Actual municipality the POI is located in (from Geoapify `city` field).
   *  Used as city-name in Google queries so nearby places in different towns are found correctly. */
  poiCityName?: string;
  /** True when OSM has at least one translated name (name:en, name:de, etc.).
   *  Indicates internationally notable places. Used in the nearby Geoapify coarse score. */
  hasInternationalName?: boolean;
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
    /** The actual municipality the POI is located in (e.g. "Riva del Garda"). */
    city?: string;
    /** Aggregated map of OSM name:xx tags, e.g. {"en": "Lake Garda", "de": "Gardasee"}. */
    name_international?: Record<string, string>;
    datasource?: {
      raw?: {
        name?: string;
        website?: string;
        phone?: string;
        opening_hours?: string;
        "addr:street"?: string;
        "addr:housenumber"?: string;
        cuisine?: string;
        wikidata?: string;
        fee?: string;
        heritage?: string;
        "heritage:operator"?: string;
        tourism?: string;
      };
    };
  };
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search for cities/towns within `radiusM` metres of `(lat, lon)` that carry
 * UNESCO / heritage OSM tags.
 *
 * Why this exists:
 *   Geoapify's Places API indexes POI-level features (nodes/ways). A UNESCO World
 *   Heritage Site that *is* a city (e.g. Venice Historic Centre, Old Town of
 *   Bruges) is tagged in OSM on the city's **populated_place** node, not on any
 *   individual POI. Using `categories=populated_place.city,populated_place.town`
 *   returns those nodes so we can inspect their heritage tags and synthesise a
 *   CULTURE POI that represents the city itself.
 *
 * The returned DiscoveredPlace objects are injected into the CULTURE discovery
 * bucket so they pass through the normal prescan / scoring / enrichment pipeline.
 * Because `isUnescoSite=true` they are always force-included in Google prescan.
 */
export async function discoverUnescoCities(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<DiscoveredPlace[]> {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return [];

  const url = new URL(GEOAPIFY_BASE);
  url.searchParams.set(
    "categories",
    "populated_place.city,populated_place.town,populated_place.village",
  );
  url.searchParams.set("filter",  `circle:${lon},${lat},${radiusM}`);
  url.searchParams.set("bias",    `proximity:${lon},${lat}`);
  url.searchParams.set("limit",   "50");
  url.searchParams.set("lang",    "en");
  url.searchParams.set("apiKey",  apiKey);

  let data: { features?: GeoFeature[] };
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    data = await res.json() as { features?: GeoFeature[] };
  } catch {
    return [];
  }

  const results: DiscoveredPlace[] = [];

  for (const f of data.features ?? []) {
    const p   = f.properties;
    const raw = p.datasource?.raw;

    // Filter: only include cities/towns that are flagged as UNESCO / heritage sites
    const isUnesco =
      raw?.heritage === "1" ||
      raw?.["heritage:operator"]?.toUpperCase().includes("UNESCO") ||
      false;

    if (!isUnesco) continue;

    const name = p.name ?? raw?.name;
    if (!name) continue;

    const [fLon, fLat] = f.geometry.coordinates;
    const latitude  = p.lat  ?? fLat;
    const longitude = p.lon  ?? fLon;

    results.push({
      placeId:      p.place_id ?? `geo-city-${longitude}-${latitude}`,
      name,
      latitude,
      longitude,
      placeCategory: "Historic City",
      categories:    p.categories ?? ["populated_place"],
      website:       p.website ?? raw?.website ?? undefined,
      wikidataId:    raw?.wikidata ?? undefined,
      fee:           undefined,
      isUnescoSite:  true,
      tourism:       raw?.tourism ?? undefined,
      streetName:    undefined,
      poiCityName:   p.city ?? name,
      hasInternationalName:
        p.name_international != null &&
        Object.keys(p.name_international).length > 0,
    });
  }

  return results;
}

export async function searchPlaces(
  cityName: string,
  category: RecommendableCategory,
  subcategoryIds: string[],
  limit = 50,
  radiusOverrideM?: number,
  /** When true, omit the proximity bias so Geoapify distributes results evenly
   *  across the full radius rather than clustering near the centre. Use for
   *  wide-radius nearby searches where outer-ring places are the goal. */
  skipProximityBias = false,
  /** Override the search centre (skips geocoding). Used for multi-centre ring
   *  searches where the centre is offset from the city. */
  centerOverride?: { lat: number; lon: number },
): Promise<DiscoveredPlace[]> {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) throw new Error("GEOAPIFY_API_KEY is not set");

  // Use provided centre or geocode the city name
  const center = centerOverride ?? await geocodeCity(cityName);

  // Use provided radius override, or fall back to adaptive estimate based on city type
  const radiusM = radiusOverrideM ?? await estimateSearchRadius(cityName, apiKey);

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
  url.searchParams.set("filter", `circle:${center.lon},${center.lat},${radiusM}`);
  // Proximity bias causes Geoapify to return the N closest places, ignoring the outer ring.
  // Skip it for wide-radius nearby searches so results span the full circle.
  if (!skipProximityBias) {
    url.searchParams.set("bias", `proximity:${center.lon},${center.lat}`);
  }
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
    CULTURE:    ["catering.", "commercial.food"],
    NATURE:     ["catering.", "commercial.", "sport.", "leisure.playground"],
    ENTERTAINMENT: ["catering.", "commercial.food", "tourism.sights."],
    NIGHTLIFE:  ["tourism.sights.", "entertainment.museum"],
    SHOPPING:   ["catering.", "tourism.sights.", "natural.", "sport."],
    GROCERIES:  ["catering.", "tourism.sights.", "natural.", "sport.", "entertainment."],
    WELLNESS:   ["catering.", "commercial.food", "tourism.sights."],
    OUTDOORS:   ["catering.", "commercial.food", "entertainment.museum"],
  };

  // For GROCERIES, block "catering." UNLESS the place also has a "commercial.food_and_drink" tag
  // (bakeries, butchers, etc. are dual-tagged as both catering and commercial food shops)
  const GROCERIES_CATERING_ALLOWLIST = ["commercial.food_and_drink"];

  /** Check if a feature should be blocked by the cross-contamination filter */
  function isCrossFiltered(f: GeoFeature, cat: RecommendableCategory): boolean {
    const blockPrefixes = CROSS_FILTERS[cat];
    if (!blockPrefixes) return false;
    if (!hasCatPrefix(f, blockPrefixes)) return false;
    // GROCERIES exception: allow items that have both catering + commercial.food_and_drink tags
    if (cat === "GROCERIES" && hasCatPrefix(f, GROCERIES_CATERING_ALLOWLIST)) return false;
    return true;
  }

  const crossFilteredNames: string[] = [];

  const allFeatures = (data.features ?? [])
    .filter((f) => typeof f.properties.name === "string" && f.properties.name.trim() && f.geometry?.coordinates);

  const result = allFeatures
    .filter((f) => {
      if (isCrossFiltered(f, category)) {
        crossFilteredNames.push(f.properties.name ?? "?");
        return false;
      }
      return true;
    })
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
        categories:   p.categories ?? [],
        description:  p.formatted ?? p.address_line1 ?? undefined,
        tel:          p.phone ?? raw?.phone ?? undefined,
        website:      p.website ?? raw?.website ?? undefined,
        openingHours: p.opening_hours ?? raw?.opening_hours ?? undefined,
        photoUrl:     undefined,      // enriched by Wikidata/Google step
        address:      p.formatted ?? p.address_line1 ?? undefined,
        cuisine:              raw?.cuisine ?? undefined,
        wikidataId:           raw?.wikidata ?? undefined,
        fee:                  raw?.fee ?? undefined,
        isUnescoSite:         raw?.heritage === "1" || raw?.["heritage:operator"]?.toUpperCase().includes("UNESCO") || false,
        tourism:              raw?.tourism ?? undefined,
        streetName:           raw?.["addr:street"] ?? undefined,
        poiCityName:          p.city ?? undefined,
        hasInternationalName: p.name_international != null && Object.keys(p.name_international).length > 0,
      };
    });

  // Diagnostic logging
  console.log(
    `[geoapify] cat=${category} raw=${allFeatures.length} crossFiltered=${crossFilteredNames.length} returned=${result.length}` +
    (crossFilteredNames.length > 0 ? ` dropped=[${crossFilteredNames.slice(0, 10).join(", ")}]` : ""),
  );

  return result;
}

// ─── Adaptive radius ──────────────────────────────────────────────────────────

/** Estimate a search radius in metres based on city bounding box size. */
async function estimateSearchRadius(cityName: string, apiKey: string): Promise<number> {
  try {
    const url =
      `https://api.geoapify.com/v1/geocode/search` +
      `?text=${encodeURIComponent(cityName)}&type=city&limit=1&apiKey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return 10_000;
    const data = (await res.json()) as {
      features: Array<{
        bbox?: [number, number, number, number];
        properties?: { city?: string; result_type?: string; population?: number };
      }>;
    };
    const feat = data.features[0];
    if (feat?.bbox) {
      const [lonMin, latMin, lonMax, latMax] = feat.bbox;
      const diagKm = haversineKm(latMin, lonMin, latMax, lonMax);
      // Use half the diagonal as radius, clamped between 5–25 km
      const radiusKm = Math.max(5, Math.min(25, diagKm / 2));
      return Math.round(radiusKm * 1000);
    }
    return 10_000;
  } catch {
    return 10_000; // fallback 10 km
  }
}
