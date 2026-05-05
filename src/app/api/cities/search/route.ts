import { NextResponse } from "next/server";

const GEOAPIFY_KEY = process.env.GEOAPIFY_API_KEY;
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;

/**
 * GET /api/cities/search?q=tokyo        → autocomplete predictions (Geoapify)
 * GET /api/cities/search?placeId=…      → place details + timezone (Geoapify + Google TZ)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const placeId = searchParams.get("placeId");

  if (!GEOAPIFY_KEY) {
    return NextResponse.json(
      { error: "GEOAPIFY_API_KEY not configured" },
      { status: 500 },
    );
  }

  // --- Autocomplete predictions via Geoapify ---
  if (q) {
    const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
    url.searchParams.set("text", q);
    url.searchParams.set("type", "city");
    url.searchParams.set("limit", "5");
    url.searchParams.set("format", "json");
    url.searchParams.set("apiKey", GEOAPIFY_KEY);

    const res = await fetch(url.toString());
    if (!res.ok) {
      return NextResponse.json({ error: `Geoapify error ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as {
      results?: Array<{
        place_id: string;
        city?: string;
        name?: string;
        formatted: string;
        country?: string;
        country_code?: string;
        lat: number;
        lon: number;
        timezone?: { name?: string };
      }>;
    };

    const predictions = (data.results ?? []).map((r) => ({
      placeId: r.place_id,
      name: r.city || r.name || r.formatted.split(",")[0],
      description: r.formatted,
    }));

    return NextResponse.json(predictions);
  }

  // --- Place details + timezone ---
  if (placeId) {
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

    // Timezone: try Geoapify first, then Google Timezone API as fallback
    let timezone = props.timezone?.name ?? "";
    if (!timezone && GOOGLE_KEY) {
      try {
        const tzUrl = new URL("https://maps.googleapis.com/maps/api/timezone/json");
        tzUrl.searchParams.set("location", `${lat},${lng}`);
        tzUrl.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
        tzUrl.searchParams.set("key", GOOGLE_KEY);
        const tzRes = await fetch(tzUrl.toString());
        const tzData = await tzRes.json();
        if (tzData.status === "OK") timezone = tzData.timeZoneId;
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
