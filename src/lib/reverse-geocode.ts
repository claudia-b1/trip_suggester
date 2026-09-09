/**
 * Server-side reverse geocode: resolve country (and optionally countryCode)
 * from latitude/longitude using Google Geocoding API with Mapbox fallback.
 *
 * Used to ensure every city record has a country value, even when the client
 * didn't provide one (e.g. manual entry, AI-generated recommendations).
 */

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export interface ReverseGeocodeResult {
  country: string;
  countryCode?: string;
}

/**
 * Resolve country from lat/lng. Returns null if geocoding fails entirely.
 * Best-effort: errors are swallowed so callers can proceed without a country.
 */
export async function reverseGeocodeCountry(
  lat: number,
  lon: number,
): Promise<ReverseGeocodeResult | null> {
  // Google Geocoding API — request only country-level result
  if (GOOGLE_KEY) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("latlng", `${lat},${lon}`);
      url.searchParams.set("result_type", "country");
      url.searchParams.set("key", GOOGLE_KEY);

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = (await res.json()) as {
          results?: Array<{
            address_components?: Array<{
              long_name: string;
              short_name: string;
              types: string[];
            }>;
          }>;
        };
        const comp = data.results?.[0]?.address_components?.find((c) =>
          c.types.includes("country"),
        );
        if (comp?.long_name) {
          return {
            country: comp.long_name,
            countryCode: comp.short_name || undefined,
          };
        }
      }
    } catch {
      // fall through to Mapbox
    }
  }

  // Mapbox fallback
  if (MAPBOX_TOKEN) {
    try {
      const url = new URL(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json`,
      );
      url.searchParams.set("types", "country");
      url.searchParams.set("limit", "1");
      url.searchParams.set("access_token", MAPBOX_TOKEN);

      const res = await fetch(url.toString());
      if (res.ok) {
        const data = (await res.json()) as {
          features?: Array<{
            text: string;
            properties?: { short_code?: string };
          }>;
        };
        const feature = data.features?.[0];
        if (feature?.text) {
          return {
            country: feature.text,
            countryCode: feature.properties?.short_code?.toUpperCase() || undefined,
          };
        }
      }
    } catch {
      // give up
    }
  }

  return null;
}
