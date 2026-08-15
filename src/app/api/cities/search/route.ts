import { NextResponse } from "next/server";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const GEOAPIFY_KEY = process.env.GEOAPIFY_API_KEY;
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;

/**
 * GET /api/cities/search?q=tokyo        → autocomplete predictions
 * GET /api/cities/search?placeId=…      → place details + timezone
 *
 * Primary: Mapbox Geocoding v5 (when NEXT_PUBLIC_MAPBOX_TOKEN is set)
 * Fallback: Geoapify geocode/autocomplete
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const placeId = searchParams.get("placeId");

  // ── Autocomplete predictions ────────────────────────────────────────────────

  if (q) {
    // Try Mapbox first
    if (MAPBOX_TOKEN) {
      try {
        const url =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
          `?types=place&autocomplete=true&limit=5&access_token=${MAPBOX_TOKEN}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as {
            features?: Array<{
              id: string;
              text: string;
              place_name: string;
            }>;
          };
          const predictions = (data.features ?? []).map((f) => ({
            placeId: f.id,
            name: f.text,
            description: f.place_name,
          }));
          return NextResponse.json(predictions);
        }
      } catch { /* fall through to Geoapify */ }
    }

    // Geoapify fallback
    if (!GEOAPIFY_KEY) {
      return NextResponse.json({ error: "No geocoding API key configured" }, { status: 500 });
    }
    const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
    url.searchParams.set("text", q);
    url.searchParams.set("type", "city");
    url.searchParams.set("limit", "5");
    url.searchParams.set("format", "json");
    url.searchParams.set("apiKey", GEOAPIFY_KEY);

    const res = await fetch(url.toString());
    if (!res.ok) {
      return NextResponse.json({ error: `Geocoding error ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as {
      results?: Array<{
        place_id: string;
        city?: string;
        name?: string;
        formatted: string;
      }>;
    };
    const predictions = (data.results ?? []).map((r) => ({
      placeId: r.place_id,
      name: r.city || r.name || r.formatted.split(",")[0],
      description: r.formatted,
    }));
    return NextResponse.json(predictions);
  }

  // ── Place details + timezone ────────────────────────────────────────────────

  if (placeId) {
    // Mapbox place ID looks like "place.123456789" — use Mapbox Retrieve
    if (MAPBOX_TOKEN && placeId.startsWith("place.")) {
      try {
        // Re-query by ID using the retrieve endpoint
        const url =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(placeId)}.json` +
          `?access_token=${MAPBOX_TOKEN}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as {
            features?: Array<{
              text: string;
              place_name: string;
              center: [number, number];
              context?: Array<{ id: string; short_code?: string; text: string }>;
            }>;
          };
          const f = data.features?.[0];
          if (f) {
            const [lon, lat] = f.center;
            const ctx = f.context ?? [];
            const countryCtx = ctx.find((c) => c.id.startsWith("country."));
            const country = countryCtx?.text ?? "";
            const countryCode = (countryCtx?.short_code ?? "").toUpperCase();

            // Timezone via Google (or empty string)
            let timezone = "";
            if (GOOGLE_KEY) {
              try {
                const tzUrl = new URL("https://maps.googleapis.com/maps/api/timezone/json");
                tzUrl.searchParams.set("location", `${lat},${lon}`);
                tzUrl.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
                tzUrl.searchParams.set("key", GOOGLE_KEY);
                const tzRes = await fetch(tzUrl.toString());
                const tzData = (await tzRes.json()) as { status?: string; timeZoneId?: string };
                if (tzData.status === "OK") timezone = tzData.timeZoneId ?? "";
              } catch { /* ignore */ }
            }

            return NextResponse.json({
              name: f.text,
              country,
              countryCode,
              latitude: lat,
              longitude: lon,
              timezone,
            });
          }
        }
      } catch { /* fall through to Geoapify */ }
    }

    // Geoapify fallback for details
    if (!GEOAPIFY_KEY) {
      return NextResponse.json({ error: "No geocoding API key configured" }, { status: 500 });
    }
    const url = new URL("https://api.geoapify.com/v2/place-details");
    url.searchParams.set("id", placeId);
    url.searchParams.set("apiKey", GEOAPIFY_KEY);

    const res = await fetch(url.toString());
    if (!res.ok) {
      return NextResponse.json({ error: `Geoapify details error ${res.status}` }, { status: 502 });
    }

    const data = (await res.json()) as {
      features?: Array<{
        properties?: {
          name?: string;
          city?: string;
          country?: string;
          country_code?: string;
          lat?: number;
          lon?: number;
          timezone?: { name?: string };
        };
      }>;
    };

    const props = data.features?.[0]?.properties;
    if (!props) {
      return NextResponse.json({ error: "Place not found" }, { status: 404 });
    }

    const lat = props.lat ?? 0;
    const lng = props.lon ?? 0;
    const country = props.country ?? "";
    const countryCode = (props.country_code ?? "").toUpperCase();

    let timezone = props.timezone?.name ?? "";
    if (!timezone && GOOGLE_KEY) {
      try {
        const tzUrl = new URL("https://maps.googleapis.com/maps/api/timezone/json");
        tzUrl.searchParams.set("location", `${lat},${lng}`);
        tzUrl.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
        tzUrl.searchParams.set("key", GOOGLE_KEY);
        const tzRes = await fetch(tzUrl.toString());
        const tzData = (await tzRes.json()) as { status?: string; timeZoneId?: string };
        if (tzData.status === "OK") timezone = tzData.timeZoneId ?? "";
      } catch { /* ignore */ }
    }

    return NextResponse.json({
      name: props.city || props.name || "",
      country,
      countryCode,
      latitude: lat,
      longitude: lng,
      timezone,
    });
  }

  return NextResponse.json(
    { error: "Provide ?q= or ?placeId=" },
    { status: 400 },
  );
}
