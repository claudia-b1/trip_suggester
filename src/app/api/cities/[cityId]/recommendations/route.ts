/**
 * POST /api/cities/[cityId]/recommendations
 *
 * Four-layer pipeline:
 *  1. DISCOVERY   — Geoapify Places API, called live on every run (no cache).
 *                   Up to 100 raw candidates per category, using the user's
 *                   radius slider as the actual Geoapify search radius.
 *                   Nearby: 1 centre + 6 ring searches per eligible category.
 *  2. PRE-SCAN    — Google Places Text Search for a filtered subset of candidates.
 *                   Results cached per-POI as "google-meta" (PoiEnrichCache, 30 days)
 *                   — if a place was already looked up, the cache is used directly.
 *  3. SCORING     — Two rule-based formulas (regular vs nearby); quality gates
 *                   enforce minimum rating and review count thresholds.
 *  4. ENRICHMENT  — Wikidata + Google photo for selected POIs only (cached per-POI).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";
import {
  isRecommendableCategory,
  type RecommendableCategory,
} from "@/lib/recommendations";
import { searchPlaces, discoverUnescoCities, type DiscoveredPlace, CATEGORY_CATEGORIES, SUBCAT_CATEGORIES } from "@/lib/recommendations/geoapify";
import { enrichPlace } from "@/lib/recommendations/enrichment";
import { scorePoiDetailed, scoreRegularPoi, scoreNearbyPoi, type ScoreBreakdown } from "@/lib/recommendations/scoring";
import { withEnrichCache } from "@/lib/recommendations/cache";
import { haversineKm, geocodeCity, offsetLatLon } from "@/lib/recommendations/_shared";
import { fetchGoogleMeta, type GoogleMeta } from "@/lib/recommendations/google-places";
import { SUBCATEGORIES } from "@/lib/recommendations/subcategories";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  try {
  const { cityId } = await params;
  const cityIdNum = Number(cityId);

  if (!await verifyCityOwnership(cityIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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

  const radiusKm: number =
    typeof body?.radiusKm === "number" && body.radiusKm > 0
      ? body.radiusKm
      : Infinity;

  // Persist the discover radius for this city (best-effort)
  if (isFinite(radiusKm)) {
    prisma.city.update({ where: { id: cityIdNum }, data: { discoverRadiusKm: radiusKm } }).catch(() => {});
  }

  const nearbyEnabled: boolean = body?.nearbyEnabled === true;
  const nearbyRadiusKm: number =
    typeof body?.nearbyRadiusKm === "number" && body.nearbyRadiusKm > 0
      ? body.nearbyRadiusKm
      : 30;

  // Optional center override (e.g. from travel stop accommodation)
  const bodyCenterLat: number | undefined =
    typeof body?.centerLat === "number" ? body.centerLat : undefined;
  const bodyCenterLon: number | undefined =
    typeof body?.centerLon === "number" ? body.centerLon : undefined;

  // Category-tiered quality gates: strict for tourist attractions, lenient for everyday places
  const QUALITY_GATES: Record<string, { minRating: number; minReviews: number }> = {
    CULTURE:       { minRating: 4.0, minReviews: 15 },
    NATURE:        { minRating: 4.0, minReviews: 15 },
    FOOD:          { minRating: 3.8, minReviews: 10 },
    ENTERTAINMENT: { minRating: 3.8, minReviews: 10 },
    NIGHTLIFE:     { minRating: 3.8, minReviews: 10 },
    SHOPPING:      { minRating: 3.5, minReviews: 5 },
    GROCERIES:     { minRating: 3.5, minReviews: 5 },
    WELLNESS:      { minRating: 3.5, minReviews: 5 },
    OUTDOORS:      { minRating: 3.5, minReviews: 5 },
  };

  // Categories eligible for nearby (ring-search) enrichment
  const NEARBY_CATEGORIES: RecommendableCategory[] = ["CULTURE", "NATURE"];

  // ── Resolve city ────────────────────────────────────────────────────────────
  const city = await prisma.city.findUnique({ where: { id: cityIdNum } });
  if (!city) return NextResponse.json({ error: "Destination not found" }, { status: 404 });

  // ── Delete existing POIs if overwrite requested ──────────────────────────────
  // Preserve: POIs from favourites (favouriteItemId set) and ACCOMMODATION POIs
  if (overwrite) {
    await prisma.poi.deleteMany({
      where: {
        cityId: cityIdNum,
        favouriteItemId: null,
        category: { not: "ACCOMMODATION" },
      },
    });
  }

  // ── Existing POIs — for deduplication (#1) ──────────────────────────────────
  const existingPois = await prisma.poi.findMany({
    where: { cityId: cityIdNum },
    select: { placeId: true, name: true, latitude: true, longitude: true, category: true },
  });
  const existingPlaceIds = new Set(
    existingPois.map((p) => p.placeId).filter((id): id is string => !!id),
  );
  const existingNames = new Set(
    existingPois.map((p) => p.name.toLowerCase().trim()),
  );

  // Prefer explicit center override, then city coordinates, then geocoding
  const center: { lat: number; lon: number } | null =
    bodyCenterLat != null && bodyCenterLon != null
      ? { lat: bodyCenterLat, lon: bodyCenterLon }
      : city.latitude != null && city.longitude != null
        ? { lat: city.latitude, lon: city.longitude }
        : await geocodeCity(city.name).catch(() => null);

  // Build centerOverride for searchPlaces (only when explicitly provided)
  const searchCenterOverride: { lat: number; lon: number } | undefined =
    bodyCenterLat != null && bodyCenterLon != null
      ? { lat: bodyCenterLat, lon: bodyCenterLon }
      : undefined;

  // ── 1. DISCOVERY — fetch raw candidates per category (always live) ──────────
  //
  // Geoapify is called fresh on every Discover run — no caching.  This ensures
  // the results always reflect the current radius slider and any OSM updates.
  // Google enrichment data is still cached separately (PoiEnrichCache).
  const discoveryRadiusM = isFinite(radiusKm) ? Math.round(radiusKm * 1000) : undefined;

  const discoveryResults = await Promise.allSettled(
    categories.map(async (cat) => {
      const subcats = subcatsMap[cat] ?? [];
      const places = await searchPlaces(city.name, cat, subcats, 100, discoveryRadiusM, false, searchCenterOverride);
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

  // ── 1b. RADIUS FILTER — keep only candidates within the requested radius ──────
  if (center && isFinite(radiusKm)) {
    for (const cat of categories) {
      if (discoveryByCategory[cat]) {
        discoveryByCategory[cat] = discoveryByCategory[cat].filter(
          (p) => haversineKm(center.lat, center.lon, p.latitude, p.longitude) <= radiusKm,
        );
      }
    }
  }

  // ── 1c. NEARBY DISCOVERY — multi-centre strategy ────────────────────────────
  // A single large-radius Geoapify search biases toward places near the search
  // centre (even without our own bias param). To cover the full ring, we add 6
  // ring searches whose centres are placed at 60% of nearbyRadiusKm from the
  // city in 6 evenly-spaced compass directions, each with 60% radius.
  // Geometry: worst-case gap (30° between ring centres, outer edge) = 0.566R,
  // ring radius = 0.6R → full coverage guaranteed.
  //
  //   1 centre search  : full nearbyRadiusKm, limit 200, no bias
  //   6 ring searches  : 60% radius, limit 500 each, no bias, offset centres
  //   → merge + dedup by placeId, then filter to ≤ nearbyRadiusKm from city
  const nearbyDiscoveryByCategory: Record<string, DiscoveredPlace[]> = {};

  if (nearbyEnabled && center) {
    const nearbyRadiusM  = Math.round(nearbyRadiusKm * 1000);
    const ringFraction   = 0.6;
    const ringRadiusM    = Math.round(nearbyRadiusKm * ringFraction * 1000);
    const ringDistKm     = nearbyRadiusKm * ringFraction;
    const RING_BEARINGS  = [0, 60, 120, 180, 240, 300] as const; // N, NE, SE, S, SW, NW

    const ringCentres = RING_BEARINGS.map((bearing) => ({
      bearing,
      ...offsetLatLon(center.lat, center.lon, ringDistKm, bearing),
    }));

    // Only run nearby discovery for CULTURE and NATURE — other categories
    // are not relevant for day-trip nearby attractions
    const nearbyCategories = categories.filter((c) => (NEARBY_CATEGORIES as string[]).includes(c));

    await Promise.allSettled(
      nearbyCategories.map(async (cat) => {
        // ① One centre search (full radius) — always live, no cache
        const centrePlaces = await searchPlaces(city.name, cat, [], 200, nearbyRadiusM, true);

        // ② Six ring searches (offset centres, smaller radius) — always live, no cache
        const ringResults = await Promise.allSettled(
          ringCentres.map(({ bearing, lat, lon }) =>
            searchPlaces(city.name, cat, [], 500, ringRadiusM, true, { lat, lon }),
          ),
        );

        // ③ Merge and deduplicate by placeId
        const seenIds = new Set<string>();
        const merged: DiscoveredPlace[] = [];
        for (const p of centrePlaces) {
          if (!seenIds.has(p.placeId)) { seenIds.add(p.placeId); merged.push(p); }
        }
        for (const r of ringResults) {
          if (r.status === "rejected") { console.error("[nearby] ring fetch failed:", r.reason); continue; }
          for (const p of r.value) {
            if (!seenIds.has(p.placeId)) { seenIds.add(p.placeId); merged.push(p); }
          }
        }

        // ④ Filter to within nearbyRadiusKm of city centre
        nearbyDiscoveryByCategory[cat] = merged.filter(
          (p) => haversineKm(center.lat, center.lon, p.latitude, p.longitude) <= nearbyRadiusKm,
        );

        console.log(`[nearby] cat=${cat} centre=${centrePlaces.length} rings=${ringResults.map((r) => r.status === "fulfilled" ? r.value.length : 0).join("+")} merged=${merged.length} filtered=${nearbyDiscoveryByCategory[cat].length}`);
      }),
    );
  }

  // ── 1d. UNESCO CITY INJECTION — cities/towns that ARE the UNESCO site ────────
  //
  // Geoapify's Places API indexes POI-level features only.  A UNESCO site that
  // IS a city (e.g. Venice Historic Centre, Old Town of Bruges, Verona) is
  // represented in OSM as a populated_place node with heritage=1.  searchPlaces()
  // never returns those because it only queries POI categories.
  //
  // We query discoverUnescoCities() separately and inject:
  //   • into the CULTURE regular bucket   — for cities within the regular radius
  //   • into the CULTURE nearby bucket    — for cities within the nearby radius
  //     that are not already in the regular bucket
  //
  // Because isUnescoSite=true they are always force-included in Google prescan
  // regardless of their position in the Geoapify result list.
  if (center && categories.includes("CULTURE")) {
    const regularRadiusM = isFinite(radiusKm)
      ? Math.round(radiusKm * 1000)
      : 25_000;

    const [regularUnesco, nearbyUnesco] = await Promise.all([
      discoverUnescoCities(center.lat, center.lon, regularRadiusM),
      nearbyEnabled
        ? discoverUnescoCities(center.lat, center.lon, Math.round(nearbyRadiusKm * 1000))
        : Promise.resolve([] as DiscoveredPlace[]),
    ]);

    // Merge into CULTURE regular bucket (deduplicated by placeId and name)
    const existingCultureIds = new Set(
      (discoveryByCategory["CULTURE"] ?? []).map((p) => p.placeId),
    );
    const existingCultureNames = new Set(
      (discoveryByCategory["CULTURE"] ?? []).map((p) => p.name.toLowerCase().trim()),
    );
    const newRegular = regularUnesco.filter(
      (p) =>
        !existingCultureIds.has(p.placeId) &&
        !existingCultureNames.has(p.name.toLowerCase().trim()),
    );
    if (newRegular.length > 0) {
      discoveryByCategory["CULTURE"] = [
        ...(discoveryByCategory["CULTURE"] ?? []),
        ...newRegular,
      ];
    }

    // Merge into CULTURE nearby bucket (only for cities outside the regular radius)
    if (nearbyEnabled && nearbyUnesco.length > 0) {
      const allRegularIds = new Set(
        (discoveryByCategory["CULTURE"] ?? []).map((p) => p.placeId),
      );
      const existingNearbyIds = new Set(
        (nearbyDiscoveryByCategory["CULTURE"] ?? []).map((p) => p.placeId),
      );
      const newNearby = nearbyUnesco.filter(
        (p) =>
          !allRegularIds.has(p.placeId) &&
          !existingNearbyIds.has(p.placeId),
      );
      if (newNearby.length > 0) {
        nearbyDiscoveryByCategory["CULTURE"] = [
          ...(nearbyDiscoveryByCategory["CULTURE"] ?? []),
          ...newNearby,
        ];
      }
      console.log(
        `[unesco-cities] regular=+${newRegular.length} nearby=+${newNearby.length}`,
      );
    } else if (newRegular.length > 0) {
      console.log(`[unesco-cities] regular=+${newRegular.length}`);
    }
  }

  // ── 2. GOOGLE PRE-SCAN — filtered candidates only, to stay within the 100 req/day quota ────
  //
  // Strategy:
  //  Regular places: take the top-K from Geoapify's natural ordering (OSM importance +
  //    proximity), plus force-include any UNESCO sites. K = max(limit × 3, 20) per category.
  //  Nearby places: apply a Geoapify-only coarse score (5 binary signals), take top-60
  //    per eligible category (CULTURE + NATURE only).
  //
  // For all candidates, use place.poiCityName (the actual municipality from Geoapify)
  // as the Google query city name so nearby places in different towns are found correctly.

  const regularPlaceIds = new Set(
    categories.flatMap((cat) => (discoveryByCategory[cat] ?? []).map((p) => p.placeId)),
  );

  // ── 2a. Regular candidates: collect all, then per-category pre-filter ──────
  const allRegularCandidates: DiscoveredPlace[] = [];
  const seenRegular = new Set<string>();
  for (const cat of categories) {
    for (const p of discoveryByCategory[cat] ?? []) {
      if (!seenRegular.has(p.placeId)) {
        seenRegular.add(p.placeId);
        allRegularCandidates.push(p);
      }
    }
  }

  const PRESCAN_MULTIPLIER = 4;
  const prescanIds = new Set<string>();
  for (const cat of categories) {
    const catPlaces = discoveryByCategory[cat] ?? [];
    const k = Math.max((counts[cat] ?? 10) * PRESCAN_MULTIPLIER, 20);
    // Force-include UNESCO sites and Wikidata-linked places regardless of list position
    for (const p of catPlaces) {
      if (p.isUnescoSite || p.wikidataId) prescanIds.add(p.placeId);
    }
    // Top-K from Geoapify's natural ordering (OSM importance + proximity bias)
    catPlaces.slice(0, k).forEach((p) => prescanIds.add(p.placeId));
  }

  const regularCandidates = allRegularCandidates.filter((p) => prescanIds.has(p.placeId));

  // ── 2b. Nearby candidates: Geoapify coarse score → top-60 per eligible category ──
  const nearbyOnlyPlaceIds = new Set<string>();
  const nearbyCandidatesFiltered: DiscoveredPlace[] = [];

  if (nearbyEnabled) {
    /** Coarse score using only Geoapify data (no API call). Max = 13. */
    function nearbyCoarseScore(place: DiscoveredPlace): number {
      if (place.isUnescoSite) return 100; // always include
      let score = 0;
      if (place.wikidataId)            score += 5;
      if (place.hasInternationalName)  score += 4;
      if (place.website)               score += 2;
      if (place.categories.some((c) =>
        c === "tourism" || c.startsWith("tourism.attraction") || c.startsWith("tourism.sights"),
      )) score += 2; // boolean: +2 if any match, not cumulative
      return score;
    }

    const NEARBY_PRESCAN_LIMIT = 60;
    const nearbyPrescanIds = new Set<string>();

    for (const cat of NEARBY_CATEGORIES.filter((c) => categories.includes(c))) {
      const catNearbyOnly = (nearbyDiscoveryByCategory[cat] ?? []).filter(
        (p) => !regularPlaceIds.has(p.placeId),
      );
      // Track all nearby-only IDs (used in step 3 to identify nearby POIs)
      catNearbyOnly.forEach((p) => nearbyOnlyPlaceIds.add(p.placeId));

      // Coarse score + keep top 60 per category for Google scanning
      catNearbyOnly
        .map((p) => ({ p, score: nearbyCoarseScore(p) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, NEARBY_PRESCAN_LIMIT)
        .forEach(({ p }) => nearbyPrescanIds.add(p.placeId));
    }

    // Collect deduplicated nearby candidates for the prescan
    const seenNearbyPrescan = new Set<string>();
    for (const cat of NEARBY_CATEGORIES.filter((c) => categories.includes(c))) {
      for (const p of nearbyDiscoveryByCategory[cat] ?? []) {
        if (nearbyPrescanIds.has(p.placeId) && !seenNearbyPrescan.has(p.placeId)) {
          seenNearbyPrescan.add(p.placeId);
          nearbyCandidatesFiltered.push(p);
        }
      }
    }
  }

  // ── 2c. Run Google Text Search for the filtered candidate set ─────────────
  // Use place.poiCityName (actual municipality from Geoapify) as the query city
  // so nearby places in different towns are matched correctly.
  const googleMetaMap = new Map<string, GoogleMeta | null>();
  const PRESCAN_BATCH = 12;
  const allPrescanCandidates = [...regularCandidates, ...nearbyCandidatesFiltered];

  console.log(`[prescan] regular=${regularCandidates.length} nearby=${nearbyCandidatesFiltered.length} total=${allPrescanCandidates.length}`);

  for (let i = 0; i < allPrescanCandidates.length; i += PRESCAN_BATCH) {
    const batch = allPrescanCandidates.slice(i, i + PRESCAN_BATCH);
    await Promise.allSettled(
      batch.map(async (place) => {
        // Use the POI's actual city from Geoapify rather than the trip city.
        // This prevents wrong Google matches for nearby places in different municipalities.
        const queryCityName = place.poiCityName ?? city.name;
        const meta = await withEnrichCache<GoogleMeta>(
          place.placeId,
          "google-meta",
          () => fetchGoogleMeta(place.name, queryCityName, place.latitude, place.longitude, place.tourism, place.streetName, place.address),
          undefined,   // ttlDays — use default
          nearbyOnlyPlaceIds.has(place.placeId), // skipCachedNull for nearby (cache-healing for old wrong-city nulls)
        );
        googleMetaMap.set(place.placeId, meta);
      }),
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Logarithmic distance penalty (0–70).
   *
   * Dead zone: mismatches < 50 m → 0 penalty (GPS precision noise between
   * OSM and Google — same place, different anchor point).
   *
   * Above 50 m: logarithmic decay starting from 50 m.
   *   ~4 at 65 m,  ~22 at 250 m,  ~33 at 500 m,  ~41 at 1 km,  70 at ≥8 km.
   * No Google match → 70 (max penalty).
   */
  function computeCoordScore(
    geoLat: number,
    geoLon: number,
    meta: GoogleMeta | null | undefined,
  ): number {
    if (!meta?.latitude || !meta?.longitude) return 70;
    const distM = haversineKm(geoLat, geoLon, meta.latitude, meta.longitude) * 1000;
    if (distM < 50) return 0;
    return Math.min(
      70,
      70 * (Math.log1p(distM) - Math.log1p(50)) / (Math.log1p(8000) - Math.log1p(50)),
    );
  }

  /** Map a POI's Geoapify category tags to the first matching subcategory ID.
   *  Matches when:
   *  - POI cat equals a tag exactly ("catering.restaurant" = "catering.restaurant")
   *  - POI cat is a child of a tag ("catering.restaurant.italian" starts with "catering.restaurant.")
   *  - POI cat is a parent of a tag ("tourism.sights" → tag "tourism.sights.castle" starts with "tourism.sights.")
   *    This covers generic Geoapify tags that don't specify a sub-type.
   */
  function getPoiSubcat(poiCats: string[], mainCat: RecommendableCategory): string | null {
    // Score each subcategory by match quality:
    //   exact match (c === t)        → best:  c.length * 3
    //   POI is child of tag (c > t)  → good:  t.length * 2
    //   tag is child of POI (t > c)  → weak:  c.length
    // Highest score wins — this ensures "catering.cafe" matches "cafe" not "restaurant".
    let bestId: string | null = null;
    let bestScore = -1;
    for (const def of SUBCATEGORIES[mainCat]) {
      const tags = (SUBCAT_CATEGORIES[def.id] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const c of poiCats) {
        for (const t of tags) {
          let score = -1;
          if (c === t) score = c.length * 3;
          else if (c.startsWith(t + ".")) score = t.length * 2;
          else if (t.startsWith(c + ".")) score = c.length;
          if (score > bestScore) {
            bestScore = score;
            bestId = def.id;
          }
        }
      }
    }
    return bestId;
  }

  type ScoredCandidate = { place: DiscoveredPlace; score: number; breakdown: ScoreBreakdown; meta: GoogleMeta | null | undefined; distKm: number };

  // ── 3. SCORING — two formulas: regular (city-radius) vs nearby (ring-search) ─
  //
  // Regular: scoreRegularPoi — quality gate ≥4.0 stars AND ≥15 reviews, select top N
  // Nearby:  scoreNearbyPoi  — quality gate ≥4.0 stars AND ≥1 000 reviews, select top 30
  //
  // Both are scored and selected separately, then combined for step 4 enrichment.

  const topPlaces: Array<{ place: DiscoveredPlace; category: RecommendableCategory; googleMeta: GoogleMeta | null }> = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  // Pre-seed with existing POI coordinates so cross-run duplicates
  // (same physical place, different placeId or slightly different name) are caught.
  // Only dedup within the SAME category — a supermarket next to a campsite
  // are different POIs even if they're 50m apart.
  const seenCoordsByCategory = new Map<string, Array<{ lat: number; lon: number }>>();
  for (const p of existingPois) {
    if (p.latitude == null || p.longitude == null || !p.category) continue;
    const arr = seenCoordsByCategory.get(p.category) ?? [];
    arr.push({ lat: p.latitude, lon: p.longitude });
    seenCoordsByCategory.set(p.category, arr);
  }
  // Also keep a flat list for cross-category dedup of newly selected POIs
  const seenCoords: Array<{ lat: number; lon: number; category: string }> = existingPois
    .filter((p) => p.latitude != null && p.longitude != null && p.category)
    .map((p) => ({ lat: p.latitude!, lon: p.longitude!, category: p.category! }));
  // 100 m threshold: same garden/museum complex can have different OSM nodes
  // tens of metres apart; 100 m catches those while keeping truly different POIs apart.
  const COORD_DEDUP_M = 100;
  const MIN_SCORE = 20;

  type CandidateRow = {
    name: string; category: string; placeId: string;
    latitude: number; longitude: number; distanceKm: number;
    googleRating: number | null; reviewCount: number | null;
    score: number; breakdown: ScoreBreakdown;
    subcategory: string | null;
    selected: boolean; rejectedReason: string | null;
  };
  const allCandidateRows: CandidateRow[] = [];

  /** Shared helper: sort scored items, dedup against seen sets, select up to `limit`. */
  function selectTopN(
    scoredItems: ScoredCandidate[],
    limit: number,
    qualityDroppedSet: Set<string>,
    /** Category being selected — coord dedup only applies within the same category */
    forCategory?: string,
  ): { selected: ScoredCandidate[]; coordDupSet: Set<string> } {
    scoredItems.sort((a, b) => b.score - a.score);
    const coordDupSet = new Set<string>();
    const selected: ScoredCandidate[] = [];
    for (const item of scoredItems) {
      if (selected.length >= limit) break;
      if (qualityDroppedSet.has(item.place.placeId)) continue;
      if (item.score < MIN_SCORE) continue;
      const norm = item.place.name.toLowerCase().trim();
      if (existingPlaceIds.has(item.place.placeId) || existingNames.has(norm)) continue;
      if (seenIds.has(item.place.placeId) || seenNames.has(norm)) continue;
      // Coord dedup: only against same-category POIs (a supermarket next to a
      // campsite are different POIs even at 50m apart)
      const sameCatCoords = forCategory
        ? seenCoords.filter((c) => c.category === forCategory)
        : seenCoords;
      const nearSeen = sameCatCoords.some(
        (c) => haversineKm(c.lat, c.lon, item.place.latitude, item.place.longitude) * 1000 < COORD_DEDUP_M,
      );
      if (nearSeen) { coordDupSet.add(item.place.placeId); continue; }
      selected.push(item);
    }
    return { selected, coordDupSet };
  }

  for (const cat of categories) {
    const limit = counts[cat] ?? 10;

    // ── 3a. Regular places ──────────────────────────────────────────────────
    let regularPlaces = discoveryByCategory[cat] ?? [];

    // FOOD cuisine filter
    if (cat === "FOOD" && cuisineFilter) {
      const kw = cuisineFilter.toLowerCase();
      const byCuisine = regularPlaces.filter(
        (p) =>
          (p.cuisine ?? "").toLowerCase().includes(kw) ||
          p.name.toLowerCase().includes(kw) ||
          p.placeCategory.toLowerCase().includes(kw) ||
          (p.description ?? "").toLowerCase().includes(kw),
      );
      if (byCuisine.length > 0) regularPlaces = byCuisine;
    }

    const primaryTags = (CATEGORY_CATEGORIES[cat] ?? "").split(",").map((s) => s.trim()).filter(Boolean);

    const scoredRegular: ScoredCandidate[] = regularPlaces.map((place) => {
      const meta = googleMetaMap.get(place.placeId);
      const distKm = center
        ? haversineKm(center.lat, center.lon, place.latitude, place.longitude)
        : 5;
      const breakdown = scoreRegularPoi({
        rating:           meta?.rating,
        reviewCount:      meta?.userRatingCount,
        distanceKm:       distKm,
        hasWikidataId:    !!place.wikidataId,
        isUnescoSite:     place.isUnescoSite,
        hasPhoto:         !!place.photoUrl || !!meta?.photoName,
        googleCoordScore: computeCoordScore(place.latitude, place.longitude, meta),
        tags:             place.categories,
        primaryTags,
        preferences,
        poiCategory:      cat,
        priceLevel:       meta?.priceLevel ?? place.priceLevel,
      });
      return { place, score: breakdown.total, breakdown, meta: meta ?? null, distKm };
    });

    // Quality gate: must have a Google match with rating and reviews above the
    // category-specific thresholds. Strict for tourist attractions (CULTURE, NATURE),
    // lenient for everyday places (SHOPPING, GROCERIES, etc.).
    // Wrong-entity matches (same name, different location) are already handled by
    // the coord-mismatch penalty in computeCoordScore — they score to 0 and are
    // dropped by MIN_SCORE, so no special case is needed here.
    const gate = QUALITY_GATES[cat] ?? { minRating: 4.0, minReviews: 15 };
    const regularQualityDropped = new Set(
      scoredRegular
        .filter(({ meta }) =>
          meta == null ||
          meta.rating == null || meta.rating < gate.minRating ||
          meta.userRatingCount == null || meta.userRatingCount < gate.minReviews,
        )
        .map((s) => s.place.placeId),
    );
    const qualifiedRegular = scoredRegular.filter((s) => !regularQualityDropped.has(s.place.placeId));

    // Detailed quality gate logging
    const noGoogleMatch = scoredRegular.filter(({ meta }) => meta == null);
    const lowRating = scoredRegular.filter(({ meta }) => meta != null && meta.rating != null && meta.rating < gate.minRating);
    const lowReviews = scoredRegular.filter(({ meta }) => meta != null && meta.userRatingCount != null && meta.userRatingCount < gate.minReviews && (meta.rating == null || meta.rating >= gate.minRating));
    console.log(
      `[scoring] cat=${cat} discovered=${regularPlaces.length} prescan=${scoredRegular.length}` +
      ` qualityDropped=${regularQualityDropped.size} (noGoogle=${noGoogleMatch.length} lowRating=${lowRating.length} lowReviews=${lowReviews.length})` +
      ` qualified=${qualifiedRegular.length} gate={${gate.minRating}★, ${gate.minReviews} reviews}`,
    );
    // Log quality-dropped candidates for debugging
    for (const item of scoredRegular.filter((s) => s.meta != null && regularQualityDropped.has(s.place.placeId)).slice(0, 5)) {
      console.log(`  [quality-dropped] "${item.place.name}" rating=${item.meta?.rating ?? "?"} reviews=${item.meta?.userRatingCount ?? "?"}`);
    }
    for (const item of noGoogleMatch.slice(0, 5)) {
      console.log(`  [no-google-match] "${item.place.name}" addr=${item.place.address ?? "?"}`);
    }

    const { selected: selectedRegular, coordDupSet: regularCoordDupSet } =
      selectTopN(qualifiedRegular, limit, new Set(), cat);

    const selectedRegularIds = new Set(selectedRegular.map((s) => s.place.placeId));

    console.log(
      `[scoring] cat=${cat} selected=${selectedRegular.length}/${limit}` +
      ` names=[${selectedRegular.slice(0, 5).map((s) => s.place.name).join(", ")}${selectedRegular.length > 5 ? "..." : ""}]`,
    );

    // Candidate logging for regular
    for (const { place, score, breakdown, meta, distKm } of scoredRegular) {
      const norm = place.name.toLowerCase().trim();
      let rejectedReason: string | null;
      if (regularQualityDropped.has(place.placeId)) {
        rejectedReason = "quality_filter";
      } else if (score < MIN_SCORE) {
        rejectedReason = "low_score";
      } else if (existingPlaceIds.has(place.placeId) || existingNames.has(norm)) {
        rejectedReason = "existing";
      } else if (regularCoordDupSet.has(place.placeId)) {
        rejectedReason = "duplicate";
      } else if (seenIds.has(place.placeId) || seenNames.has(norm)) {
        rejectedReason = "duplicate";
      } else if (selectedRegularIds.has(place.placeId)) {
        rejectedReason = null; // selected
      } else {
        rejectedReason = "not_top_n";
      }
      allCandidateRows.push({
        name: place.name, category: cat, placeId: place.placeId,
        latitude: place.latitude, longitude: place.longitude, distanceKm: distKm,
        googleRating: meta?.rating ?? null, reviewCount: meta?.userRatingCount ?? null,
        score, breakdown, subcategory: getPoiSubcat(place.categories, cat),
        selected: rejectedReason === null, rejectedReason,
      });
    }

    // Commit regular selections to cross-category dedup sets
    for (const { place, meta } of selectedRegular) {
      seenIds.add(place.placeId);
      seenNames.add(place.name.toLowerCase().trim());
      seenCoords.push({ lat: place.latitude, lon: place.longitude, category: cat });
      topPlaces.push({ place, category: cat, googleMeta: meta ?? null });
    }

    // ── 3b. Nearby places (CULTURE + NATURE only) ───────────────────────────
    if (nearbyEnabled && (NEARBY_CATEGORIES as string[]).includes(cat)) {
      const NEARBY_PER_CAT_LIMIT = 30;

      const nearbyPlaces = (nearbyDiscoveryByCategory[cat] ?? []).filter(
        (p) => nearbyOnlyPlaceIds.has(p.placeId),
      );

      const scoredNearby: ScoredCandidate[] = nearbyPlaces.map((place) => {
        const meta = googleMetaMap.get(place.placeId);
        const distKm = center
          ? haversineKm(center.lat, center.lon, place.latitude, place.longitude)
          : 30;
        const breakdown = scoreNearbyPoi({
          rating:           meta?.rating,
          reviewCount:      meta?.userRatingCount,
          hasWikidataId:    !!place.wikidataId,
          isUnescoSite:     place.isUnescoSite,
          hasPhoto:         !!place.photoUrl || !!meta?.photoName,
          googleCoordScore: computeCoordScore(place.latitude, place.longitude, meta),
        });
        return { place, score: breakdown.total, breakdown, meta: meta ?? null, distKm };
      });

      // Quality gate: must have a Google match with rating ≥ 4.0 AND ≥ 1 000 reviews.
      const nearbyQualityDropped = new Set(
        scoredNearby
          .filter(({ meta }) =>
            meta == null ||
            meta.rating == null || meta.rating < 4.0 ||
            meta.userRatingCount == null || meta.userRatingCount < 1000,
          )
          .map((s) => s.place.placeId),
      );
      const qualifiedNearby = scoredNearby.filter((s) => !nearbyQualityDropped.has(s.place.placeId));

      const { selected: selectedNearby, coordDupSet: nearbyCoordDupSet } =
        selectTopN(qualifiedNearby, NEARBY_PER_CAT_LIMIT, new Set(), cat);

      const selectedNearbyIds = new Set(selectedNearby.map((s) => s.place.placeId));

      console.log(`[nearby] cat=${cat} candidates=${nearbyPlaces.length} qualityDropped=${nearbyQualityDropped.size} qualified=${qualifiedNearby.length} selected=${selectedNearby.length}`);

      // Candidate logging for nearby
      for (const { place, score, breakdown, meta, distKm } of scoredNearby) {
        const norm = place.name.toLowerCase().trim();
        let rejectedReason: string | null;
        if (nearbyQualityDropped.has(place.placeId)) {
          rejectedReason = "quality_filter";
        } else if (score < MIN_SCORE) {
          rejectedReason = "low_score";
        } else if (existingPlaceIds.has(place.placeId) || existingNames.has(norm)) {
          rejectedReason = "existing";
        } else if (nearbyCoordDupSet.has(place.placeId)) {
          rejectedReason = "duplicate";
        } else if (seenIds.has(place.placeId) || seenNames.has(norm)) {
          rejectedReason = "duplicate";
        } else if (selectedNearbyIds.has(place.placeId)) {
          rejectedReason = null; // selected
        } else {
          rejectedReason = "not_top_n";
        }
        allCandidateRows.push({
          name: place.name, category: cat, placeId: place.placeId,
          latitude: place.latitude, longitude: place.longitude, distanceKm: distKm,
          googleRating: meta?.rating ?? null, reviewCount: meta?.userRatingCount ?? null,
          score, breakdown, subcategory: getPoiSubcat(place.categories, cat),
          selected: rejectedReason === null, rejectedReason,
        });
      }

      // Commit nearby selections to cross-category dedup sets
      for (const { place, meta } of selectedNearby) {
        seenIds.add(place.placeId);
        seenNames.add(place.name.toLowerCase().trim());
        seenCoords.push({ lat: place.latitude, lon: place.longitude, category: cat });
        topPlaces.push({ place, category: cat, googleMeta: meta ?? null });
      }
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
    const breakdown = scorePoiDetailed({
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
    return { poi, category, finalScore: breakdown.total, breakdown };
  });

  // Sort within each category by final score.
  // Regular POIs: trim to the user's per-category limit.
  // Nearby POIs: always keep up to 30 — independent of the max filter.
  const NEARBY_RERANK_LIMIT = 30;
  const finalPois: typeof reScored = [];
  for (const cat of categories) {
    const limit = counts[cat] ?? 10;
    const catEntries = reScored.filter((e) => e.category === cat);

    const regularEntries = catEntries
      .filter((e) => !nearbyOnlyPlaceIds.has(e.poi.placeId ?? ""))
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, limit);

    const nearbyEntries = catEntries
      .filter((e) => nearbyOnlyPlaceIds.has(e.poi.placeId ?? ""))
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, NEARBY_RERANK_LIMIT);

    finalPois.push(...regularEntries, ...nearbyEntries);
  }

  // Map placeId → subcategory for final POI insert
  const poiSubcategoryMap = new Map<string, string | null>();
  for (const row of allCandidateRows) {
    if (row.selected && row.placeId) poiSubcategoryMap.set(row.placeId, row.subcategory);
  }

  // ── 5. PERSIST CANDIDATES — replace previous run's candidate log ────────────
  await prisma.poiCandidate.deleteMany({ where: { cityId: cityIdNum } });
  await prisma.poiCandidate.createMany({
    data: allCandidateRows.map((c) => ({
      cityId:        cityIdNum,
      name:          c.name,
      category:      c.category,
      placeId:       c.placeId,
      latitude:      c.latitude,
      longitude:     c.longitude,
      distanceKm:    c.distanceKm,
      googleRating:  c.googleRating,
      reviewCount:   c.reviewCount,
      score:         c.score,
      scoreBreakdown: JSON.stringify(c.breakdown),
      subcategory:   c.subcategory,
      selected:      c.selected,
      rejectedReason: c.rejectedReason,
    })),
  });

  // ── 6. PERSIST POIS — write selected POIs to database ───────────────────────
  const created = await prisma.$transaction(
    finalPois.map(({ poi: p, finalScore, breakdown }) =>
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
          fee:                      p.fee ?? null,
          score:                    finalScore,
          scoreBreakdown:           JSON.stringify(breakdown),
          userRatingCount:          p.userRatingCount ?? null,
          subcategory:              poiSubcategoryMap.get(p.placeId ?? "") ?? null,
          cityId:                   cityIdNum,
        },
      }),
    ),
  );

  return NextResponse.json(
    { created: created.length, failures },
    { status: failures.length === 0 ? 201 : 207 },
  );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[recommendations] uncaught error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}