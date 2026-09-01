/**
 * POST /api/cities/[cityId]/fuel-stations
 *
 * Simple Geoapify search for fuel/gas stations near a given center point.
 * Creates POI records with category FUEL. No enrichment or scoring — just
 * raw discovery + deduplication against existing POIs.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";

const GEOAPIFY_BASE = "https://api.geoapify.com/v2/places";

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
    city?: string;
    datasource?: {
      raw?: {
        name?: string;
        brand?: string;
        opening_hours?: string;
        phone?: string;
        website?: string;
      };
    };
  };
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  const cityIdNum = Number(cityId);
  if (!await verifyCityOwnership(cityIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const radiusKm: number =
    typeof body?.radiusKm === "number" && body.radiusKm > 0 ? body.radiusKm : 10;
  const centerLat: number | undefined =
    typeof body?.centerLat === "number" ? body.centerLat : undefined;
  const centerLon: number | undefined =
    typeof body?.centerLon === "number" ? body.centerLon : undefined;
  const overwrite: boolean = body?.overwrite === true;

  // Resolve center: prefer provided center, fall back to city coordinates
  const city = await prisma.city.findUnique({
    where: { id: cityIdNum },
    select: { latitude: true, longitude: true, name: true },
  });
  if (!city) return NextResponse.json({ error: "City not found" }, { status: 404 });

  const lat = centerLat ?? city.latitude;
  const lon = centerLon ?? city.longitude;
  if (lat == null || lon == null) {
    return NextResponse.json({ error: "No coordinates available" }, { status: 400 });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEOAPIFY_API_KEY not set" }, { status: 500 });

  // Search Geoapify for fuel stations
  const radiusM = Math.round(radiusKm * 1000);
  const url = new URL(GEOAPIFY_BASE);
  url.searchParams.set("categories", "service.vehicle.fuel");
  url.searchParams.set("filter", `circle:${lon},${lat},${radiusM}`);
  url.searchParams.set("bias", `proximity:${lon},${lat}`);
  url.searchParams.set("limit", "30");
  url.searchParams.set("lang", "en");
  url.searchParams.set("apiKey", apiKey);

  console.log(`[fuel-stations] searching at ${lat},${lon} radius=${radiusM}m`);

  let features: GeoFeature[] = [];
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      return NextResponse.json({ error: `Geoapify error: ${res.status}` }, { status: 502 });
    }
    const data = await res.json() as { features?: GeoFeature[] };
    features = data.features ?? [];
  } catch (e) {
    return NextResponse.json({ error: "Geoapify request failed" }, { status: 502 });
  }

  console.log(`[fuel-stations] Geoapify returned ${features.length} features: [${features.slice(0, 10).map((f) => f.properties.name ?? "?").join(", ")}]`);

  // Filter valid features with names
  const valid = features.filter(
    (f) => f.properties.name?.trim() && f.geometry?.coordinates,
  );

  // Deduplicate by name + location — same name is allowed if stations are >200m apart
  // (e.g. two different "Aral" stations: one in town, one Autohof on the highway)
  const seenStations: Array<{ name: string; lat: number; lon: number }> = [];
  const deduped = valid.filter((f) => {
    const name = f.properties.name!.toLowerCase().trim();
    const [fLon, fLat] = f.geometry.coordinates;
    const lat = f.properties.lat ?? fLat;
    const lon = f.properties.lon ?? fLon;
    const isDupe = seenStations.some((s) => {
      if (s.name !== name) return false;
      // Haversine distance check — treat as duplicate only if <200m
      const R = 6371000;
      const dLat = ((lat - s.lat) * Math.PI) / 180;
      const dLon = ((lon - s.lon) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((s.lat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) < 100;
    });
    if (isDupe) return false;
    seenStations.push({ name, lat, lon });
    return true;
  });

  // If overwrite, delete existing FUEL POIs (preserve favourites)
  if (overwrite) {
    await prisma.poi.deleteMany({ where: { cityId: cityIdNum, category: "FUEL", favouriteItemId: null } });
  }

  // Check existing FUEL POIs for deduplication
  const existingFuel = await prisma.poi.findMany({
    where: { cityId: cityIdNum, category: "FUEL" },
    select: { placeId: true, name: true, latitude: true, longitude: true },
  });
  const existingPlaceIds = new Set(existingFuel.map((p) => p.placeId).filter(Boolean));

  // Create POI records — dedup against existing by placeId or name+proximity
  const toCreate = deduped.filter((f) => {
    const id = f.properties.place_id;
    if (id && existingPlaceIds.has(id)) return false;
    const name = f.properties.name!.toLowerCase().trim();
    const [fLon, fLat] = f.geometry.coordinates;
    const newLat = f.properties.lat ?? fLat;
    const newLon = f.properties.lon ?? fLon;
    // Same name + within 200m = duplicate
    const nameMatch = existingFuel.some((p) => {
      if (p.name.toLowerCase().trim() !== name) return false;
      if (p.latitude == null || p.longitude == null) return true; // same name, no coords → assume dupe
      const R = 6371000;
      const dLat = ((newLat - p.latitude) * Math.PI) / 180;
      const dLon = ((newLon - p.longitude) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((p.latitude * Math.PI) / 180) * Math.cos((newLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) < 100;
    });
    return !nameMatch;
  });

  // Count names to detect duplicates that need disambiguation
  const nameCounts = new Map<string, number>();
  for (const f of toCreate) {
    const n = (f.properties.name || "").toLowerCase().trim();
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }

  if (toCreate.length > 0) {
    await prisma.poi.createMany({
      data: toCreate.map((f) => {
        const p = f.properties;
        const raw = p.datasource?.raw;
        const [fLon, fLat] = f.geometry.coordinates;
        // Use brand name if no name, or combine brand + name
        let name = p.name || raw?.brand || "Gas Station";
        // Disambiguate same-name stations by appending street from formatted address
        const nameKey = name.toLowerCase().trim();
        if ((nameCounts.get(nameKey) ?? 0) > 1 || existingFuel.some((e) => e.name.toLowerCase().trim() === nameKey)) {
          // Extract street from formatted address: "Aral, Rottbitzer Straße, 53604 Bad Honnef, Germany"
          // → "Rottbitzer Straße"
          const parts = (p.formatted ?? "").split(",").map((s) => s.trim());
          // Skip first part (POI name) and last parts (postal code + city, country)
          const street = parts.length > 2 ? parts[1] : p.city || "";
          if (street) name = `${name} (${street})`;
        }
        // Determine subcategory from Geoapify categories
        const cats = p.categories ?? [];
        let subcategory = "gas_station";
        if (cats.some((c) => c.includes("charging") || c.includes("electric"))) {
          subcategory = "ev_charging";
        } else if (cats.some((c) => c.includes("lpg"))) {
          subcategory = "lpg";
        }
        return {
          name,
          category: "FUEL",
          subcategory,
          description: p.formatted ?? p.address_line1 ?? null,
          latitude: p.lat ?? fLat,
          longitude: p.lon ?? fLon,
          placeId: p.place_id ?? null,
          website: p.website ?? raw?.website ?? null,
          phoneNumber: p.phone ?? raw?.phone ?? null,
          openingHours: p.opening_hours ?? raw?.opening_hours ?? null,
          cityId: cityIdNum,
        };
      }),
    });
  }

  console.log(`[fuel-stations] valid=${valid.length} deduped=${deduped.length} existing=${existingFuel.length} toCreate=${toCreate.length}`);

  return NextResponse.json({ created: toCreate.length }, { status: 201 });
}
