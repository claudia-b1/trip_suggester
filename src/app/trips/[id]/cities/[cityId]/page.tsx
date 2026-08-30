import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { isCategory, CATEGORIES, type Category } from "@/lib/categories";
import { isTimeSlot, type TimeSlot } from "@/lib/slots";
import { ensureDayPlans } from "@/lib/day-plans";
import type { PoiDTO } from "./pois-section";
import type { DayPlanDTO } from "./daily-plan";
import { CityPlanningSection } from "./city-planning-section";
import { CityHeader } from "./city-header";
import { CityInfoSection, type CityWikiInfo } from "./city-info";
import type { GeneratedCityInfo } from "@/lib/city-info";
import type { ActivityRecommendationsResult } from "@/lib/activity-recommendations";
import type { FavouriteItemDTO } from "@/components/favourites/favourites-provider";
import { TripNoteEditor } from "@/components/ui/trip-note-editor";
import { ActivityRecommendations } from "./activity-recommendations";
import { SubcityTabs } from "./subcity-tabs";
import { syncFavouritesToCity } from "@/lib/favourite-poi-sync";
import { StopPlanningSection } from "./stop-planning-section";
import type { StopPoiDTO } from "./stop-planning-section";

async function fetchCityWikiInfo(cityName: string, countryName?: string | null): Promise<CityWikiInfo | null> {
  const query = countryName ? `${cityName}, ${countryName}` : cityName;
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) {
      // Retry with just the city name if the combined query fails
      if (countryName) {
        const res2 = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cityName)}`,
          { next: { revalidate: 86400 } },
        );
        if (!res2.ok) return null;
        return parseWikiResponse(await res2.json());
      }
      return null;
    }
    return parseWikiResponse(await res.json());
  } catch {
    return null;
  }
}

function parseWikiResponse(data: Record<string, unknown>): CityWikiInfo | null {
  const extract = typeof data.extract === "string" ? data.extract.trim() : null;
  if (!extract) return null;
  const thumbnail = data.thumbnail as { source?: string } | undefined;
  const urls = data.content_urls as { desktop?: { page?: string } } | undefined;
  return {
    extract: extract.length > 600 ? extract.slice(0, 600).replace(/\s\S+$/, "") + "…" : extract,
    description: typeof data.description === "string" ? data.description : undefined,
    thumbnailUrl: thumbnail?.source,
    wikiUrl: urls?.desktop?.page,
  };
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; cityId: string }>;
}): Promise<Metadata> {
  const { cityId } = await params;
  const cityIdNum = Number(cityId);
  if (!Number.isInteger(cityIdNum)) return { title: "Destination" };
  const city = await prisma.city.findUnique({ where: { id: cityIdNum } });
  return { title: city?.nickname ?? city?.name ?? "Destination" };
}

export default async function CityDetailPage({
  params,
}: {
  params: Promise<{ id: string; cityId: string }>;
}) {
  const userId = await getActiveUserId();
  if (!userId) notFound();

  const { id, cityId } = await params;
  const tripId = Number(id);
  const cityIdNum = Number(cityId);
  if (!Number.isInteger(tripId) || !Number.isInteger(cityIdNum)) notFound();

  const city = await prisma.city.findUnique({
    where: { id: cityIdNum },
    include: {
      trip: true,
      pois: { orderBy: { createdAt: "asc" } },
      parentCity: { select: { id: true, name: true, nickname: true } },
      subcities: {
        orderBy: { order: "asc" },
        select: { id: true, name: true, nickname: true, startDate: true, endDate: true },
      },
    },
  });
  if (!city || city.tripId !== tripId || city.trip.userId !== userId) notFound();

  // Sibling cities for stepper — always top-level destinations only, sorted by arrival date
  const siblingCities = await prisma.city.findMany({
    where: { tripId, parentCityId: null },
    orderBy: { startDate: "asc" },
    select: { id: true, order: true, name: true, nickname: true },
  });
  const totalCities = siblingCities.length;
  // For subcities, highlight the parent in the stepper
  const stepperActiveId = city.parentCityId ?? cityIdNum;
  const currentIdx = siblingCities.findIndex((c) => c.id === stepperActiveId);
  const prevCityId = currentIdx > 0 ? siblingCities[currentIdx - 1].id : null;
  const nextCityId = currentIdx < siblingCities.length - 1 ? siblingCities[currentIdx + 1].id : null;

  // Build subcity tabs data: show if this city has subcities, or if it IS a subcity
  let subcityTabData: { parentCity: { id: number; name: string }; subcities: { id: number; name: string }[] } | null = null;
  if (city.parentCity) {
    // This is a subcity — load parent's other subcities
    const parentSubcities = await prisma.city.findMany({
      where: { parentCityId: city.parentCity.id },
      orderBy: { order: "asc" },
      select: { id: true, name: true, nickname: true },
    });
    subcityTabData = {
      parentCity: { id: city.parentCity.id, name: city.parentCity.nickname ?? city.parentCity.name },
      subcities: parentSubcities.map((s) => ({ id: s.id, name: s.nickname ?? s.name })),
    };
  } else if (city.subcities.length > 0) {
    // This is a parent with subcities
    subcityTabData = {
      parentCity: { id: city.id, name: city.nickname ?? city.name },
      subcities: city.subcities.map((s) => ({ id: s.id, name: s.nickname ?? s.name })),
    };
  }

  const wikiInfo = await fetchCityWikiInfo(city.name, city.country);

  // Load AI-generated city info from DB cache (if available)
  const cityInfoCacheRow = await prisma.cityInfoCache.findUnique({
    where: { cityId_type: { cityId: city.id, type: "city-info" } },
  });
  const cachedCityInfo: GeneratedCityInfo | null = cityInfoCacheRow
    ? (JSON.parse(cityInfoCacheRow.data) as GeneratedCityInfo)
    : null;

  // Load cached activity recommendations
  const activityCacheRow = await prisma.cityInfoCache.findUnique({
    where: { cityId_type: { cityId: city.id, type: "activities" } },
  });
  const cachedActivities: ActivityRecommendationsResult | null = activityCacheRow
    ? (JSON.parse(activityCacheRow.data) as ActivityRecommendationsResult)
    : null;

  const isStop = city.type === "stop";

  if (!isStop) {
    await ensureDayPlans(city.id, city.startDate, city.endDate);
  }

  // Auto-sync: ensure all matching favourites are added as POIs
  if (city.latitude != null && city.longitude != null && !isStop) {
    try {
      await syncFavouritesToCity(
        city.id,
        city.latitude,
        city.longitude,
        city.country ?? null,
        city.discoverRadiusKm ?? null,
        userId,
      );
    } catch {
      // Best-effort — don't block page load
    }
  }

  const dayPlansRaw = await prisma.dayPlan.findMany({
    where: {
      cityId: city.id,
      date: { gte: city.startDate, lte: city.endDate },
    },
    orderBy: { date: "asc" },
    include: {
      activities: {
        orderBy: { order: "asc" },
        include: { poi: true },
      },
    },
  });

  // Fetch favourite items nearby, filter by country when available then by distance
  const DEFAULT_FAV_RADIUS_KM = 10;
  const favRadiusKm = city.discoverRadiusKm ?? DEFAULT_FAV_RADIUS_KM;
  const allCountryFavs = await prisma.favouriteItem.findMany({
    where: {
      ...(city.country ? { country: { equals: city.country, mode: "insensitive" } } : {}),
      list: { userId },
    },
    include: { list: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  // Haversine distance filter
  const favouriteItemsRaw = (city.latitude != null && city.longitude != null)
    ? allCountryFavs.filter((f) => {
        const R = 6371;
        const dLat = ((f.latitude - city.latitude!) * Math.PI) / 180;
        const dLon = ((f.longitude - city.longitude!) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((city.latitude! * Math.PI) / 180) *
            Math.cos((f.latitude * Math.PI) / 180) *
            Math.sin(dLon / 2) ** 2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return dist <= favRadiusKm;
      })
    : allCountryFavs;

  const favouriteItems: FavouriteItemDTO[] = favouriteItemsRaw.map((f) => ({
    id: f.id,
    name: f.name,
    category: f.category,
    subcategory: f.subcategory,
    country: f.country,
    city: f.city,
    address: f.address,
    latitude: f.latitude,
    longitude: f.longitude,
    description: f.description,
    notes: f.notes,
    photoUrl: f.photoUrl,
    website: f.website,
    sourcePlaceId: f.sourcePlaceId,
    visited: f.visited,
    personalRating: f.personalRating,
    extraFields: f.extraFields as Record<string, unknown> | null,
    order: f.order,
    listId: f.listId,
    list: f.list,
    createdAt: f.createdAt.toISOString(),
  }));

  // Load persisted user ratings + visited from database
  const ratingsRaw = await prisma.poiRating.findMany({
    where: { poi: { cityId: city.id }, userId },
    select: { poiId: true, rating: true, notInterested: true, visited: true },
  });
  const initialUserRatings: Record<number, number> = {};
  const initialNotInterested: number[] = [];
  const initialVisitedPoiIds: number[] = [];
  for (const r of ratingsRaw) {
    if (r.rating) initialUserRatings[r.poiId] = r.rating;
    if (r.notInterested) initialNotInterested.push(r.poiId);
    if (r.visited) initialVisitedPoiIds.push(r.poiId);
  }

  // Load city-level note
  const cityNote = await prisma.tripNote.findFirst({
    where: { cityId: cityIdNum, tripId: null, dayPlanId: null },
    select: { id: true, content: true },
  });

  // Load day-level notes for all day plans in this city
  const dayPlanIds = dayPlansRaw.map((dp) => dp.id);
  const dayNotesRaw = await prisma.tripNote.findMany({
    where: { dayPlanId: { in: dayPlanIds }, tripId: null, cityId: null },
    select: { id: true, content: true, dayPlanId: true },
  });
  const dayNotes: Record<number, { id: number; content: string }> = {};
  for (const n of dayNotesRaw) {
    if (n.dayPlanId) dayNotes[n.dayPlanId] = { id: n.id, content: n.content };
  }

  const pois: PoiDTO[] = city.pois.map((p) => ({
    id: p.id,
    name: p.name,
    category: isCategory(p.category) ? p.category : "CULTURE",
    description: p.description,
    latitude: p.latitude,
    longitude: p.longitude,
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
    isUnescoSite: p.isUnescoSite,
    inceptionYear: p.inceptionYear,
    wikidataId: p.wikidataId,
    userRatingCount: p.userRatingCount ?? null,
    subcategory: p.subcategory ?? null,
    favouriteItemId: p.favouriteItemId ?? null,
    hasOriginalData: !!p.originalData,
  }));

  const dayPlans: DayPlanDTO[] = dayPlansRaw.map((dp) => ({
    id: dp.id,
    date: dp.date.toISOString(),
    activities: dp.activities.map((a) => ({
      id: a.id,
      poiId: a.poiId,
      poiName: a.poi.name,
      poiCategory: isCategory(a.poi.category) ? a.poi.category : "CULTURE",
      timeSlot: (isTimeSlot(a.timeSlot) ? a.timeSlot : "MORNING") as TimeSlot,
    })),
  }));

  // Load related city day plans for cross-view (parent sees subcity plans, subcity sees parent plans)
  let subcityDayPlans: { cityId: number; cityName: string; tripId: number; date: string; activities: { poiName: string; poiCategory: string; timeSlot: string }[] }[] = [];
  if (!city.parentCityId && city.subcities.length > 0) {
    // Parent view: load all subcity day plans
    const rawSubDayPlans = await prisma.dayPlan.findMany({
      where: { city: { parentCityId: cityIdNum } },
      include: {
        activities: { orderBy: { order: "asc" }, include: { poi: { select: { name: true, category: true } } } },
        city: { select: { id: true, name: true, nickname: true } },
      },
    });
    subcityDayPlans = rawSubDayPlans.map((dp) => ({
      cityId: dp.city.id,
      cityName: dp.city.nickname ?? dp.city.name,
      tripId,
      date: dp.date.toISOString(),
      activities: dp.activities.map((a) => ({
        poiName: a.poi.name,
        poiCategory: a.poi.category,
        timeSlot: a.timeSlot,
      })),
    }));
  } else if (city.parentCityId) {
    // Subcity view: load parent's day plans + sibling subcity day plans
    const rawRelatedPlans = await prisma.dayPlan.findMany({
      where: {
        OR: [
          { cityId: city.parentCityId },
          { city: { parentCityId: city.parentCityId, id: { not: cityIdNum } } },
        ],
      },
      include: {
        activities: { orderBy: { order: "asc" }, include: { poi: { select: { name: true, category: true } } } },
        city: { select: { id: true, name: true, nickname: true } },
      },
    });
    subcityDayPlans = rawRelatedPlans.map((dp) => ({
      cityId: dp.city.id,
      cityName: dp.city.nickname ?? dp.city.name,
      tripId,
      date: dp.date.toISOString(),
      activities: dp.activities.map((a) => ({
        poiName: a.poi.name,
        poiCategory: a.poi.category,
        timeSlot: a.timeSlot,
      })),
    }));
  }

  // POI counts by category
  const poiCounts = Object.fromEntries(
    CATEGORIES.map((c) => [c, 0]),
  ) as Record<Category, number>;
  for (const p of pois) {
    poiCounts[p.category]++;
  }

  // Planned POI count
  const plannedCount = dayPlans.reduce(
    (sum, dp) => sum + dp.activities.length,
    0,
  );

  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { label: "Trips", href: "/" },
          { label: city.trip.name, href: `/trips/${tripId}` },
          ...(city.parentCity
            ? [
                { label: city.parentCity.nickname ?? city.parentCity.name, href: `/trips/${tripId}/cities/${city.parentCity.id}` },
                { label: city.nickname ?? city.name },
              ]
            : [{ label: city.nickname ?? city.name }]),
        ]}
      />

      <CityHeader
        cityId={city.id}
        tripId={tripId}
        name={city.name}
        nickname={city.nickname}
        country={city.country}
        countryCode={city.countryCode}
        timezone={city.timezone}
        startDate={city.startDate.toISOString()}
        endDate={city.endDate.toISOString()}
        cityOrder={city.order}
        totalCities={totalCities}
        prevCityId={prevCityId}
        nextCityId={nextCityId}
        cities={siblingCities.map((c) => ({ id: c.id, name: c.nickname ?? c.name }))}
        activeCityId={stepperActiveId}
        parentCity={city.parentCity ? { id: city.parentCity.id, name: city.parentCity.nickname ?? city.parentCity.name } : null}
        poiCounts={poiCounts}
        plannedCount={plannedCount}
        totalPois={pois.length}
        editProps={{
          tripId,
          city: {
            id: city.id,
            name: city.name,
            nickname: city.nickname,
            startDate: city.startDate.toISOString(),
            endDate: city.endDate.toISOString(),
          },
          tripStartDate: city.trip.startDate.toISOString(),
          tripEndDate: city.trip.endDate.toISOString(),
        }}
        isStop={isStop}
      />

      {subcityTabData && (
        <SubcityTabs
          tripId={tripId}
          parentCity={subcityTabData.parentCity}
          subcities={subcityTabData.subcities}
          activeCityId={city.id}
        />
      )}

      {isStop ? (
        <>
          {/* Simplified view for travel stops */}
          <TripNoteEditor
            initialNote={cityNote ?? null}
            scope={{ cityId: city.id }}
          />
          {wikiInfo && (
            <CityInfoSection
              cityId={city.id}
              cityName={city.nickname ?? city.name}
              info={wikiInfo}
              initialGenerated={cachedCityInfo}
            />
          )}
          <StopPlanningSection
            cityId={city.id}
            pois={pois as StopPoiDTO[]}
            cityLat={city.latitude ?? undefined}
            cityLon={city.longitude ?? undefined}
            cityName={city.nickname ?? city.name}
            country={city.country ?? undefined}
            favouriteItems={favouriteItems}
            initialAccommodation={
              (() => {
                const accom = city.pois.find((p) => p.category === "ACCOMMODATION");
                if (accom && accom.latitude != null && accom.longitude != null) {
                  return { id: accom.id, name: accom.name, latitude: accom.latitude, longitude: accom.longitude };
                }
                return null;
              })()
            }
          />
        </>
      ) : (
        <>
          <CityInfoSection
            cityId={city.id}
            cityName={city.nickname ?? city.name}
            info={wikiInfo}
            initialGenerated={cachedCityInfo}
          />

          <TripNoteEditor
            initialNote={cityNote ?? null}
            scope={{ cityId: city.id }}
          />

          <ActivityRecommendations
            cityId={city.id}
            cityName={city.nickname ?? city.name}
            country={city.country ?? undefined}
            tripId={tripId}
            tripStartDate={city.endDate.toISOString()}
            tripEndDate={city.trip.endDate.toISOString()}
            cityStartDate={city.startDate.toISOString()}
            cityEndDate={city.endDate.toISOString()}
            initialData={cachedActivities}
            pois={pois.map((p) => ({ id: p.id, name: p.name, photoUrl: p.photoUrl }))}
            parentCityId={city.parentCityId}
          />

          <CityPlanningSection
            cityId={city.id}
            pois={pois}
            dayPlans={dayPlans}
            cityLat={city.latitude ?? undefined}
            cityLon={city.longitude ?? undefined}
            cityName={city.nickname ?? city.name}
            country={city.country ?? undefined}
            favouriteItems={favouriteItems}
            initialUserRatings={initialUserRatings}
            initialNotInterested={initialNotInterested}
            initialVisitedPoiIds={initialVisitedPoiIds}
            dayNotes={dayNotes}
            subcityDayPlans={subcityDayPlans}
            initialRadiusKm={city.discoverRadiusKm ?? undefined}
          />
        </>
      )}
    </div>
  );
}
