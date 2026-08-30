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

  // Filter valid features with names
  const valid = features.filter(
    (f) => f.properties.name?.trim() && f.geometry?.coordinates,
  );

  // Deduplicate by name (case-insensitive)
  const seen = new Set<string>();
  const deduped = valid.filter((f) => {
    const key = f.properties.name!.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // If overwrite, delete existing FUEL POIs (preserve favourites)
  if (overwrite) {
    await prisma.poi.deleteMany({ where: { cityId: cityIdNum, category: "FUEL", favouriteItemId: null } });
  }

  // Check existing FUEL POIs for deduplication
  const existingFuel = await prisma.poi.findMany({
    where: { cityId: cityIdNum, category: "FUEL" },
    select: { placeId: true, name: true },
  });
  const existingPlaceIds = new Set(existingFuel.map((p) => p.placeId).filter(Boolean));
  const existingNames = new Set(existingFuel.map((p) => p.name.toLowerCase().trim()));

  // Create POI records
  const toCreate = deduped.filter((f) => {
    const id = f.properties.place_id;
    const name = f.properties.name!.toLowerCase().trim();
    if (id && existingPlaceIds.has(id)) return false;
    if (existingNames.has(name)) return false;
    return true;
  });

  if (toCreate.length > 0) {
    await prisma.poi.createMany({
      data: toCreate.map((f) => {
        const p = f.properties;
        const raw = p.datasource?.raw;
        const [fLon, fLat] = f.geometry.coordinates;
        // Use brand name if no name, or combine brand + name
        const name = p.name || raw?.brand || "Gas Station";
        return {
          name,
          category: "FUEL",
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

  return NextResponse.json({ created: toCreate.length }, { status: 201 });
}
