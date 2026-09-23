import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS, type Category } from "@/lib/categories";
import { haversineKm } from "@/lib/geo";
import { nameSimilarity } from "./scoring";
import { searchPlacesNearCoords, type DiscoveredPlace } from "./geoapify";
import { fetchGoogleMeta, type GoogleMeta } from "./google-places";

const MODEL = "inclusionai/ling-3.0-flash-sante:free";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MATCH_THRESHOLD = 0.8;

// ── LLM type classification for unknown Google primaryTypes ──────────────
// In-memory cache: primaryType → app Category key. Persists across requests
// within the same server process, so each unique type is only classified once.
const typeClassificationCache = new Map<string, string>();

/**
 * Classify unknown Google Places primaryTypes into app categories via a fast LLM call.
 * Batches all types into a single request and caches by primaryType.
 */
export async function classifyGoogleTypes(
  items: Array<{ name: string; primaryType: string }>,
  availableCategories: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>(); // primaryType → category
  if (!items.length) return result;

  // Separate cached from uncached
  const uncachedTypes = new Set<string>();
  for (const item of items) {
    const key = item.primaryType.toLowerCase();
    if (typeClassificationCache.has(key)) {
      result.set(key, typeClassificationCache.get(key)!);
    } else {
      uncachedTypes.add(key);
    }
  }
  if (!uncachedTypes.size) return result;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return result;

  const catList = availableCategories
    .map((c) => CATEGORY_LABELS[c as Category] ? `${c} (${CATEGORY_LABELS[c as Category]})` : c)
    .join(", ");
  const typeList = [...uncachedTypes]
    .map((t) => {
      const example = items.find((i) => i.primaryType.toLowerCase() === t);
      return example ? `"${t}" (e.g. ${example.name})` : `"${t}"`;
    })
    .join(", ");

  const prompt = `Classify each Google Places type into ONE of these categories: ${catList}.
Types to classify: ${typeList}
Return ONLY a JSON object mapping each type to the category key. Example: {"bistro":"FOOD","fort":"CULTURE"}`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "Output ONLY raw JSON. No thinking, no explanation." },
          { role: "user", content: prompt },
        ],
        max_tokens: 300,
        temperature: 0,
      }),
    });

    if (res.ok) {
      const json = await res.json();
      const text: string = json?.choices?.[0]?.message?.content ?? "";
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as Record<string, string>;
        const validCats = new Set(availableCategories);
        for (const [type, cat] of Object.entries(parsed)) {
          if (typeof cat === "string" && validCats.has(cat.toUpperCase())) {
            const normalised = cat.toUpperCase();
            typeClassificationCache.set(type.toLowerCase(), normalised);
            result.set(type.toLowerCase(), normalised);
          }
        }
      }
    }
  } catch {
    console.log("[type-classify] LLM classification failed — using fallback");
  }

  return result;
}

/**
 * Map a Google Places primaryType to an app category key (e.g. "FOOD", "CULTURE").
 * Returns null for unknown/ambiguous types — caller should use LLM fallback.
 */
export function googleTypeToCategoryKey(primaryType?: string): string | null {
  if (!primaryType) return null;
  const t = primaryType.toLowerCase();
  // Food & drink
  if (["restaurant", "bistro", "brunch_restaurant", "breakfast_restaurant",
       "hamburger_restaurant", "ramen_restaurant", "barbecue_restaurant",
       "korean_restaurant", "greek_restaurant", "turkish_restaurant",
       "spanish_restaurant", "vietnamese_restaurant", "middle_eastern_restaurant",
       "indonesian_restaurant", "lebanese_restaurant", "italian_restaurant",
       "french_restaurant", "japanese_restaurant", "chinese_restaurant",
       "indian_restaurant", "mexican_restaurant", "thai_restaurant",
       "seafood_restaurant", "steak_house", "pizza_restaurant", "sushi_restaurant",
       "mediterranean_restaurant", "vegetarian_restaurant", "vegan_restaurant",
       "fine_dining_restaurant", "fast_food_restaurant", "meal_delivery",
       "meal_takeaway", "food_court",
       "cafe", "coffee_shop", "bakery", "ice_cream_shop",
       "bar", "wine_bar", "pub", "brewery", "winery", "distillery",
       ].some((ft) => t.includes(ft) || t === ft))
    return "FOOD";
  if (["night_club"].some((ft) => t.includes(ft)))
    return "NIGHTLIFE";
  if (["park", "national_park", "beach", "campground", "garden"].some((ft) => t.includes(ft)))
    return "NATURE";
  if (["amusement_park", "aquarium", "zoo", "movie_theater", "bowling_alley"].some((ft) => t.includes(ft)))
    return "ENTERTAINMENT";
  if (["market", "grocery_store", "supermarket", "farmers_market"].some((ft) => t === ft))
    return "GROCERIES";
  if (["shopping_mall", "clothing_store", "department_store", "book_store", "gift_shop"].some((ft) => t.includes(ft)))
    return "SHOPPING";
  if (["museum", "art_gallery", "library", "church", "mosque", "synagogue", "hindu_temple",
       "tourist_attraction", "historical_landmark", "performing_arts_theater", "cultural_landmark"].some((ft) => t.includes(ft)))
    return "CULTURE";
  if (["spa", "gym", "fitness_center"].some((ft) => t.includes(ft)))
    return "WELLNESS";
  return null; // Unknown — caller should classify via LLM
}

/** Map Google Places primaryType to Geoapify-style category tags for correct bucket routing. */
function mapGoogleTypeToCategories(primaryType?: string): { label: string; tags: string[] } {
  if (!primaryType) return { label: "Attraction", tags: ["tourism.attraction"] };
  const t = primaryType.toLowerCase();
  // Food & drink
  if (["restaurant", "italian_restaurant", "french_restaurant", "japanese_restaurant",
       "chinese_restaurant", "indian_restaurant", "mexican_restaurant", "thai_restaurant",
       "seafood_restaurant", "steak_house", "pizza_restaurant", "sushi_restaurant",
       "mediterranean_restaurant", "vegetarian_restaurant", "vegan_restaurant",
       "fine_dining_restaurant", "fast_food_restaurant", "meal_delivery", "meal_takeaway",
       "food_court", "bistro", "brunch_restaurant", "breakfast_restaurant",
       "hamburger_restaurant", "ramen_restaurant", "barbecue_restaurant",
       "korean_restaurant", "greek_restaurant", "turkish_restaurant",
       "spanish_restaurant", "vietnamese_restaurant", "middle_eastern_restaurant",
       "indonesian_restaurant", "lebanese_restaurant"].some((ft) => t.includes(ft) || t === ft))
    return { label: "Restaurant", tags: ["catering.restaurant"] };
  if (["cafe", "coffee_shop", "bakery", "ice_cream_shop"].some((ft) => t.includes(ft)))
    return { label: "Cafe", tags: ["catering.cafe"] };
  if (["bar", "wine_bar", "pub", "night_club", "brewery", "winery", "distillery"].some((ft) => t.includes(ft)))
    return { label: "Bar", tags: ["catering.bar", "production.winery"] };
  // Nature
  if (["park", "national_park", "beach", "campground", "garden"].some((ft) => t.includes(ft)))
    return { label: "Park", tags: ["leisure.park", "natural"] };
  // Entertainment
  if (["amusement_park", "aquarium", "zoo", "movie_theater", "bowling_alley"].some((ft) => t.includes(ft)))
    return { label: "Entertainment", tags: ["entertainment.theme_park"] };
  // Markets — route to both food and shopping so category routing picks the
  // best match based on user's selected categories
  if (["market", "grocery_store", "supermarket", "farmers_market"].some((ft) => t === ft))
    return { label: "Market", tags: ["commercial.marketplace", "commercial.food_and_drink"] };
  if (["shopping_mall", "clothing_store", "department_store", "book_store", "gift_shop"].some((ft) => t.includes(ft)))
    return { label: "Shopping", tags: ["commercial.shopping_mall"] };
  // Culture (default for most heritage/tourist places)
  if (["museum", "art_gallery", "library", "church", "mosque", "synagogue", "hindu_temple",
       "tourist_attraction", "historical_landmark", "performing_arts_theater", "cultural_landmark"].some((ft) => t.includes(ft)))
    return { label: "Museum", tags: ["entertainment.museum", "heritage", "tourism.sights"] };
  return { label: "Attraction", tags: ["tourism.attraction"] };
}

export async function getMustVisitList(
  cityId: number,
  cityName: string,
  country: string,
  lat: number,
  lon: number,
  categories: string[],
): Promise<string[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return [];

  // Check cache
  const cached = await prisma.cityInfoCache.findUnique({
    where: { cityId_type: { cityId, type: "must-visit" } },
  });
  if (cached && Date.now() - cached.generatedAt.getTime() < CACHE_TTL_MS) {
    try {
      const parsed = JSON.parse(cached.data) as string[];
      if (Array.isArray(parsed)) { console.log(`[must-visit] cache hit: ${parsed.length} names`); return parsed; }
    } catch { /* regenerate */ }
  } else {
    console.log(`[must-visit] cache miss (cached=${!!cached}), calling LLM`);
  }

  const categoryLabels = categories
    .map((c) => CATEGORY_LABELS[c as Category])
    .filter(Boolean)
    .join(", ");

  const prompt = `List the 20 most popular and notable places to visit in ${cityName}${country ? `, ${country}` : ""} for these categories: ${categoryLabels}. For each place, return just its name. Return a JSON array of strings. Example: ["Place A", "Place B"]. No explanation, no markdown.`;

  let names: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: "Output ONLY raw JSON. No thinking, no reasoning, no explanation, no markdown fences." },
          { role: "user", content: prompt },
        ],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!res.ok) { console.log(`[must-visit] LLM call failed: ${res.status} ${res.statusText}`); continue; }

    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? "";

    let cleaned = text.replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "").replace(/```/g, "")).trim();
    // Handle truncated arrays: if starts with [ but no closing ], try to close it
    if (cleaned.includes("[") && !cleaned.includes("]")) {
      // Find the last complete quoted string entry
      const bracketIdx = cleaned.indexOf("[");
      const afterBracket = cleaned.slice(bracketIdx);
      // Match all complete "..." entries
      const completeEntries = [...afterBracket.matchAll(/"[^"]*"/g)];
      if (completeEntries.length) {
        const lastEntry = completeEntries[completeEntries.length - 1];
        const cutoff = bracketIdx + lastEntry.index! + lastEntry[0].length;
        cleaned = cleaned.slice(0, cutoff).replace(/,\s*$/, "") + "]";
        console.log(`[must-visit] repaired truncated array with ${completeEntries.length} entries (attempt ${attempt + 1})`);
      }
    }
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      console.log(`[must-visit] LLM returned no parseable array (attempt ${attempt + 1}): ${cleaned.slice(0, 200)}`);
      continue;
    }

    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(parsed)) { console.log("[must-visit] parsed result is not an array"); continue; }
      names = parsed.filter((n): n is string => typeof n === "string" && n.trim().length > 0);
      if (names.length) break;
      console.log(`[must-visit] LLM returned empty array (attempt ${attempt + 1})`);
    } catch {
      console.log("[must-visit] JSON parse failed");
    }
  }
  if (!names.length) return [];

  // Cache the result
  await prisma.cityInfoCache.upsert({
    where: { cityId_type: { cityId, type: "must-visit" } },
    create: { cityId, type: "must-visit", data: JSON.stringify(names) },
    update: { data: JSON.stringify(names), generatedAt: new Date() },
  });

  return names;
}

/**
 * Find must-visit places missing from the discovered set and resolve them.
 *
 * Strategy per unmatched name:
 *  1. Google Places Text Search → get accurate coordinates
 *  1b. Radius check — skip places outside the user's discover radius
 *  2. Geoapify coord search at those coords (500m radius, broad categories
 *     incl. `building` + `heritage`) → find the OSM entity
 *  3. Match by name similarity among Geoapify results, including international
 *     names (name:en, name:de, etc.) for cross-language matching
 *  4. If Geoapify has it → inject the full DiscoveredPlace (complete scoring)
 *  5. If not → create a synthetic DiscoveredPlace from Google data (fallback)
 */
export async function injectMustVisitPlaces(
  mustVisitNames: string[],
  discoveredPlaces: DiscoveredPlace[],
  cityName: string,
  country: string,
  centerLat: number,
  centerLon: number,
  radiusKm?: number,
): Promise<{ places: DiscoveredPlace[]; googleMetaByPlaceId: Map<string, GoogleMeta> }> {
  if (!mustVisitNames.length) return { places: [], googleMetaByPlaceId: new Map() };

  const discoveredNames = discoveredPlaces.map((p) => p.name);
  const discoveredPlaceIds = new Set(discoveredPlaces.map((p) => p.placeId));

  // Find unmatched must-visit names
  const unmatched = mustVisitNames.filter((mv) =>
    !discoveredNames.some((dn) => nameSimilarity(mv, dn) >= MATCH_THRESHOLD),
  );

  if (!unmatched.length) { console.log(`[must-visit] all ${mustVisitNames.length} names matched in discovered set`); return { places: [], googleMetaByPlaceId: new Map() }; }
  console.log(`[must-visit] ${unmatched.length} unmatched names to resolve:`, unmatched.slice(0, 10));

  const injected: DiscoveredPlace[] = [];
  const googleMetaByPlaceId = new Map<string, GoogleMeta>();

  // Resolve all unmatched names in parallel to avoid 60s Vercel timeout
  type ResolveResult = {
    place: DiscoveredPlace;
    googleMeta?: GoogleMeta;
    logMsg: string;
  };

  const resolveResults = await Promise.allSettled(
    unmatched.map(async (name): Promise<ResolveResult | null> => {
      // 1. Get accurate coordinates from Google Places
      const googleMeta = await fetchGoogleMeta(name, cityName, centerLat, centerLon);
      if (!googleMeta?.latitude || !googleMeta?.longitude) return null;

      // 1b. Radius check
      if (radiusKm != null && isFinite(radiusKm)) {
        const distKm = haversineKm(centerLat, centerLon, googleMeta.latitude, googleMeta.longitude);
        if (distKm > radiusKm) {
          console.log(`[must-visit] "${name}" outside radius (${distKm.toFixed(1)}km > ${radiusKm}km), skipping`);
          return null;
        }
      }

      // 2. Search Geoapify at those coordinates (tight radius, broad categories)
      const nearbyCandidates = await searchPlacesNearCoords(
        googleMeta.latitude,
        googleMeta.longitude,
        500,
      );

      // 3. Find the best name match among Geoapify results.
      let bestGeo: DiscoveredPlace | null = null;
      let bestScore = 0;
      for (const candidate of nearbyCandidates) {
        if (discoveredPlaceIds.has(candidate.placeId)) continue;
        const scoreVsLocal = nameSimilarity(name, candidate.name);
        const scoreVsGoogle = googleMeta.name ? nameSimilarity(googleMeta.name, candidate.name) : 0;
        let scoreVsIntl = 0;
        if (candidate.nameInternational) {
          for (const intlName of Object.values(candidate.nameInternational)) {
            scoreVsIntl = Math.max(scoreVsIntl, nameSimilarity(name, intlName));
            if (googleMeta.name) {
              scoreVsIntl = Math.max(scoreVsIntl, nameSimilarity(googleMeta.name, intlName));
            }
          }
        }
        const score = Math.max(scoreVsLocal, scoreVsGoogle, scoreVsIntl);
        if (score > bestScore) { bestScore = score; bestGeo = candidate; }
      }

      // 3b. Proximity fallback for heritage buildings within 50m
      if (!bestGeo || bestScore < 0.5) {
        const PROXIMITY_THRESHOLD_M = 50;
        const isHeritage = (cats: string[]) =>
          cats.some((c) => c.includes("heritage") || c.includes("historic") || c.includes("castle"));
        const heritageNearby: DiscoveredPlace[] = [];
        for (const candidate of nearbyCandidates) {
          if (discoveredPlaceIds.has(candidate.placeId)) continue;
          if (!isHeritage(candidate.categories)) continue;
          const dist = haversineKm(googleMeta.latitude!, googleMeta.longitude!, candidate.latitude, candidate.longitude) * 1000;
          if (dist <= PROXIMITY_THRESHOLD_M) heritageNearby.push(candidate);
        }
        if (heritageNearby.length === 1) {
          bestGeo = heritageNearby[0];
          bestScore = -1;
        }
      }

      if (bestGeo && (bestScore >= 0.5 || bestScore === -1)) {
        const matchType = bestScore === -1 ? "proximity" : `sim=${bestScore.toFixed(2)}`;
        return {
          place: bestGeo,
          logMsg: `[must-visit] Geoapify: "${name}" -> "${bestGeo.name}" (${matchType})`,
        };
      } else {
        const syntheticId = `must-visit-${googleMeta.googlePlaceId}`;
        const geoCats = mapGoogleTypeToCategories(googleMeta.primaryType);
        return {
          place: {
            placeId: syntheticId,
            name: googleMeta.name ?? name,
            latitude: googleMeta.latitude,
            longitude: googleMeta.longitude,
            placeCategory: geoCats.label,
            categories: geoCats.tags,
            website: googleMeta.website ?? undefined,
            openingHours: googleMeta.openingHours ?? undefined,
            tel: googleMeta.phoneNumber ?? undefined,
          },
          googleMeta,
          logMsg: `[must-visit] Google fallback: "${name}" -> "${googleMeta.name}" (${googleMeta.rating}★, ${googleMeta.userRatingCount} reviews, type=${googleMeta.primaryType})`,
        };
      }
    }),
  );

  // Collect results, dedup by placeId
  for (const result of resolveResults) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { place, googleMeta, logMsg } = result.value;
    if (discoveredPlaceIds.has(place.placeId)) continue;
    console.log(logMsg);
    injected.push(place);
    discoveredPlaceIds.add(place.placeId);
    if (googleMeta) googleMetaByPlaceId.set(place.placeId, googleMeta);
  }

  const geoCount = injected.filter((p) => !p.placeId.startsWith("must-visit-")).length;
  console.log(`[must-visit] injected ${injected.length} places (${geoCount} via Geoapify, ${injected.length - geoCount} via Google fallback)`);
  return { places: injected, googleMetaByPlaceId };
}
