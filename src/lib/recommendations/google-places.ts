/**
 * Google Places API (New / v1) — Photo, rating, and hours enrichment.
 *
 * Used only for the top-N POIs per category identified after scoring.
 * Fetches: high-resolution photo, user rating, price level, editorial
 * summary, confirmed opening hours, phone number, and website.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/op-overview
 */

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PHOTO_BASE        = "https://places.googleapis.com/v1";

// Fields we want from the Google Places response
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.regularOpeningHours",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.photos",
  "places.editorialSummary",
].join(",");

/**
 * Lightweight result from a Google Places Text Search — no photo resolution.
 * Cached as source "google-meta" in PoiEnrichCache and used for pre-scan scoring.
 */
export type GoogleMeta = {
  googlePlaceId: string;
  rating?: number;
  userRatingCount?: number;
  /** 0 = free, 1 = inexpensive, 2 = moderate, 3 = expensive, 4 = very expensive */
  priceLevel?: number;
  /** Photo resource path for later resolution ("places/{id}/photos/{ref}") */
  photoName?: string;
  openingHours?: string;
  phoneNumber?: string;
  website?: string;
  editorialSummary?: string;
  /** Google's reported lat/lon for coordinate cross-validation. */
  latitude?: number;
  longitude?: number;
};

export type GoogleEnrichment = {
  googlePlaceId: string;
  /** 1.0–5.0 */
  rating?: number;
  userRatingCount?: number;
  /** 0 = free, 1 = inexpensive, 2 = moderate, 3 = expensive, 4 = very expensive */
  priceLevel?: number;
  photoUrl?: string;
  /** Human-readable hours ("Mon-Fri 9:00 AM – 5:00 PM") */
  openingHours?: string;
  phoneNumber?: string;
  website?: string;
  editorialSummary?: string;
};

// ─── Raw Google Places v1 types ───────────────────────────────────────────────

type GPlacePhoto = {
  name: string;        // resource name: "places/{id}/photos/{ref}"
  widthPx?: number;
  heightPx?: number;
};

type GPlace = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string; // e.g. "PRICE_LEVEL_MODERATE"
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  internationalPhoneNumber?: string;
  websiteUri?: string;
  photos?: GPlacePhoto[];
  editorialSummary?: { text?: string };
};

type GPlacesResponse = { places?: GPlace[] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRICE_MAP: Record<string, number> = {
  PRICE_LEVEL_FREE:          0,
  PRICE_LEVEL_INEXPENSIVE:   1,
  PRICE_LEVEL_MODERATE:      2,
  PRICE_LEVEL_EXPENSIVE:     3,
  PRICE_LEVEL_VERY_EXPENSIVE:4,
};

/**
 * Fetch the direct image URI from the Google Places photo endpoint.
 * The media endpoint with no skipHttpRedirect returns a 302 redirect;
 * we follow it and return the final URL (a googleusercontent.com link).
 */
async function resolvePhotoUri(photoName: string, apiKey: string): Promise<string | undefined> {
  try {
    const url =
      `${PHOTO_BASE}/${photoName}/media` +
      `?maxHeightPx=800&maxWidthPx=1200&key=${apiKey}&skipHttpRedirect=true`;
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const data = await res.json() as { photoUri?: string };
    return data.photoUri ?? undefined;
  } catch {
    return undefined;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Lightweight Text Search — fetches rating, review count, price level, and
 * photo resource name but does NOT resolve the photo URL.
 * Used to pre-scan ALL discovery candidates before scoring.
 */
export async function fetchGoogleMeta(
  name: string,
  cityName: string,
  lat: number,
  lon: number,
  tourism?: string,
  streetName?: string,
  /** Full formatted address from Geoapify (e.g. "Edeka Klein, Himberger Straße 35, 53604 Bad Honnef") */
  address?: string,
): Promise<GoogleMeta | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  /** Run a single Google Places Text Search and parse the result */
  async function doSearch(textQuery: string): Promise<GoogleMeta | null> {
    const body = {
      textQuery,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lon },
          radius: 500,
        },
      },
      maxResultCount: 1,
    };

    const res = await fetch(PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey!,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as GPlacesResponse;
    const place = data.places?.[0];
    if (!place?.id) return null;

    return {
      googlePlaceId: place.id,
      rating:          place.rating,
      userRatingCount: place.userRatingCount,
      priceLevel:      place.priceLevel ? PRICE_MAP[place.priceLevel] : undefined,
      photoName:       place.photos?.[0]?.name,
      openingHours:    place.regularOpeningHours?.weekdayDescriptions?.join(" | "),
      phoneNumber:     place.internationalPhoneNumber,
      website:         place.websiteUri,
      editorialSummary: place.editorialSummary?.text,
      latitude:        place.location?.latitude,
      longitude:       place.location?.longitude,
    };
  }

  /** Haversine distance in metres between two coordinates */
  function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  try {
    // Build query: name + tourism type + street + city
    // tourism values like "yes" / "attraction" are too generic — skip them
    const SKIP_TOURISM = new Set(["yes", "attraction", "no"]);
    const queryParts = [name];
    if (tourism && !SKIP_TOURISM.has(tourism)) queryParts.push(tourism);
    if (streetName) queryParts.push(streetName);
    queryParts.push(cityName);

    const meta = await doSearch(queryParts.join(" "));

    // If we got a result with a big coord mismatch (>500m), try an address-based
    // query as fallback. This helps chain stores (e.g. "Edeka Klein") where
    // Google may return a different branch than the one at our exact coordinates.
    if (address && meta) {
      const dist = meta.latitude != null && meta.longitude != null
        ? distanceM(lat, lon, meta.latitude, meta.longitude)
        : Infinity;
      if (dist > 500) {
        console.log(`[google-meta] coord mismatch for "${name}" (${Math.round(dist)}m), retrying with address`);
        const addrMeta = await doSearch(address);
        if (addrMeta?.latitude != null && addrMeta?.longitude != null) {
          const addrDist = distanceM(lat, lon, addrMeta.latitude, addrMeta.longitude);
          if (addrDist < dist) {
            console.log(`[google-meta] address retry for "${name}": ${Math.round(addrDist)}m (was ${Math.round(dist)}m) — using address result`);
            return addrMeta;
          }
        }
      }
    }

    // If first query returned null, try address as fallback
    if (!meta && address) {
      console.log(`[google-meta] no result for "${name}", retrying with address`);
      return await doSearch(address);
    }

    return meta;
  } catch {
    return null;
  }
}

/**
 * Full enrichment for top-N POIs — resolves the photo URL.
 * Accepts pre-scanned GoogleMeta to skip the Text Search call.
 */
export async function enrichWithGoogle(
  name: string,
  cityName: string,
  lat: number,
  lon: number,
  prefetchedMeta?: GoogleMeta | null,
): Promise<GoogleEnrichment | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  try {
    const meta = prefetchedMeta ?? await fetchGoogleMeta(name, cityName, lat, lon);
    if (!meta) return null;

    // Resolve photo only here (top-N enrichment phase)
    let photoUrl: string | undefined;
    if (meta.photoName) {
      photoUrl = await resolvePhotoUri(meta.photoName, apiKey);
    }

    return {
      googlePlaceId:   meta.googlePlaceId,
      rating:          meta.rating,
      userRatingCount: meta.userRatingCount,
      priceLevel:      meta.priceLevel,
      photoUrl,
      openingHours:    meta.openingHours,
      phoneNumber:     meta.phoneNumber,
      website:         meta.website,
      editorialSummary: meta.editorialSummary,
    };
  } catch {
    return null;
  }
}
