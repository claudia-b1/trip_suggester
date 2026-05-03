/**
 * POST /api/cities/[cityId]/recommendations
 *
 * Three-layer pipeline:
 *  1. DISCOVERY  — Geoapify Places API, up to 50 raw candidates per
 *                  category.  Results are cached (PoiCache, 7 days).
 *  2. SCORING    — Rule-based engine ranks all candidates; top `count` per
 *                  category are selected.
 *  3. ENRICHMENT — Wikidata + Google Places run in parallel for each top POI.
 *                  Each source is cached independently (PoiEnrichCache, 14 days).
 *
 * Request body:
 *  categories    RecommendableCategory[]
 *  counts        Record<category, number>   per-category result limit (default 20)
 *  subcategories Record<category, string[]> sub-filter IDs (default = all)
 *  cuisineFilter string                     keyword filter for FOOD (optional)
 *  preferences   string[]                   user preference tags (passed to scorer)
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isRecommendableCategory,
  type RecommendableCategory,
} from "@/lib/recommendations";
import { searchPlaces, type DiscoveredPlace } from "@/lib/recommendations/geoapify";
import { enrichPlace } from "@/lib/recommendations/enrichment";
import { scorePoi } from "@/lib/recommendations/scoring";
import { withCache } from "@/lib/recommendations/cache";
import { haversineKm, geocodeCity } from "@/lib/recommendations/_shared";

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

  // ── Resolve city ────────────────────────────────────────────────────────────
  const city = await prisma.city.findUnique({ where: { id: cityIdNum } });
  if (!city) return NextResponse.json({ error: "City not found" }, { status: 404 });

  const center = await geocodeCity(city.name).catch(() => null);

  // ── 1. DISCOVERY — fetch raw candidates per category (cached) ────────────────
  const discoveryResults = await Promise.allSettled(
    categories.map(async (cat) => {
      const subcats = subcatsMap[cat] ?? [];
      // Include subcats in cache key so different filter combos get their own slot
      const cacheCategory = subcats.length > 0 ? `${cat}:${[...subcats].sort().join("+")}` : cat;

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

  // ── 2. SCORING — rank candidates, select top N per category ──────────────────
  const topPlaces: Array<{ place: DiscoveredPlace; category: RecommendableCategory }> = [];
  const seenIds = new Set<string>();   // cross-category dedup by placeId
  const seenNames = new Set<string>(); // cross-category dedup by name

  for (const cat of categories) {
    const places = discoveryByCategory[cat] ?? [];
    const limit  = counts[cat] ?? 10;

    // FOOD post-filters (cuisine keyword, vegetarian fallback)
    let filtered = places;
    if (cat === "FOOD" && cuisineFilter) {
      const kw = cuisineFilter.toLowerCase();
      const cuisine = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(kw) ||
          p.placeCategory.toLowerCase().includes(kw) ||
          (p.description ?? "").toLowerCase().includes(kw),
      );
      if (cuisine.length > 0) filtered = cuisine;
    }

    const scored = filtered.map((place) => {
      const distKm = center
        ? haversineKm(center.lat, center.lon, place.latitude, place.longitude)
        : 5;
      const score = scorePoi({
        rating:      place.sourceRating,
        ratingMax:   10,
        distanceKm:  distKm,
        hasImage:    !!place.photoUrl,
        reviewCount: undefined,
      });
      return { place, score };
    });

    scored.sort((a, b) => b.score - a.score);

    for (const { place } of scored.slice(0, limit * 2)) {
      // Skip duplicates across categories
      const normName = place.name.toLowerCase().trim();
      if (seenIds.has(place.placeId) || seenNames.has(normName)) continue;
      seenIds.add(place.placeId);
      seenNames.add(normName);
      topPlaces.push({ place, category: cat });
      if (topPlaces.filter((t) => t.category === cat).length >= limit) break;
    }
  }

  // ── 3. ENRICHMENT — parallel Wikidata + Google for each top POI (cached) ────
  const enriched = await Promise.allSettled(
    topPlaces.map(({ place, category }) =>
      enrichPlace(place, category, city.name),
    ),
  );

  // ── 4. PERSIST — write POIs to database ─────────────────────────────────────
  const toCreate = enriched
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((p) => p !== null);

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