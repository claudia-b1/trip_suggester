/**
 * One-time data migration: SQLite (dev.db) → PostgreSQL (Neon).
 * Run with: npx tsx prisma/migrate-data.ts
 *
 * Reads from the local SQLite file using the sqlite3 CLI,
 * writes to PostgreSQL using Prisma Client (reads DATABASE_URL from .env).
 */

import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

const SQLITE_PATH = "prisma/dev.db";
const prisma = new PrismaClient();

/** Run a sqlite3 query and return parsed JSON rows */
function sqliteQuery<T = Record<string, unknown>>(sql: string): T[] {
  const raw = execSync(`sqlite3 -json "${SQLITE_PATH}" "${sql}"`, {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (!raw.trim()) return [];
  return JSON.parse(raw) as T[];
}

/** Convert SQLite epoch millis → Date */
function toDate(ms: number | string): Date {
  return new Date(Number(ms));
}

async function main() {
  console.log("🔄 Starting SQLite → PostgreSQL migration...\n");

  // ── 1. Trips ──────────────────────────────────────────────────────────────
  const trips = sqliteQuery<{
    id: number; name: string; startDate: number; endDate: number;
    createdAt: number; updatedAt: number;
  }>("SELECT * FROM Trip ORDER BY id");

  // Ensure at least one user exists for migration
  let defaultUser = await prisma.user.findFirst({ orderBy: { id: "asc" } });
  if (!defaultUser) {
    defaultUser = await prisma.user.create({
      data: { name: "Me", color: "#3B82F6" },
    });
  }

  for (const t of trips) {
    await prisma.trip.create({
      data: {
        id: t.id,
        name: t.name,
        startDate: toDate(t.startDate),
        endDate: toDate(t.endDate),
        createdAt: toDate(t.createdAt),
        updatedAt: toDate(t.updatedAt),
        userId: defaultUser.id,
      },
    });
  }
  console.log(`✅ Trips: ${trips.length}`);

  // ── 2. Cities ─────────────────────────────────────────────────────────────
  const cities = sqliteQuery<{
    id: number; name: string; startDate: number; endDate: number;
    order: number; country: string | null; countryCode: string | null;
    latitude: number | null; longitude: number | null; timezone: string | null;
    tripId: number; createdAt: number;
  }>("SELECT * FROM City ORDER BY id");

  for (const c of cities) {
    await prisma.city.create({
      data: {
        id: c.id,
        name: c.name,
        startDate: toDate(c.startDate),
        endDate: toDate(c.endDate),
        order: c.order,
        country: c.country,
        countryCode: c.countryCode,
        latitude: c.latitude,
        longitude: c.longitude,
        timezone: c.timezone,
        tripId: c.tripId,
        createdAt: toDate(c.createdAt),
      },
    });
  }
  console.log(`✅ Cities: ${cities.length}`);

  // ── 3. POIs ───────────────────────────────────────────────────────────────
  const pois = sqliteQuery<{
    id: number; name: string; category: string; description: string | null;
    latitude: number | null; longitude: number | null; imageUrl: string | null;
    rating: number | null; bestTimeToVisit: string | null;
    estimatedDurationMinutes: number | null; tips: string | null;
    placeId: string | null; priceLevel: number | null; website: string | null;
    phoneNumber: string | null; openingHours: string | null;
    photoUrl: string | null; fee: string | null; isUnescoSite: number | null;
    inceptionYear: number | null; wikidataId: string | null;
    score: number | null; scoreBreakdown: string | null;
    userRatingCount: number | null; subcategory: string | null;
    cityId: number; createdAt: number;
  }>("SELECT * FROM Poi ORDER BY id");

  for (const p of pois) {
    await prisma.poi.create({
      data: {
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        latitude: p.latitude,
        longitude: p.longitude,
        imageUrl: p.imageUrl,
        rating: p.rating,
        bestTimeToVisit: p.bestTimeToVisit,
        estimatedDurationMinutes: p.estimatedDurationMinutes,
        tips: p.tips,
        placeId: p.placeId,
        priceLevel: p.priceLevel,
        website: p.website,
        phoneNumber: p.phoneNumber,
        openingHours: p.openingHours,
        photoUrl: p.photoUrl,
        fee: p.fee,
        isUnescoSite: p.isUnescoSite === 1,
        inceptionYear: p.inceptionYear,
        wikidataId: p.wikidataId,
        score: p.score,
        scoreBreakdown: p.scoreBreakdown,
        userRatingCount: p.userRatingCount,
        subcategory: p.subcategory,
        cityId: p.cityId,
        createdAt: toDate(p.createdAt),
      },
    });
  }
  console.log(`✅ POIs: ${pois.length}`);

  // ── 4. DayPlans ───────────────────────────────────────────────────────────
  const dayPlans = sqliteQuery<{
    id: number; date: number; cityId: number; createdAt: number;
  }>("SELECT * FROM DayPlan ORDER BY id");

  for (const d of dayPlans) {
    await prisma.dayPlan.create({
      data: {
        id: d.id,
        date: toDate(d.date),
        cityId: d.cityId,
        createdAt: toDate(d.createdAt),
      },
    });
  }
  console.log(`✅ DayPlans: ${dayPlans.length}`);

  // ── 5. DayActivities ─────────────────────────────────────────────────────
  const dayActivities = sqliteQuery<{
    id: number; dayPlanId: number; poiId: number;
    timeSlot: string; order: number; createdAt: number;
  }>("SELECT * FROM DayActivity ORDER BY id");

  for (const a of dayActivities) {
    await prisma.dayActivity.create({
      data: {
        id: a.id,
        dayPlanId: a.dayPlanId,
        poiId: a.poiId,
        timeSlot: a.timeSlot,
        order: a.order,
        createdAt: toDate(a.createdAt),
      },
    });
  }
  console.log(`✅ DayActivities: ${dayActivities.length}`);

  // ── 6. PoiCandidates ─────────────────────────────────────────────────────
  const candidates = sqliteQuery<{
    id: number; cityId: number; name: string; category: string;
    placeId: string | null; latitude: number | null; longitude: number | null;
    distanceKm: number | null; googleRating: number | null;
    reviewCount: number | null; score: number | null;
    scoreBreakdown: string | null; subcategory: string | null;
    selected: number; rejectedReason: string | null; createdAt: number;
  }>("SELECT * FROM PoiCandidate ORDER BY id");

  // Batch in chunks of 100 for speed
  for (let i = 0; i < candidates.length; i += 100) {
    const chunk = candidates.slice(i, i + 100);
    await prisma.poiCandidate.createMany({
      data: chunk.map((c) => ({
        id: c.id,
        cityId: c.cityId,
        name: c.name,
        category: c.category,
        placeId: c.placeId,
        latitude: c.latitude,
        longitude: c.longitude,
        distanceKm: c.distanceKm,
        googleRating: c.googleRating,
        reviewCount: c.reviewCount,
        score: c.score,
        scoreBreakdown: c.scoreBreakdown,
        subcategory: c.subcategory,
        selected: c.selected === 1,
        rejectedReason: c.rejectedReason,
        createdAt: toDate(c.createdAt),
      })),
    });
  }
  console.log(`✅ PoiCandidates: ${candidates.length}`);

  // ── 7. PoiEnrichCache ────────────────────────────────────────────────────
  const enrichCache = sqliteQuery<{
    id: number; placeId: string; source: string;
    payload: string; cachedAt: number;
  }>("SELECT * FROM PoiEnrichCache ORDER BY id");

  for (let i = 0; i < enrichCache.length; i += 100) {
    const chunk = enrichCache.slice(i, i + 100);
    await prisma.poiEnrichCache.createMany({
      data: chunk.map((e) => ({
        id: e.id,
        placeId: e.placeId,
        source: e.source,
        payload: e.payload,
        cachedAt: toDate(e.cachedAt),
      })),
    });
  }
  console.log(`✅ PoiEnrichCache: ${enrichCache.length}`);

  // ── 8. CityInfoCache ─────────────────────────────────────────────────────
  const cityInfoCache = sqliteQuery<{
    id: number; cityId: number; data: string; generatedAt: number;
  }>("SELECT * FROM CityInfoCache ORDER BY id");

  for (const c of cityInfoCache) {
    await prisma.cityInfoCache.create({
      data: {
        id: c.id,
        cityId: c.cityId,
        data: c.data,
        generatedAt: toDate(c.generatedAt),
      },
    });
  }
  console.log(`✅ CityInfoCache: ${cityInfoCache.length}`);

  // ── 9. PoiCache ──────────────────────────────────────────────────────────
  const poiCache = sqliteQuery<{
    id: number; cityName: string; category: string;
    source: string; payload: string; cachedAt: number;
  }>("SELECT * FROM PoiCache ORDER BY id");

  for (const p of poiCache) {
    await prisma.poiCache.create({
      data: {
        id: p.id,
        cityName: p.cityName,
        category: p.category,
        source: p.source,
        payload: p.payload,
        cachedAt: toDate(p.cachedAt),
      },
    });
  }
  console.log(`✅ PoiCache: ${poiCache.length}`);

  // ── Reset sequences to max(id) + 1 ───────────────────────────────────────
  const tables = [
    "Trip", "City", "Poi", "DayPlan", "DayActivity",
    "PoiCandidate", "PoiEnrichCache", "CityInfoCache", "PoiCache",
  ];
  for (const table of tables) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`
    );
  }
  console.log(`\n✅ Sequences reset to max(id)+1`);

  console.log("\n🎉 Migration complete!");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
