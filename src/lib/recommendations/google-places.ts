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
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.regularOpeningHours",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.photos",
  "places.editorialSummary",
].join(",");

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

function buildPhotoUrl(photoName: string, apiKey: string): string {
  return (
    `${PHOTO_BASE}/${photoName}/media` +
    `?maxHeightPx=800&maxWidthPx=1200&key=${apiKey}`
  );
}

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
 * Enrich a POI with Google Places data.
 * Returns `null` if the API key is missing, the place is not found, or an
 * error occurs (handled gracefully upstream).
 *
 * @param name   Place name (used in text search query)
 * @param cityName  City name appended to improve match accuracy
 * @param lat    Latitude for location bias
 * @param lon    Longitude for location bias
 */
export async function enrichWithGoogle(
  name: string,
  cityName: string,
  lat: number,
  lon: number,
): Promise<GoogleEnrichment | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  try {
    const body = {
      textQuery: `${name} ${cityName}`,
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
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as GPlacesResponse;
    const place = data.places?.[0];
    if (!place?.id) return null;

    // Build photo URL for the first available photo
    let photoUrl: string | undefined;
    if (place.photos?.[0]?.name) {
      photoUrl = await resolvePhotoUri(place.photos[0].name, apiKey);
    }

    // Hours: join weekday descriptions into one readable string
    const openingHours = place.regularOpeningHours?.weekdayDescriptions?.join(" | ");

    return {
      googlePlaceId: place.id,
      rating:          place.rating,
      userRatingCount: place.userRatingCount,
      priceLevel:      place.priceLevel ? PRICE_MAP[place.priceLevel] : undefined,
      photoUrl,
      openingHours,
      phoneNumber:     place.internationalPhoneNumber,
      website:         place.websiteUri,
      editorialSummary: place.editorialSummary?.text,
    };
  } catch {
    return null;
  }
}
