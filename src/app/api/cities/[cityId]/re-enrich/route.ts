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
import { haversineM } from "@/lib/geo";
import { nameSimilarity } from "@/lib/recommendations/scoring";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";

const PLACES_API = "https://places.googleapis.com/v1";

/**
 * A Google text search for an ambiguous name ("Pekara", "Lidl") readily returns
 * a different business, whose photo then gets written to the POI permanently.
 *
 * Distance does the real work here, not the name. POI names come from OSM and
 * are often in the local language while Google returns the translated name
 * ("Balbijev luk" vs "Balbi Arch", "Zavičajni muzej Grada Rovinja" vs "Rovinj
 * Heritage Museum" — both score 0.00), so gating on name similarity alone would
 * reject correct matches across most of a non-English trip. Conversely the worst
 * case, a different branch of the same chain, scores a perfect 1.00.
 *
 * So: trust anything essentially on top of the POI, reject anything far away,
 * and only fall back to the name in the ambiguous band between.
 */
const TRUST_DISTANCE_M = 150;
const MAX_MATCH_DISTANCE_M = 300;
const MIN_NAME_SIMILARITY = 0.4;

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
    displayName?: { text?: string };
    location?: { latitude?: number; longitude?: number };
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
        "X-Goog-FieldMask": "places.id,places.photos,places.displayName,places.location",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as PlaceResult;
    const place = data.places?.[0];
    const photoName = place?.photos?.[0]?.name;
    if (!photoName) return null;

    const matchedName = place?.displayName?.text;
    const gLat = place?.location?.latitude;
    const gLon = place?.location?.longitude;

    // locationBias is a soft hint, so Google can still return a distant branch.
    if (lat != null && lon != null && gLat != null && gLon != null) {
      const dist = haversineM(lat, lon, gLat, gLon);
      if (dist > MAX_MATCH_DISTANCE_M) {
        console.log(`[re-enrich] rejecting "${matchedName ?? "?"}" for "${poiName}" — ${Math.round(dist)}m away`);
        return null;
      }
      if (dist > TRUST_DISTANCE_M && matchedName) {
        const similarity = nameSimilarity(poiName, matchedName);
        if (similarity < MIN_NAME_SIMILARITY) {
          console.log(`[re-enrich] rejecting "${matchedName}" for "${poiName}" — ${Math.round(dist)}m away and name similarity ${similarity.toFixed(2)}`);
          return null;
        }
      }
    }

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
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId: raw } = await params;
  const cityId = Number(raw);
  if (!cityId) return NextResponse.json({ error: "invalid cityId" }, { status: 400 });

  // This route spends Google Places quota, so it must not be callable for
  // arbitrary city ids.
  if (!await verifyCityOwnership(cityId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
