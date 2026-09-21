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
import { scorePoiDetailed, scoreRegularPoi, scoreNearbyPoi, nameSimilarity, type ScoreBreakdown } from "@/lib/recommendations/scoring";
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
        : await geocodeCity(
            city.name,
            city.latitude != null && city.longitude != null ? { lat: city.latitude, lon: city.longitude } : null,
          ).catch(() => null);

  // Build centerOverride for searchPlaces — prefer explicit body override,
  // then stored city coordinates, so searchPlaces doesn't re-geocode the city
  // name (which can resolve to the wrong place for ambiguous names like "Bale").
  const searchCenterOverride: { lat: number; lon: number } | undefined =
    bodyCenterLat != null && bodyCenterLon != null
      ? { lat: bodyCenterLat, lon: bodyCenterLon }
      : city.latitude != null && city.longitude != null
        ? { lat: city.latitude, lon: city.longitude }
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
        const centrePlaces = await searchPlaces(city.name, cat, [], 200, nearbyRadiusM, true, searchCenterOverride);

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

  // ── 1d. MUST-VISIT INJECTION — fill gaps from LLM reference list ────────────
  // Generate a must-visit list, check which names are missing from discovery,
  // then resolve them via Geoapify name search (with local-name fallback) or
  // Google Places. Injected places enter the normal pre-scan → scoring pipeline.
  let mustVisitNames: string[] = [];
  let injectedGoogleMetaMap = new Map<string, GoogleMeta>();
  try {
    const { getMustVisitList, injectMustVisitPlaces, classifyGoogleTypes } = await import("@/lib/recommendations/must-visit");
    mustVisitNames = await getMustVisitList(
      cityIdNum,
      city.name,
      city.country ?? "",
      center?.lat ?? 0,
      center?.lon ?? 0,
      categories,
    );

    if (mustVisitNames.length && center) {
      const allDiscovered = categories.flatMap((cat) => discoveryByCategory[cat] ?? []);
      const { places: injectedPlaces, googleMetaByPlaceId: injectedGoogleMeta } =
        await injectMustVisitPlaces(mustVisitNames, allDiscovered, city.name, city.country ?? "", center.lat, center.lon, radiusKm);

      // Add injected places to the best-matching category's discovery list.
      // Match the place's Geoapify tags against CATEGORY_CATEGORIES to find
      // the right bucket (e.g. a restaurant goes to FOOD, not CULTURE).
      //
      // First pass: tag-based routing. Collect unmatched places for LLM classification.
      const matched: Array<{ place: DiscoveredPlace; cat: string }> = [];
      const unmatched: Array<{ place: DiscoveredPlace; primaryType: string }> = [];
      for (const place of injectedPlaces) {
        let bestCat = categories[0];
        let bestHits = 0;
        for (const cat of categories) {
          const catTags = (CATEGORY_CATEGORIES[cat as RecommendableCategory] ?? "").split(",").map((s) => s.trim());
          const hits = place.categories.filter((t) =>
            catTags.some((ct) => t === ct || t.startsWith(ct + ".") || ct.startsWith(t + ".")),
          ).length;
          if (hits > bestHits) { bestHits = hits; bestCat = cat; }
        }
        if (bestHits > 0) {
          matched.push({ place, cat: bestCat });
        } else {
          // Try to find the Google primaryType for LLM classification
          const gMeta = injectedGoogleMeta.get(place.placeId);
          if (gMeta?.primaryType) {
            unmatched.push({ place, primaryType: gMeta.primaryType });
          } else {
            // No primaryType available — fall back to first category
            matched.push({ place, cat: categories[0] });
          }
        }
      }

      // LLM classification for unmatched types (single batched call, cached by type)
      if (unmatched.length) {
        const llmResults = await classifyGoogleTypes(
          unmatched.map((u) => ({ name: u.place.name, primaryType: u.primaryType })),
          categories,
        );
        for (const { place, primaryType } of unmatched) {
          const llmCat = llmResults.get(primaryType.toLowerCase());
          const cat = llmCat && (categories as string[]).includes(llmCat) ? llmCat : categories[0];
          console.log(`[type-classify] "${place.name}" (${primaryType}) → ${cat}${llmCat ? " (LLM)" : " (fallback)"}`);
          matched.push({ place, cat });
        }
      }

      // Add all to discovery buckets
      for (const { place, cat } of matched) {
        if (!discoveryByCategory[cat]) discoveryByCategory[cat] = [];
        discoveryByCategory[cat].push(place);
      }

      // Store for merging into googleMetaMap after pre-scan
      injectedGoogleMetaMap = injectedGoogleMeta;
    }
  } catch (e) {
    console.error("[recommendations] must-visit injection failed:", e);
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

  const PRESCAN_MULTIPLIER = 3;
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
  const PRESCAN_BATCH = 40;
  const allPrescanCandidates = [...regularCandidates, ...nearbyCandidatesFiltered];

  console.log(`[prescan] regular=${regularCandidates.length} nearby=${nearbyCandidatesFiltered.length} total=${allPrescanCandidates.length}`);

  for (let i = 0; i < allPrescanCandidates.length; i += PRESCAN_BATCH) {
    const batch = allPrescanCandidates.slice(i, i + PRESCAN_BATCH);
    await Promise.allSettled(
      batch.map(async (place) => {
        // Use the POI's actual city from Geoapify rather than the trip city.
        // This prevents wrong Google matches for nearby places in different municipalities.
        const queryCityName = place.poiCityName ?? city.name;
        let meta = await withEnrichCache<GoogleMeta>(
          place.placeId,
          "google-meta",
          () => fetchGoogleMeta(place.name, queryCityName, place.latitude, place.longitude, place.tourism, place.streetName, place.address),
          undefined,   // ttlDays — use default
          nearbyOnlyPlaceIds.has(place.placeId), // skipCachedNull for nearby (cache-healing for old wrong-city nulls)
        );
        // Stale cache migration: entries cached before primaryType was added to
        // the Google field mask are missing it. Re-fetch to get the full data.
        if (meta && !meta.primaryType) {
          meta = await withEnrichCache<GoogleMeta>(
            place.placeId,
            "google-meta",
            () => fetchGoogleMeta(place.name, queryCityName, place.latitude, place.longitude, place.tourism, place.streetName, place.address),
            0,  // force cache miss by setting TTL to 0
          );
        }
        googleMetaMap.set(place.placeId, meta);
      }),
    );
  }

  // Merge pre-resolved Google meta for must-visit Google-fallback places
  for (const [placeId, meta] of injectedGoogleMetaMap) {
    if (!googleMetaMap.has(placeId)) googleMetaMap.set(placeId, meta);
  }

  // ── Google-based reclassification ─────────────────────────────────────────
  // Geoapify sometimes miscategorises places (e.g. a wine bar tagged as
  // "tourism.attraction.artwork.statue"). After the Google prescan we know the
  // Google primaryType, which is usually correct. Move places whose Google type
  // clearly belongs to a different selected category.
  {
    const { googleTypeToCategoryKey } = await import("@/lib/recommendations/must-visit");
    let reclassified = 0;
    for (const sourceCat of categories) {
      const places = discoveryByCategory[sourceCat];
      if (!places) continue;
      const toRemove: Set<string> = new Set();
      for (const place of places) {
        const gMeta = googleMetaMap.get(place.placeId);
        if (!gMeta?.primaryType) {
          if (gMeta) console.log(`[reclassify] "${place.name}" in ${sourceCat} has Google match but no primaryType`);
          continue;
        }
        const correctCat = googleTypeToCategoryKey(gMeta.primaryType);
        if (!correctCat || correctCat === sourceCat) continue;
        // Only move if the correct category is one the user selected
        if (!(categories as string[]).includes(correctCat)) continue;
        console.log(`[reclassify] "${place.name}" ${sourceCat} → ${correctCat} (Google type: ${gMeta.primaryType})`);
        if (!discoveryByCategory[correctCat]) discoveryByCategory[correctCat] = [];
        discoveryByCategory[correctCat].push(place);
        toRemove.add(place.placeId);
        reclassified++;
      }
      if (toRemove.size) {
        discoveryByCategory[sourceCat] = places.filter((p) => !toRemove.has(p.placeId));
      }
    }
    if (reclassified) console.log(`[reclassify] moved ${reclassified} places based on Google primaryType`);
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

  /** Compute name similarity between a discovered place and its Google match (0–1). */
  function computeNameMatch(
    geoName: string,
    meta: GoogleMeta | null | undefined,
  ): number | undefined {
    if (!meta?.name) return undefined;
    return nameSimilarity(geoName, meta.name);
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
  // Nearby:  scoreNearbyPoi  — quality gate ≥4.0 stars AND ≥200 reviews (Wikidata overrides review min), select top 30
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

  // Google Place ID dedup: two different Geoapify entries can match the same
  // Google Place (e.g. "Uvala Palud" and "Palù" → same Google Place). Seed
  // from existing POIs' enrichment cache and track during selection.
  const seenGooglePlaceIds = new Set<string>();
  const existingPlaceIdsList = existingPois.map((p) => p.placeId).filter((id): id is string => !!id);
  if (existingPlaceIdsList.length > 0) {
    const existingMeta = await prisma.poiEnrichCache.findMany({
      where: { placeId: { in: existingPlaceIdsList }, source: "google-meta" },
      select: { payload: true },
    });
    for (const row of existingMeta) {
      try {
        const data = JSON.parse(row.payload) as { googlePlaceId?: string };
        if (data.googlePlaceId) seenGooglePlaceIds.add(data.googlePlaceId);
      } catch { /* ignore malformed cache entries */ }
    }
  }

  // 100 m threshold: same garden/museum complex can have different OSM nodes
  // tens of metres apart; 100 m catches those while keeping truly different POIs apart.
  const COORD_DEDUP_M = 100;
  const FUZZY_DEDUP_M = 300;
  const FUZZY_NAME_THRESHOLD = 0.5;
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
    // Track selected names + coords for fuzzy name dedup within this selection
    const selectedInfo: Array<{ name: string; lat: number; lon: number }> = [];
    for (const item of scoredItems) {
      if (selected.length >= limit) break;
      if (qualityDroppedSet.has(item.place.placeId)) continue;
      if (item.score < MIN_SCORE) continue;
      const norm = item.place.name.toLowerCase().trim();
      if (existingPlaceIds.has(item.place.placeId) || existingNames.has(norm)) continue;
      if (seenIds.has(item.place.placeId) || seenNames.has(norm)) continue;
      // Google Place ID dedup: two different Geoapify entries can resolve to the
      // same Google Place (e.g. "Uvala Palud" / "Palù" → same beach on Google).
      // Keep the higher-scored one (items are sorted by score, so first wins).
      const gMeta = googleMetaMap.get(item.place.placeId);
      if (gMeta?.googlePlaceId && seenGooglePlaceIds.has(gMeta.googlePlaceId)) {
        console.log(`[google-dedup] "${item.place.name}" shares googlePlaceId ${gMeta.googlePlaceId} — skipping`);
        coordDupSet.add(item.place.placeId);
        continue;
      }
      // Coord dedup: only against same-category POIs (a supermarket next to a
      // campsite are different POIs even at 50m apart)
      const sameCatCoords = forCategory
        ? seenCoords.filter((c) => c.category === forCategory)
        : seenCoords;
      const nearSeen = sameCatCoords.some(
        (c) => haversineKm(c.lat, c.lon, item.place.latitude, item.place.longitude) * 1000 < COORD_DEDUP_M,
      );
      if (nearSeen) { coordDupSet.add(item.place.placeId); continue; }
      // Within-call coord dedup: catch duplicates selected in this same call
      // (seenCoords is only updated AFTER selectTopN returns, so items selected
      // earlier in this loop are invisible to the sameCatCoords check above).
      // E.g. "Dani Noc" and "Dan i Noč" — same place, different Geoapify entries,
      // different names after tokenisation, but only 11m apart.
      const nearSelected = selectedInfo.some(
        (s) => haversineKm(s.lat, s.lon, item.place.latitude, item.place.longitude) * 1000 < COORD_DEDUP_M,
      );
      if (nearSelected) { coordDupSet.add(item.place.placeId); continue; }
      // Fuzzy name dedup: catch semantically identical places with different names
      // (e.g. "Louvre Museum" vs "Musée du Louvre") within 300 m
      const fuzzyDup = selectedInfo.some((s) => {
        const dist = haversineKm(s.lat, s.lon, item.place.latitude, item.place.longitude) * 1000;
        return dist < FUZZY_DEDUP_M && nameSimilarity(s.name, item.place.name) >= FUZZY_NAME_THRESHOLD;
      });
      if (fuzzyDup) { coordDupSet.add(item.place.placeId); continue; }
      selected.push(item);
      selectedInfo.push({ name: item.place.name, lat: item.place.latitude, lon: item.place.longitude });
      // Track Google Place ID within this selection so later items in the same
      // batch that resolve to the same Google Place are caught.
      if (gMeta?.googlePlaceId) seenGooglePlaceIds.add(gMeta.googlePlaceId);
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
        nameMatchScore:   computeNameMatch(place.name, meta),
        tags:             place.categories,
        primaryTags,
        preferences,
        poiCategory:      cat,
        priceLevel:       meta?.priceLevel ?? place.priceLevel,
        hasOpeningHours:  !!(meta?.openingHours ?? place.openingHours),
        hasPhone:         !!(meta?.phoneNumber ?? place.tel),
        hasWebsite:       !!(meta?.website ?? place.website),
        poiName:          place.name,
        poiNameInternational: place.nameInternational,
        mustVisitNames,
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
    const qualifiedRegularPreSubcat = scoredRegular.filter((s) => !regularQualityDropped.has(s.place.placeId));

    // Subcategory filter: if the caller requested specific subcategories for this
    // category, reject POIs whose resolved subcategory isn't in the list.
    // This prevents e.g. a bakery (matched via broad "catering" tag) from appearing
    // under FOOD when only ["restaurant","cafe"] were requested.
    const requestedSubs = subcatsMap[cat];
    const qualifiedRegular = (requestedSubs && requestedSubs.length > 0)
      ? qualifiedRegularPreSubcat.filter((s) => {
          const sub = getPoiSubcat(s.place.categories, cat);
          return sub === null || requestedSubs.includes(sub);
        })
      : qualifiedRegularPreSubcat;

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

    // Over-select by 50% to compensate for cluster suppression (which
    // removes same-category POIs within 200m of each other). The post-
    // cluster trim in step 4c brings each category back to the user's limit.
    const overSelectLimit = Math.ceil(limit * 1.5);
    const { selected: selectedRegular, coordDupSet: regularCoordDupSet } =
      selectTopN(qualifiedRegular, overSelectLimit, new Set(), cat);

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
      if (meta?.googlePlaceId) seenGooglePlaceIds.add(meta.googlePlaceId);
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
          rating:             meta?.rating,
          reviewCount:        meta?.userRatingCount,
          hasWikidataId:      !!place.wikidataId,
          isUnescoSite:       place.isUnescoSite,
          hasPhoto:           !!place.photoUrl || !!meta?.photoName,
          googleCoordScore:   computeCoordScore(place.latitude, place.longitude, meta),
          distanceFromCityKm: distKm,
          nameMatchScore:     computeNameMatch(place.name, meta),
          poiName:            place.name,
          poiNameInternational: place.nameInternational,
          mustVisitNames,
        });
        return { place, score: breakdown.total, breakdown, meta: meta ?? null, distKm };
      });

      // Quality gate: must have a Google match with rating ≥ 4.0 AND ≥ 200 reviews.
      // Wikidata presence overrides the review count minimum — a place with a
      // Wikipedia article is noteworthy regardless of Google review count.
      const nearbyQualityDropped = new Set(
        scoredNearby
          .filter(({ place, meta }) =>
            meta == null ||
            meta.rating == null || meta.rating < 4.0 ||
            (
              (meta.userRatingCount == null || meta.userRatingCount < 200) &&
              !place.wikidataId
            ),
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
        if (meta?.googlePlaceId) seenGooglePlaceIds.add(meta.googlePlaceId);
        topPlaces.push({ place, category: cat, googleMeta: meta ?? null });
      }
    }
  }

  // ── 4. ENRICHMENT — Wikidata + Google photo for top-N only (cached) ────────────
  // Pass pre-scanned GoogleMeta so enrichPlace skips the Text Search API call
  const BATCH_SIZE = 25;
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
  // Regular POIs: over-select (1.5×) before cluster suppression; the post-
  // cluster trim (step 4c) will bring each category back to the user's limit.
  // Nearby POIs: always keep up to 30 — independent of the max filter.
  const NEARBY_RERANK_LIMIT = 30;
  const finalPois: typeof reScored = [];
  for (const cat of categories) {
    const limit = counts[cat] ?? 10;
    const overSelectLimit = Math.ceil(limit * 1.5);
    const catEntries = reScored.filter((e) => e.category === cat);

    const regularEntries = catEntries
      .filter((e) => !nearbyOnlyPlaceIds.has(e.poi.placeId ?? ""))
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, overSelectLimit);

    const nearbyEntries = catEntries
      .filter((e) => nearbyOnlyPlaceIds.has(e.poi.placeId ?? ""))
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, NEARBY_RERANK_LIMIT);

    finalPois.push(...regularEntries, ...nearbyEntries);
  }

  // ── 4c. CLUSTER DETECTION — group 3+ same-category POIs within 200 m ────────
  // When a food court or museum complex produces multiple nearby results,
  // keep only the best-scored one and annotate it with "+N more nearby".
  //
  // Exception: must-visit places (injected from LLM reference list) are never
  // suppressed. These are verified-notable landmarks that may cluster in a
  // historic city centre (e.g. Temple, Forum, Castle all within 200 m in Pula)
  // but are genuinely distinct places the user should see.
  const CLUSTER_RADIUS_M = 200;
  const CLUSTER_MIN_SIZE = 3;
  const clusterInfo = new Map<string, { count: number; names: string[] }>(); // placeId → info
  const suppressedByCluster = new Set<string>();

  // Build a set of must-visit-protected placeIds: injected synthetic places
  // (placeId starts with "must-visit-") and places that matched a must-visit
  // name (got the +12 scoring boost via local or international name).
  const mustVisitProtected = new Set<string>();
  for (const entry of finalPois) {
    const pid = entry.poi.placeId ?? "";
    if (pid.startsWith("must-visit-")) {
      mustVisitProtected.add(pid);
      continue;
    }
    // Check if this place's name matches any must-visit name
    if (mustVisitNames.length && entry.poi.name) {
      for (const mv of mustVisitNames) {
        if (nameSimilarity(entry.poi.name, mv) >= 0.8) { mustVisitProtected.add(pid); break; }
      }
    }
  }
  // Also check discovered places' international names (available before enrichment)
  if (mustVisitNames.length) {
    const allDiscoveredForIntl = categories.flatMap((cat) => discoveryByCategory[cat] ?? []);
    for (const dp of allDiscoveredForIntl) {
      if (!dp.nameInternational || mustVisitProtected.has(dp.placeId)) continue;
      for (const mv of mustVisitNames) {
        let matched = false;
        for (const intlName of Object.values(dp.nameInternational)) {
          if (nameSimilarity(intlName, mv) >= 0.8) { matched = true; break; }
        }
        if (matched) { mustVisitProtected.add(dp.placeId); break; }
      }
    }
  }

  // Group by category first
  const byCat = new Map<string, typeof finalPois>();
  for (const entry of finalPois) {
    const arr = byCat.get(entry.category) ?? [];
    arr.push(entry);
    byCat.set(entry.category, arr);
  }

  // Categories exempt from cluster suppression: food, nightlife, shopping,
  // groceries. Multiple restaurants/bars/shops near each other are distinct
  // options, not duplicates of the same landmark.
  const CLUSTER_EXEMPT_CATS = new Set(["FOOD", "NIGHTLIFE", "SHOPPING", "GROCERIES"]);

  for (const [cat, catEntries] of byCat) {
    if (CLUSTER_EXEMPT_CATS.has(cat)) continue;
    // Build adjacency: which POIs are within CLUSTER_RADIUS_M of each other?
    // Must-visit-protected POIs don't form edges — they can't be clustered.
    const n = catEntries.length;
    const neighbors: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      const pidI = catEntries[i].poi.placeId ?? "";
      if (mustVisitProtected.has(pidI)) continue;
      for (let j = i + 1; j < n; j++) {
        const pidJ = catEntries[j].poi.placeId ?? "";
        if (mustVisitProtected.has(pidJ)) continue;
        const d = haversineKm(
          catEntries[i].poi.latitude, catEntries[i].poi.longitude,
          catEntries[j].poi.latitude, catEntries[j].poi.longitude,
        ) * 1000;
        if (d < CLUSTER_RADIUS_M) {
          neighbors[i].push(j);
          neighbors[j].push(i);
        }
      }
    }

    // Find connected components via BFS
    const visited = new Set<number>();
    for (let i = 0; i < n; i++) {
      if (visited.has(i) || neighbors[i].length === 0) continue;
      const component: number[] = [];
      const queue = [i];
      while (queue.length > 0) {
        const cur = queue.pop()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        component.push(cur);
        for (const nb of neighbors[cur]) {
          if (!visited.has(nb)) queue.push(nb);
        }
      }

      if (component.length >= CLUSTER_MIN_SIZE) {
        // Keep the highest-scored member, suppress the rest
        component.sort((a, b) => catEntries[b].finalScore - catEntries[a].finalScore);
        const bestIdx = component[0];
        const bestPlaceId = catEntries[bestIdx].poi.placeId ?? "";
        const suppressed = component.slice(1);
        const suppressedNames = suppressed.map((idx) => catEntries[idx].poi.name);
        for (const idx of suppressed) {
          suppressedByCluster.add(catEntries[idx].poi.placeId ?? "");
        }
        clusterInfo.set(bestPlaceId, {
          count: suppressed.length,
          names: suppressedNames,
        });
      }
    }
  }

  // Remove suppressed POIs from finalPois, then trim each category back to
  // the user's actual limit (we over-selected by 1.5× to absorb cluster losses).
  const afterCluster = finalPois.filter(
    (e) => !suppressedByCluster.has(e.poi.placeId ?? ""),
  );
  const clusteredFinalPois: typeof finalPois = [];
  for (const cat of categories) {
    const limit = counts[cat] ?? 10;
    const catRegular = afterCluster
      .filter((e) => e.category === cat && !nearbyOnlyPlaceIds.has(e.poi.placeId ?? ""))
      .slice(0, limit);
    const catNearby = afterCluster
      .filter((e) => e.category === cat && nearbyOnlyPlaceIds.has(e.poi.placeId ?? ""));
    clusteredFinalPois.push(...catRegular, ...catNearby);
  }
  console.log(`[clustering] suppressed=${suppressedByCluster.size} clusters=${clusterInfo.size} mustVisitProtected=${mustVisitProtected.size}`);

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
  // Build lookup from placeId → discovery metadata (cuisine, placeCategory)
  // so the LLM description generator has richer context via extraFields.
  const discoveryMeta = new Map<string, { cuisine?: string; placeCategory?: string }>();
  for (const { place } of topPlaces) {
    discoveryMeta.set(place.placeId, {
      cuisine: place.cuisine,
      placeCategory: place.placeCategory,
    });
  }

  const created = await prisma.$transaction(
    clusteredFinalPois.map(({ poi: p, finalScore, breakdown }) => {
      // Merge cluster info + discovery metadata into extraFields
      const cluster = clusterInfo.get(p.placeId ?? "");
      const discovery = discoveryMeta.get(p.placeId ?? "");
      const extraFields: Record<string, unknown> = {
        ...(cluster ? { nearbyClusterCount: cluster.count, nearbyClusterNames: cluster.names } : {}),
        ...(discovery?.cuisine ? { cuisine: discovery.cuisine } : {}),
        ...(discovery?.placeCategory ? { placeCategory: discovery.placeCategory } : {}),
      };

      return prisma.poi.create({
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
          extraFields: Object.keys(extraFields).length > 0 ? extraFields as import("@prisma/client").Prisma.InputJsonValue : undefined,
          cityId:                   cityIdNum,
        },
      });
    }),
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