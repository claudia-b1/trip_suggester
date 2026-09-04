/**
 * POST /api/cities/:cityId/re-enrich
 *
 * Re-runs Google Places photo lookup for all POIs in a city and updates their
 * photoUrl when a Google photo is found.
 *
 * Optimised for speed:
 *  - Phase 1: Text Search all POIs to get photo resource names (5 concurrent)
 *  - Phase 2: Resolve photo URIs for POIs that got results (5 concurrent)
 *  - Phase 3: Bulk-update DB rows
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PLACES_API = "https://places.googleapis.com/v1";

/** Concurrency limiter */
function pMap<T, R>(items: T[], fn: (item: T, i: number) => Promise<R>, concurrency: number): Promise<R[]> {
  return new Promise((resolve, reject) => {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    let completed = 0;
    let rejected = false;

    function runNext() {
      if (rejected) return;
      if (nextIndex >= items.length) return;
      const idx = nextIndex++;
      fn(items[idx], idx)
        .then((r) => {
          results[idx] = r;
          completed++;
          if (completed === items.length) resolve(results);
          else runNext();
        })
        .catch((e) => {
          rejected = true;
          reject(e);
        });
    }

    for (let i = 0; i < Math.min(concurrency, items.length); i++) runNext();
    if (items.length === 0) resolve([]);
  });
}

type PlaceResult = {
  places?: Array<{
    id?: string;
    photos?: Array<{ name: string }>;
  }>;
};

/** Search Google Places for a POI and return the photo resource name + placeId. */
async function findGooglePhoto(
  poiName: string,
  cityName: string,
  lat: number | null,
  lon: number | null,
  apiKey: string,
): Promise<{ photoName: string; googlePlaceId?: string } | null> {
  try {
    const body: Record<string, unknown> = {
      textQuery: `${poiName}, ${cityName}`,
      maxResultCount: 1,
    };
    if (lat != null && lon != null) {
      body.locationBias = {
        circle: { center: { latitude: lat, longitude: lon }, radius: 500 },
      };
    }

    const res = await fetch(`${PLACES_API}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.photos",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as PlaceResult;
    const place = data.places?.[0];
    const photoName = place?.photos?.[0]?.name;
    if (!photoName) return null;

    return { photoName, googlePlaceId: place?.id };
  } catch {
    return null;
  }
}

/** Resolve a photo resource name to a direct image URL. */
async function resolvePhotoUrl(photoName: string, apiKey: string): Promise<string | null> {
  try {
    const url =
      `${PLACES_API}/${photoName}/media` +
      `?maxHeightPx=800&maxWidthPx=1200&key=${apiKey}&skipHttpRedirect=true`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { photoUri?: string };
    return data.photoUri ?? null;
  } catch {
    return null;
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const { cityId: raw } = await params;
  const cityId = Number(raw);
  if (!cityId) return NextResponse.json({ error: "invalid cityId" }, { status: 400 });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not set" }, { status: 500 });

  const city = await prisma.city.findUnique({
    where: { id: cityId },
    select: { name: true },
  });
  if (!city) return NextResponse.json({ error: "city not found" }, { status: 404 });

  const pois = await prisma.poi.findMany({
    where: { cityId },
    select: { id: true, name: true, photoUrl: true, placeId: true, latitude: true, longitude: true },
  });

  // Filter: skip POIs that already have a Google photo
  const toProcess = pois.filter(
    (p) => !p.photoUrl?.includes("googleusercontent.com") && !p.photoUrl?.includes("googleapis.com"),
  );
  const alreadyDone = pois.length - toProcess.length;

  // ── Phase 1: find Google photos (5 concurrent) ──
  const searchResults = await pMap(
    toProcess,
    async (poi) => {
      const result = await findGooglePhoto(poi.name, city.name, poi.latitude, poi.longitude, apiKey);
      return { poi, result };
    },
    5,
  );

  // ── Phase 2: resolve photo URIs (5 concurrent) ──
  const withPhotos = searchResults.filter((r) => r.result != null);
  const resolvedPhotos = await pMap(
    withPhotos,
    async ({ poi, result }) => {
      const photoUrl = await resolvePhotoUrl(result!.photoName, apiKey);
      return { poi, photoUrl, googlePlaceId: result!.googlePlaceId };
    },
    5,
  );

  // ── Phase 3: update DB ──
  let updated = 0;
  const results: Array<{ name: string; status: string; imageUrl?: string }> = [];

  for (const { poi, photoUrl, googlePlaceId } of resolvedPhotos) {
    if (photoUrl) {
      const data: Record<string, unknown> = { photoUrl };
      // Also store the Google placeId if the POI doesn't have one yet
      if (!poi.placeId && googlePlaceId) data.placeId = googlePlaceId;
      await prisma.poi.update({ where: { id: poi.id }, data });
      updated++;
      results.push({ name: poi.name, status: "updated", imageUrl: photoUrl });
    } else {
      results.push({ name: poi.name, status: "no-photo" });
    }
  }

  // POIs that didn't match any Google result
  for (const { poi, result } of searchResults) {
    if (!result) {
      results.push({ name: poi.name, status: "not-found" });
    }
  }

  return NextResponse.json({ checked: pois.length, updated, skipped: alreadyDone, results });
}
