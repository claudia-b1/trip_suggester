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

// ─── Best-time heuristics per place category label ─────────────────────────

function inferBestTime(placeCategory: string): "morning" | "afternoon" | "evening" {
  const c = placeCategory.toLowerCase();
  if (c.includes("bar") || c.includes("nightclub") || c.includes("pub") ||
      c.includes("brewery") || c.includes("casino") || c.includes("night"))
    return "evening";
  if (c.includes("café") || c.includes("cafe") || c.includes("coffee") ||
      c.includes("bakery") || c.includes("museum") || c.includes("gallery") ||
      c.includes("historic") || c.includes("park") || c.includes("garden") ||
      c.includes("beach"))
    return "morning";
  return "afternoon";
}

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

function inferTip(category: Category, placeCategory: string): string {
  const c = placeCategory.toLowerCase();
  if (c.includes("museum"))       return "Book tickets online in advance to skip the queue.";
  if (c.includes("historic"))     return "Guided tours offer much richer context than self-guided visits.";
  if (c.includes("restaurant"))   return "Book ahead for dinner — popular spots fill up fast.";
  if (c.includes("café") || c.includes("coffee")) return "Great for a slow morning with a local newspaper.";
  if (c.includes("bar"))          return "Happy hour is usually 5–7 PM.";
  if (c.includes("nightclub"))    return "Dress code may apply — check in advance.";
  if (c.includes("park"))         return "Early morning visits avoid midday crowds and heat.";
  if (c.includes("beach"))        return "Arrive before 10 AM for the best spots.";
  if (c.includes("viewpoint") || c.includes("lookout")) return "Golden hour just after sunrise offers the most dramatic light.";
  if (category === "OUTDOORS")    return "Check opening hours and bring sturdy shoes.";
  return "Check opening times and any admission fees before visiting.";
}

// ─── Price level description ──────────────────────────────────────────────────

const PRICE_LABELS = ["Free", "$", "$$", "$$$", "$$$$"] as const;

// ─── Core enrichment functions ────────────────────────────────────────────────

async function getWikidata(placeId: string, name: string, cityName?: string): Promise<WikidataEnrichment | null> {
  return withEnrichCache<WikidataEnrichment>(placeId, "wikidata", () =>
    enrichWithWikidata(name, cityName),
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
export async function enrichPlace(
  place: DiscoveredPlace,
  category: Category,
  cityName: string,
  googleMeta?: GoogleMeta | null,
): Promise<RecommendedPoi> {
  const [wiki, google] = await Promise.allSettled([
    getWikidata(place.placeId, place.name, cityName),
    getGoogle(place.placeId, place.name, cityName, place.latitude, place.longitude, googleMeta),
  ]);

  const w = wiki.status === "fulfilled" ? wiki.value : null;
  const g = google.status === "fulfilled" ? google.value : null;

  // Build description: prefer Wikidata, then Google editorial, then source
  const description =
    w?.description ??
    g?.editorialSummary ??
    place.description ??
    `${place.placeCategory} in ${cityName}.`;

  // Rating: prefer Google (1–5), normalize source rating (1–10) as fallback
  const rating =
    g?.rating ??
    (place.sourceRating != null ? Math.round((place.sourceRating / 10) * 5 * 10) / 10 : undefined);

  // Price level: Google takes priority
  const priceLevel = g?.priceLevel ?? place.priceLevel;

  // Photo: Google high-res > discovery photo
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
    bestTimeToVisit:          inferBestTime(place.placeCategory),
    estimatedDurationMinutes: inferDuration(place.placeCategory),
    tips:        inferTip(category, place.placeCategory),
    // New enhanced fields
    placeId:     place.placeId,
    priceLevel:  priceLevel,
    website,
    phoneNumber,
    openingHours,
    photoUrl,
    isUnescoSite:    w?.isUnescoSite ?? false,
    inceptionYear:   w?.inceptionYear,
    wikidataId:      w?.wikidataId,
    userRatingCount: g?.userRatingCount,
  };
}

// Re-export price label helper so UI can consume it
export { PRICE_LABELS };
