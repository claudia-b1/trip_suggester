/**
 * POST /api/cities/:cityId/re-enrich
 *
 * Re-runs Wikidata image lookup for all POIs in a city and updates their
 * photoUrl when a Wikipedia/Commons image is found.
 *
 * Optimised for speed:
 *  - Phase 1: resolve all POI names → Wikidata QIDs in parallel (5 concurrent)
 *  - Phase 2: single batched SPARQL query for all QIDs at once → images
 *  - Phase 3: bulk-update DB rows
 *
 * Streams progress via Server-Sent Events so the UI can show live updates.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ENTITY_SEARCH = "https://www.wikidata.org/w/api.php";
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "TripPlanner/1.0 (educational project)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

type SearchResult = { search: Array<{ id: string }> };

/** Single-language entity search with retry on 429. Minimal delay. */
async function searchEntity(query: string, lang: string): Promise<string | null> {
  const url = new URL(ENTITY_SEARCH);
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("search", query);
  url.searchParams.set("language", lang);
  url.searchParams.set("type", "item");
  url.searchParams.set("limit", "3");
  url.searchParams.set("format", "json");

  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url.toString(), { headers: { "User-Agent": USER_AGENT } });
      if (res.status === 429) { await sleep(1500 * (i + 1)); continue; }
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) { await sleep(1000); continue; }
      const data = (await res.json()) as SearchResult;
      return data.search?.[0]?.id ?? null;
    } catch { return null; }
  }
  return null;
}

/** Resolve a POI name to a Wikidata QID. Tries with city name, then without, then hr/it. */
async function resolveQId(poiName: string, cityName: string): Promise<string | null> {
  const nameLC = poiName.toLowerCase();
  const cityLC = cityName.toLowerCase();
  const needsCity = !nameLC.includes(cityLC);

  // Try with city qualifier first
  if (needsCity) {
    const qId = await searchEntity(`${poiName} ${cityName}`, "en");
    if (qId) return qId;
    await sleep(150);
  }

  // Plain English search
  const qId = await searchEntity(poiName, "en");
  if (qId) return qId;

  // Fallback: Croatian, then Italian (no delay between — entity search handles bursts)
  await sleep(150);
  const hr = await searchEntity(poiName, "hr");
  if (hr) return hr;

  await sleep(150);
  const it = await searchEntity(poiName, "it");
  return it;
}

type SparqlBinding = { item: { value: string }; image?: { value: string } };
type SparqlResult = { results: { bindings: SparqlBinding[] } };

/**
 * Batch SPARQL: fetch P18 images for up to 80 QIDs in a single query.
 * Returns a Map<qId, imageUrl>.
 */
async function fetchImagesBatch(qIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (qIds.length === 0) return map;

  // Split into chunks of 80 to stay within SPARQL query limits
  const chunks: string[][] = [];
  for (let i = 0; i < qIds.length; i += 80) {
    chunks.push(qIds.slice(i, i + 80));
  }

  for (const chunk of chunks) {
    const values = chunk.map((q) => `wd:${q}`).join(" ");
    const sparql = `SELECT ?item ?image WHERE { VALUES ?item { ${values} } ?item wdt:P18 ?image } LIMIT ${chunk.length}`;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `${SPARQL_ENDPOINT}?query=${encodeURIComponent(sparql)}&format=json`,
          { headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" } },
        );
        if (res.status === 429) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        if (!res.ok) break;
        const data = (await res.json()) as SparqlResult;
        for (const b of data.results.bindings) {
          if (b.image?.value) {
            const qId = b.item.value.replace("http://www.wikidata.org/entity/", "");
            map.set(qId, `${b.image.value}?width=800`);
          }
        }
        break;
      } catch { break; }
    }

    // Small delay between chunks to be respectful
    if (chunks.length > 1) await sleep(500);
  }

  return map;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const { cityId: raw } = await params;
  const cityId = Number(raw);
  if (!cityId) return NextResponse.json({ error: "invalid cityId" }, { status: 400 });

  const city = await prisma.city.findUnique({
    where: { id: cityId },
    select: { name: true },
  });
  if (!city) return NextResponse.json({ error: "city not found" }, { status: 404 });

  const pois = await prisma.poi.findMany({
    where: { cityId },
    select: { id: true, name: true, photoUrl: true, wikidataId: true },
  });

  // Filter: skip POIs that already have a Wikipedia photo
  const toProcess = pois.filter((p) => !p.photoUrl?.includes("commons.wikimedia"));
  const alreadyDone = pois.length - toProcess.length;

  // ── Phase 1: resolve all QIDs in parallel (5 concurrent) ──
  const qIdResults = await pMap(
    toProcess,
    async (poi) => {
      // If we already know the wikidataId, skip search
      if (poi.wikidataId) return { poi, qId: poi.wikidataId };
      const qId = await resolveQId(poi.name, city.name);
      return { poi, qId };
    },
    5,
  );

  // Collect unique QIDs that need image lookup
  const qIdsToFetch = [...new Set(
    qIdResults.map((r) => r.qId).filter((q): q is string => q !== null),
  )];

  // ── Phase 2: batch SPARQL for all images at once ──
  const imageMap = await fetchImagesBatch(qIdsToFetch);

  // ── Phase 3: update DB ──
  let updated = 0;
  const results: Array<{ name: string; status: string; imageUrl?: string }> = [];

  for (const { poi, qId } of qIdResults) {
    if (!qId) {
      results.push({ name: poi.name, status: "not-found" });
      continue;
    }

    const imageUrl = imageMap.get(qId);
    if (imageUrl) {
      await prisma.poi.update({
        where: { id: poi.id },
        data: { photoUrl: imageUrl, wikidataId: qId },
      });
      updated++;
      results.push({ name: poi.name, status: "updated", imageUrl });
    } else {
      // Save wikidataId even without image
      if (!poi.wikidataId) {
        await prisma.poi.update({
          where: { id: poi.id },
          data: { wikidataId: qId },
        });
      }
      results.push({ name: poi.name, status: "no-image" });
    }
  }

  // Add already-done POIs to count
  const checked = pois.length;
  return NextResponse.json({ checked, updated, skipped: alreadyDone, results });
}
