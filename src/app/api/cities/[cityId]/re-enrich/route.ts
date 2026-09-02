/**
 * POST /api/cities/:cityId/re-enrich
 *
 * Re-runs Wikidata image lookup for all POIs in a city and updates their
 * photoUrl when a Wikipedia/Commons image is found.
 *
 * Uses a lightweight, dedicated search flow to avoid the rate limits
 * that the full multi-language enrichment pipeline can trigger.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ENTITY_SEARCH = "https://www.wikidata.org/w/api.php";
const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT = "TripPlanner/1.0 (educational project)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type SearchResult = { search: Array<{ id: string }> };
type SparqlResult = { results: { bindings: Array<{ image?: { value: string } }> } };

/** Single-language entity search with retry on 429. */
async function searchEntity(query: string, lang: string): Promise<string | null> {
  const url = new URL(ENTITY_SEARCH);
  url.searchParams.set("action", "wbsearchentities");
  url.searchParams.set("search", query);
  url.searchParams.set("language", lang);
  url.searchParams.set("type", "item");
  url.searchParams.set("limit", "3");
  url.searchParams.set("format", "json");

  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url.toString(), { headers: { "User-Agent": USER_AGENT } });
      if (res.status === 429) { await sleep(3000 * (i + 1)); continue; }
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) { await sleep(2000); continue; }
      const data = (await res.json()) as SearchResult;
      return data.search?.[0]?.id ?? null;
    } catch { return null; }
  }
  return null;
}

/** Check if a Wikidata entity has a P18 image. */
async function fetchImage(qId: string): Promise<string | null> {
  const sparql = `SELECT ?image WHERE { wd:${qId} wdt:P18 ?image } LIMIT 1`;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(
        `${SPARQL_ENDPOINT}?query=${encodeURIComponent(sparql)}&format=json`,
        { headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" } },
      );
      if (res.status === 429) { await sleep(3000 * (i + 1)); continue; }
      if (!res.ok) return null;
      const data = (await res.json()) as SparqlResult;
      const imgUrl = data.results.bindings[0]?.image?.value;
      return imgUrl ? `${imgUrl}?width=800` : null;
    } catch { return null; }
  }
  return null;
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
    select: { id: true, name: true, placeId: true, photoUrl: true, wikidataId: true },
  });

  let updated = 0;
  let checked = 0;
  const results: Array<{ name: string; status: string; imageUrl?: string }> = [];

  for (const poi of pois) {
    checked++;

    // Skip if already has a Wikipedia photo
    if (poi.photoUrl?.includes("commons.wikimedia")) {
      results.push({ name: poi.name, status: "already-wiki" });
      continue;
    }

    // Rate limit: 2s between POIs
    if (checked > 1) await sleep(2000);

    try {
      // Simple English search — handles most POIs including Croatian/Italian names
      const nameLC = poi.name.toLowerCase();
      const cityLC = city.name.toLowerCase();
      const needsCity = !nameLC.includes(cityLC);
      let qId = needsCity ? await searchEntity(`${poi.name} ${city.name}`, "en") : null;
      if (!qId) {
        await sleep(500);
        qId = await searchEntity(poi.name, "en");
      }
      // Fallback: try Croatian and Italian
      if (!qId) {
        await sleep(500);
        qId = await searchEntity(poi.name, "hr");
      }
      if (!qId) {
        await sleep(500);
        qId = await searchEntity(poi.name, "it");
      }

      if (!qId) {
        results.push({ name: poi.name, status: "not-found" });
        continue;
      }

      await sleep(500);
      const imageUrl = await fetchImage(qId);

      if (imageUrl) {
        await prisma.poi.update({
          where: { id: poi.id },
          data: { photoUrl: imageUrl, wikidataId: qId },
        });
        updated++;
        results.push({ name: poi.name, status: "updated", imageUrl });
      } else {
        // Update wikidataId even without image
        if (!poi.wikidataId) {
          await prisma.poi.update({
            where: { id: poi.id },
            data: { wikidataId: qId },
          });
        }
        results.push({ name: poi.name, status: "no-image" });
      }
    } catch {
      results.push({ name: poi.name, status: "error" });
    }
  }

  return NextResponse.json({ checked, updated, results });
}
