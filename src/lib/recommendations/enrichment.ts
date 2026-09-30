/**
 * Enrichment orchestrator — runs Wikidata + Google Places in parallel for a
 * single discovered place, caches each source independently, then merges the
 * results into a `RecommendedPoi` ready for database insertion.
 *
 * Errors in any single enrichment source are silently swallowed: a failed
 * Wikidata or Google call just means those fields are absent, not that the
 * whole pipeline fails.
 */
import { withEnrichCache } from "./cache";
import { enrichWithWikidata, type WikidataEnrichment } from "./wikidata";
import { enrichWithGoogle, type GoogleEnrichment, type GoogleMeta } from "./google-places";
import type { DiscoveredPlace } from "./geoapify";
import type { RecommendedPoi } from "./_shared";
import type { Category } from "@/lib/categories";
import { buildFallbackDescription } from "@/lib/smart-fallback-description";

function inferDuration(placeCategory: string): number {
  const c = placeCategory.toLowerCase();
  if (c.includes("museum") || c.includes("gallery"))    return 120;
  if (c.includes("restaurant"))                         return 75;
  if (c.includes("café") || c.includes("coffee"))      return 45;
  if (c.includes("bar") || c.includes("pub"))           return 90;
  if (c.includes("nightclub"))                          return 180;
  if (c.includes("park") || c.includes("garden"))       return 60;
  if (c.includes("beach"))                              return 180;
  if (c.includes("national park"))                      return 240;
  if (c.includes("historic") || c.includes("monument")) return 45;
  if (c.includes("theatre") || c.includes("performing")) return 150;
  if (c.includes("fast food") || c.includes("bakery"))  return 20;
  return 60;
}

// ─── Core enrichment functions ────────────────────────────────────────────────

async function getWikidata(placeId: string, name: string, cityName?: string, knownQId?: string): Promise<WikidataEnrichment | null> {
  return withEnrichCache<WikidataEnrichment>(placeId, "wikidata", () =>
    enrichWithWikidata(name, cityName, knownQId),
  );
}

async function getGoogle(
  placeId: string,
  name: string,
  cityName: string,
  lat: number,
  lon: number,
  prefetchedMeta?: GoogleMeta | null,
): Promise<GoogleEnrichment | null> {
  return withEnrichCache<GoogleEnrichment>(placeId, "google", () =>
    enrichWithGoogle(name, cityName, lat, lon, prefetchedMeta),
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enrich a discovered place and merge all sources into a `RecommendedPoi`.
 *
 * Wikidata and Google run in parallel. Cache is checked per-source — a partial
 * cache hit (e.g. Wikidata cached, Google not) still avoids duplicate calls.
 */
// Categories where Wikidata enrichment is worthwhile — only major cultural
// landmarks and natural sites tend to have Wikidata entries.
const WIKIDATA_CATEGORIES = new Set<string>(["CULTURE", "NATURE"]);

/**
 * Build a POI from data the prescan already fetched — no network calls.
 *
 * The Google prescan meta already carries rating, review count, price level,
 * opening hours, phone and website, and OSM already gave us `isUnescoSite` and
 * `wikidataId`. So the only things full enrichment adds are the resolved photo
 * URL (one HTTP call per POI) and Wikidata's description/inception year.
 *
 * Measured, that enrichment pass was 76 of 111 seconds on a cold run — enough
 * on its own to blow the function budget. Everything it adds is display-only
 * and nullable, so the run returns POIs built from what it already has and
 * `backfillEnrichment` fills the rest in afterwards.
 */
export function buildPoiFromPrescan(
  place: DiscoveredPlace,
  category: Category,
  cityName: string,
  googleMeta?: GoogleMeta | null,
): RecommendedPoi {
  const g = googleMeta ?? null;
  const rating =
    g?.rating ??
    (place.sourceRating != null ? Math.round((place.sourceRating / 10) * 5 * 10) / 10 : undefined);

  return {
    name:        place.name,
    category,
    // No Wikipedia summary yet — the smart fallback keeps the card readable
    // until the backfill replaces it.
    description: g?.editorialSummary ?? buildFallbackDescription({
      category,
      placeCategory: place.placeCategory,
      cuisine: place.cuisine,
      rating: rating ?? null,
      userRatingCount: g?.userRatingCount,
      cityName,
    }),
    latitude:    place.latitude,
    longitude:   place.longitude,
    rating,
    estimatedDurationMinutes: inferDuration(place.placeCategory),
    placeId:     place.placeId,
    priceLevel:  g?.priceLevel ?? place.priceLevel,
    website:     g?.website ?? place.website,
    phoneNumber: g?.phoneNumber ?? place.tel,
    openingHours: g?.openingHours ?? place.openingHours,
    // Deliberately unresolved — this is the per-POI HTTP call being deferred.
    photoUrl:    place.photoUrl,
    isUnescoSite: place.isUnescoSite ?? false,
    wikidataId:  place.wikidataId,
    fee:         place.fee,
    userRatingCount: g?.userRatingCount,
  };
}

export async function enrichPlace(
  place: DiscoveredPlace,
  category: Category,
  cityName: string,
  googleMeta?: GoogleMeta | null,
): Promise<RecommendedPoi> {
  const wikiPromise = WIKIDATA_CATEGORIES.has(category)
    ? getWikidata(place.placeId, place.name, cityName, place.wikidataId)
    : Promise.resolve(null);
  const [wiki, google] = await Promise.allSettled([
    wikiPromise,
    getGoogle(place.placeId, place.name, cityName, place.latitude, place.longitude, googleMeta),
  ]);

  const w = wiki.status === "fulfilled" ? wiki.value : null;
  const g = google.status === "fulfilled" ? google.value : null;

  // Build description: prefer Wikipedia summary (rich 1–2 sentence extract),
  // then Google editorial, then Wikidata short description.
  // Skip Geoapify's "description" — it's almost always just the formatted address
  // (e.g. "Edeka Klein, Himberger Straße 35, 53604 Bad Honnef"), which is useless as a description.
  // Last resort: smart fallback built from metadata so no POI ever has a blank description.
  const description =
    w?.wikipediaSummary ??
    g?.editorialSummary ??
    w?.description ??
    buildFallbackDescription({
      category,
      placeCategory: place.placeCategory,
      cuisine: place.cuisine,
      rating: g?.rating ?? (place.sourceRating != null ? Math.round((place.sourceRating / 10) * 5 * 10) / 10 : null),
      userRatingCount: g?.userRatingCount,
      cityName,
    });

  // Rating: prefer Google (1–5), normalize source rating (1–10) as fallback
  const rating =
    g?.rating ??
    (place.sourceRating != null ? Math.round((place.sourceRating / 10) * 5 * 10) / 10 : undefined);

  // Price level: Google takes priority
  const priceLevel = g?.priceLevel ?? place.priceLevel;

  // Photo: Google Places > discovery fallback
  const photoUrl = g?.photoUrl ?? place.photoUrl;

  // Hours / contact: discovery already has these, Google can override
  const openingHours = g?.openingHours ?? place.openingHours;
  const phoneNumber  = g?.phoneNumber  ?? place.tel;
  const website      = g?.website      ?? place.website;

  return {
    name:        place.name,
    category,
    description,
    latitude:    place.latitude,
    longitude:   place.longitude,
    rating,
    // `bestTimeToVisit` and `tips` are deliberately not auto-filled. They used
    // to be keyword guesses off the category label, which produced invented
    // specifics presented as facts about a particular place ("Happy hour is
    // usually 5–7 PM" for any bar) — and in practice 91% of POIs just got the
    // same generic fallback string. Both columns stay, for the user's own notes.
    estimatedDurationMinutes: inferDuration(place.placeCategory),
    // New enhanced fields
    placeId:     place.placeId,
    priceLevel:  priceLevel,
    website,
    phoneNumber,
    openingHours,
    photoUrl,
    isUnescoSite:    w?.isUnescoSite ?? place.isUnescoSite ?? false,
    inceptionYear:   w?.inceptionYear,
    wikidataId:      w?.wikidataId ?? place.wikidataId,
    fee:             place.fee,
    userRatingCount: g?.userRatingCount,
  };
}

