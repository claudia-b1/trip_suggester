/**
 * POST /api/cities/[cityId]/recommendations
 *
 * Four-layer pipeline:
 *  1. DISCOVERY   — Geoapify Places API, up to 50 raw candidates per category.
 *                   Results are cached (PoiCache, 30 days).
 *  2. PRE-SCAN    — Google Places Text Search for ALL candidates (no photo).
 *                   Cached per-POI as "google-meta" (PoiEnrichCache, 30 days).
 *                   Candidates with a Google rating below 4.0 are dropped here.
 *  3. SCORING     — Rule-based engine using Google rating + review count;
 *                   top `count` per category selected.
 *  4. ENRICHMENT  — Wikidata + Google photo for top-N only (cached per-POI).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isRecommendableCategory,
  type RecommendableCategory,
} from "@/lib/recommendations";
import { searchPlaces, type DiscoveredPlace, CATEGORY_CATEGORIES } from "@/lib/recommendations/geoapify";
import { enrichPlace } from "@/lib/recommendations/enrichment";
import { scorePoi } from "@/lib/recommendations/scoring";
import { withCache, withEnrichCache } from "@/lib/recommendations/cache";
import { haversineKm, geocodeCity } from "@/lib/recommendations/_shared";
import { fetchGoogleMeta, type GoogleMeta } from "@/lib/recommendations/google-places";
import { fetchWikidataMini, type WikidataMini } from "@/lib/recommendations/wikidata";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const { cityId } = await params;
  const cityIdNum = Number(cityId);

  // ── Parse request body ──────────────────────────────────────────────────────
  const body = await req.json().catch(() => null);

  const rawCategories = (body?.categories ?? []) as unknown[];
  if (!Array.isArray(rawCategories)) {
    return NextResponse.json({ error: "categories must be an array" }, { status: 400 });
  }
  const categories: RecommendableCategory[] = [];
  for (const c of rawCategories) {
    if (isRecommendableCategory(c) && !categories.includes(c)) categories.push(c);
  }
  if (categories.length === 0) {
    return NextResponse.json({ error: "Pick at least one category" }, { status: 400 });
  }

  // Per-category result limits (1–100, default 20)
  const rawCounts = (body?.counts ?? {}) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawCounts)) {
    if (typeof v === "number" && v > 0) counts[k] = Math.min(Math.round(v), 100);
  }

  // Subcategory filters
  const rawSubcats = (body?.subcategories ?? {}) as Record<string, unknown>;
  const subcatsMap: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rawSubcats)) {
    if (Array.isArray(v)) subcatsMap[k] = v.filter((s): s is string => typeof s === "string");
  }

  const cuisineFilter: string | undefined =
    typeof body?.cuisineFilter === "string" ? body.cuisineFilter.trim() || undefined : undefined;

  // User preference tags (e.g. hidden_gems, budget_friendly, family_friendly)
  const preferences: string[] = Array.isArray(body?.preferences)
    ? (body.preferences as unknown[]).filter((p): p is string => typeof p === "string")
    : [];

  const overwrite: boolean = body?.overwrite === true;

  // ── Resolve city ────────────────────────────────────────────────────────────
  const city = await prisma.city.findUnique({ where: { id: cityIdNum } });
  if (!city) return NextResponse.json({ error: "City not found" }, { status: 404 });

  // ── Delete existing POIs if overwrite requested ──────────────────────────────
  if (overwrite) {
    await prisma.poi.deleteMany({ where: { cityId: cityIdNum } });
  }

  // ── Existing POIs — for deduplication (#1) ──────────────────────────────────
  const existingPois = await prisma.poi.findMany({
    where: { cityId: cityIdNum },
    select: { placeId: true, name: true },
  });
  const existingPlaceIds = new Set(
    existingPois.map((p) => p.placeId).filter((id): id is string => !!id),
  );
  const existingNames = new Set(
    existingPois.map((p) => p.name.toLowerCase().trim()),
  );

  const center = await geocodeCity(city.name).catch(() => null);

  // ── 1. DISCOVERY — fetch raw candidates per category (cached) ────────────────
  const discoveryResults = await Promise.allSettled(
    categories.map(async (cat) => {
      const subcats = subcatsMap[cat] ?? [];
      // Include subcats + cuisineFilter in cache key so different combos get their own slot
      let cacheCategory = subcats.length > 0 ? `${cat}:${[...subcats].sort().join("+")}` : cat;
      if (cat === "FOOD" && cuisineFilter) cacheCategory += `:cuisine=${cuisineFilter.toLowerCase()}`;

      const places = await withCache<DiscoveredPlace[]>(
        city.name,
        cacheCategory,
        "geoapify",
        () => searchPlaces(city.name, cat, subcats, 50),
      );
      return { cat, places };
    }),
  );

  const failures: { category: RecommendableCategory; error: string }[] = [];
  const discoveryByCategory: Record<string, DiscoveredPlace[]> = {};

  for (const result of discoveryResults) {
    if (result.status === "fulfilled") {
      discoveryByCategory[result.value.cat] = result.value.places;
    } else {
      const idx = discoveryResults.indexOf(result);
      failures.push({
        category: categories[idx],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  // ── 2. GOOGLE PRE-SCAN — Text Search for all candidates, cache as "google-meta" ────
  // Collect unique candidates across all categories
  const allCandidates: DiscoveredPlace[] = [];
  const seenPrescan = new Set<string>();
  for (const cat of categories) {
    for (const p of discoveryByCategory[cat] ?? []) {
      if (!seenPrescan.has(p.placeId)) {
        seenPrescan.add(p.placeId);
        allCandidates.push(p);
      }
    }
  }

  // Batch Google Text Searches (12 at a time) — cached per placeId
  const googleMetaMap = new Map<string, GoogleMeta | null>();
  const PRESCAN_BATCH = 12;
  for (let i = 0; i < allCandidates.length; i += PRESCAN_BATCH) {
    const batch = allCandidates.slice(i, i + PRESCAN_BATCH);
    await Promise.allSettled(
      batch.map(async (place) => {
        const meta = await withEnrichCache<GoogleMeta>(
          place.placeId,
          "google-meta",
          () => fetchGoogleMeta(place.name, city.name, place.latitude, place.longitude),
        );
        googleMetaMap.set(place.placeId, meta);
      }),
    );
  }

  // ── 2b. WIKIDATA PRE-SCAN — entity lookup + UNESCO flag for all candidates ────────
  // Batched 4 at a time to respect Wikidata SPARQL rate limits; cached per placeId.
  const wikidataMiniMap = new Map<string, WikidataMini | null>();
  const WIKIDATA_BATCH = 4;
  for (let i = 0; i < allCandidates.length; i += WIKIDATA_BATCH) {
    const batch = allCandidates.slice(i, i + WIKIDATA_BATCH);
    await Promise.allSettled(
      batch.map(async (place) => {
        const mini = await withEnrichCache<WikidataMini>(
          place.placeId,
          "wikidata-mini",
          () => fetchWikidataMini(place.name, city.name),
        );
        wikidataMiniMap.set(place.placeId, mini);
      }),
    );
  }

  // ── 3. SCORING — rank candidates using Google data, select top N per category ──────
  const topPlaces: Array<{ place: DiscoveredPlace; category: RecommendableCategory; googleMeta: GoogleMeta | null }> = [];
  const seenIds = new Set<string>();   // cross-category dedup by placeId
  const seenNames = new Set<string>(); // cross-category dedup by name

  for (const cat of categories) {
    const places = discoveryByCategory[cat] ?? [];
    const limit  = counts[cat] ?? 10;

    // FOOD post-filters — use cuisine field from Geoapify raw data (#8)
    let filtered = places;
    if (cat === "FOOD" && cuisineFilter) {
      const kw = cuisineFilter.toLowerCase();
      const byCuisine = filtered.filter(
        (p) =>
          (p.cuisine ?? "").toLowerCase().includes(kw) ||
          p.name.toLowerCase().includes(kw) ||
          p.placeCategory.toLowerCase().includes(kw) ||
          (p.description ?? "").toLowerCase().includes(kw),
      );
      if (byCuisine.length > 0) filtered = byCuisine;
    }

    const scored = filtered.map((place) => {
      const meta = googleMetaMap.get(place.placeId);
      const distKm = center
        ? haversineKm(center.lat, center.lon, place.latitude, place.longitude)
        : 5;

      // Build primaryTags from the requested category mapping
      const primaryTags = (CATEGORY_CATEGORIES[cat] ?? "").split(",").map((s) => s.trim()).filter(Boolean);

      const wikiMini = wikidataMiniMap.get(place.placeId);
      const score = scorePoi({
        // Prefer Google 1–5 rating over Geoapify 0–10 source rating
        rating:      meta?.rating ?? (place.sourceRating != null ? Math.round((place.sourceRating / 10) * 5 * 10) / 10 : undefined),
        ratingMax:   5,
        distanceKm:  distKm,
        hasImage:    !!place.photoUrl || !!meta?.photoName,
        reviewCount: meta?.userRatingCount,
        hasWikipedia: !!wikiMini?.wikidataId,
        isUnescoSite: wikiMini?.isUnescoSite,
        preferences,
        poiCategory: cat,
        priceLevel:  meta?.priceLevel ?? place.priceLevel,
        tags:        place.categories,
        primaryTags,
      });
      return { place, score, meta };
    });

    // Quality filter: only apply the 4.0 floor when enough candidates survive
    const hardFiltered = scored.filter(({ meta }) =>
      meta?.rating == null || meta.rating >= 4.0,
    );
    const qualityFiltered = hardFiltered.length >= limit ? hardFiltered : scored;

    qualityFiltered.sort((a, b) => b.score - a.score);

    for (const { place, meta: placeMeta } of qualityFiltered.slice(0, limit * 2)) {
      const normName = place.name.toLowerCase().trim();
      // Skip duplicates across categories
      if (seenIds.has(place.placeId) || seenNames.has(normName)) continue;
      // Skip POIs already in the city's collection (#1)
      if (existingPlaceIds.has(place.placeId) || existingNames.has(normName)) continue;
      seenIds.add(place.placeId);
      seenNames.add(normName);
      topPlaces.push({ place, category: cat, googleMeta: placeMeta ?? null });
      if (topPlaces.filter((t) => t.category === cat).length >= limit) break;
    }
  }

  // ── 4. ENRICHMENT — Wikidata + Google photo for top-N only (cached) ────────────
  // Pass pre-scanned GoogleMeta so enrichPlace skips the Text Search API call
  const BATCH_SIZE = 8;
  const enrichedResults: PromiseSettledResult<import("@/lib/recommendations/_shared").RecommendedPoi>[] = [];
  for (let i = 0; i < topPlaces.length; i += BATCH_SIZE) {
    const batch = topPlaces.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(({ place, category, googleMeta }) =>
        enrichPlace(place, category, city.name, googleMeta),
      ),
    );
    enrichedResults.push(...results);
  }

  // ── 4b. RE-RANK — final ordering by score, trim to per-category limits ────────
  type EnrichedEntry = { poi: import("@/lib/recommendations/_shared").RecommendedPoi; category: RecommendableCategory };
  const enrichedEntries: EnrichedEntry[] = [];
  for (let i = 0; i < enrichedResults.length; i++) {
    const r = enrichedResults[i];
    if (r.status === "fulfilled") {
      enrichedEntries.push({ poi: r.value, category: topPlaces[i].category });
    }
  }

  // Re-score with enrichment data, then trim to per-category limits
  const reScored = enrichedEntries.map(({ poi, category }) => {
    const distKm = center
      ? haversineKm(center.lat, center.lon, poi.latitude, poi.longitude)
      : 5;
    const finalScore = scorePoi({
      rating:      poi.rating,
      ratingMax:   5,
      distanceKm:  distKm,
      hasImage:    !!poi.photoUrl,
      reviewCount: poi.userRatingCount,
      hasWikipedia: !!poi.wikidataId,
      isUnescoSite: poi.isUnescoSite,
      preferences,
      poiCategory: category,
      priceLevel:  poi.priceLevel,
    });
    return { poi, category, finalScore };
  });

  // Sort within each category by final score, take the limit
  const finalPois: typeof reScored = [];
  for (const cat of categories) {
    const limit = counts[cat] ?? 10;
    const catEntries = reScored
      .filter((e) => e.category === cat)
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, limit);
    finalPois.push(...catEntries);
  }

  // ── 4. PERSIST — write POIs to database ─────────────────────────────────────
  const toCreate = finalPois.map((e) => e.poi);

  const created = await prisma.$transaction(
    toCreate.map((p) =>
      prisma.poi.create({
        data: {
          name:                     p.name,
          category:                 p.category,
          description:              p.description,
          latitude:                 p.latitude,
          longitude:                p.longitude,
          rating:                   p.rating ?? null,
          bestTimeToVisit:          p.bestTimeToVisit ?? null,
          estimatedDurationMinutes: p.estimatedDurationMinutes ?? null,
          tips:                     p.tips ?? null,
          placeId:                  p.placeId ?? null,
          priceLevel:               p.priceLevel ?? null,
          website:                  p.website ?? null,
          phoneNumber:              p.phoneNumber ?? null,
          openingHours:             p.openingHours ?? null,
          photoUrl:                 p.photoUrl ?? null,
          isUnescoSite:             p.isUnescoSite ?? false,
          inceptionYear:            p.inceptionYear ?? null,
          wikidataId:               p.wikidataId ?? null,
          cityId:                   cityIdNum,
        },
      }),
    ),
  );

  return NextResponse.json(
    { created: created.length, failures },
    { status: failures.length === 0 ? 201 : 207 },
  );
}