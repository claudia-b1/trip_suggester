import { NextResponse } from "next/server";

const GEOAPIFY_KEY = process.env.GEOAPIFY_API_KEY;

/**
 * GET /api/pois/search?q=sagrada&lat=41.39&lon=2.17
 *
 * Autocomplete POI names near a city center using Geoapify Geocoding Autocomplete.
 * Returns name, formatted address, lat/lon, and categories.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  if (!GEOAPIFY_KEY) {
    return NextResponse.json(
      { error: "GEOAPIFY_API_KEY not configured" },
      { status: 500 },
    );
  }

  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
  url.searchParams.set("text", q);
  url.searchParams.set("limit", "6");
  url.searchParams.set("format", "json");
  url.searchParams.set("apiKey", GEOAPIFY_KEY);

  // Restrict results to within 30km of the city center and bias towards it
  if (lat && lon) {
    url.searchParams.set("filter", `circle:${lon},${lat},30000`);
    url.searchParams.set("bias", `proximity:${lon},${lat}`);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    return NextResponse.json(
      { error: `Geoapify error ${res.status}` },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    results?: Array<{
      place_id?: string;
      name?: string;
      formatted?: string;
      lat: number;
      lon: number;
      category?: string;
      result_type?: string;
    }>;
  };

  const results = (data.results ?? [])
    .filter((r) => r.name && r.lat && r.lon)
    .map((r) => ({
      placeId: r.place_id ?? `geo-${r.lon}-${r.lat}`,
      name: r.name!,
      description: r.formatted ?? "",
      latitude: r.lat,
      longitude: r.lon,
      category: r.category ?? "",
      type: r.result_type ?? "",
    }));

  return NextResponse.json(results);
}
