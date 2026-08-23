import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { isCategory, CATEGORIES, type Category } from "@/lib/categories";
import { isTimeSlot, type TimeSlot } from "@/lib/slots";
import { ensureDayPlans } from "@/lib/day-plans";
import type { PoiDTO } from "./pois-section";
import type { DayPlanDTO } from "./daily-plan";
import { CityPlanningSection } from "./city-planning-section";
import { EditCityButton } from "./edit-city-button";
import { CityHeader } from "./city-header";
import { CityInfoSection, type CityWikiInfo } from "./city-info";
import type { GeneratedCityInfo } from "@/lib/city-info";
import type { ActivityRecommendationsResult } from "@/lib/activity-recommendations";
import type { FavouriteItemDTO } from "@/components/favourites/favourites-provider";
import { TripNoteEditor } from "@/components/ui/trip-note-editor";
import { ActivityRecommendations } from "./activity-recommendations";

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
  if (!Number.isInteger(cityIdNum)) return { title: "City" };
  const city = await prisma.city.findUnique({ where: { id: cityIdNum } });
  return { title: city?.name ?? "City" };
}

export default async function CityDetailPage({
  params,
}: {
  params: Promise<{ id: string; cityId: string }>;
}) {
  const { id, cityId } = await params;
  const tripId = Number(id);
  const cityIdNum = Number(cityId);
  if (!Number.isInteger(tripId) || !Number.isInteger(cityIdNum)) notFound();

  const city = await prisma.city.findUnique({
    where: { id: cityIdNum },
    include: { trip: true, pois: { orderBy: { createdAt: "asc" } } },
  });
  if (!city || city.tripId !== tripId) notFound();

  // Sibling cities for stepper and prev/next navigation
  const siblingCities = await prisma.city.findMany({
    where: { tripId },
    orderBy: { order: "asc" },
    select: { id: true, order: true, name: true },
  });
  const totalCities = siblingCities.length;
  const currentIdx = siblingCities.findIndex((c) => c.id === cityIdNum);
  const prevCityId = currentIdx > 0 ? siblingCities[currentIdx - 1].id : null;
  const nextCityId = currentIdx < siblingCities.length - 1 ? siblingCities[currentIdx + 1].id : null;

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

  await ensureDayPlans(city.id, city.startDate, city.endDate);

  const dayPlansRaw = await prisma.dayPlan.findMany({
    where: { cityId: city.id },
    orderBy: { date: "asc" },
    include: {
      activities: {
        orderBy: { order: "asc" },
        include: { poi: true },
      },
    },
  });

  // Fetch favourite items matching this city (case-insensitive)
  const favouriteItemsRaw = await prisma.favouriteItem.findMany({
    where: {
      city: { equals: city.name, mode: "insensitive" },
      ...(city.country ? { country: { equals: city.country, mode: "insensitive" } } : {}),
    },
    include: { list: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

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
    where: { poi: { cityId: city.id } },
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
          { label: city.name },
        ]}
      />

      <CityHeader
        cityId={city.id}
        tripId={tripId}
        name={city.name}
        country={city.country}
        countryCode={city.countryCode}
        timezone={city.timezone}
        startDate={city.startDate.toISOString()}
        endDate={city.endDate.toISOString()}
        cityOrder={city.order}
        totalCities={totalCities}
        prevCityId={prevCityId}
        nextCityId={nextCityId}
        cities={siblingCities.map((c) => ({ id: c.id, name: c.name }))}
        poiCounts={poiCounts}
        plannedCount={plannedCount}
        totalPois={pois.length}
      />

      <CityInfoSection
        cityId={city.id}
        cityName={city.name}
        info={wikiInfo}
        initialGenerated={cachedCityInfo}
      />

      <TripNoteEditor
        initialNote={cityNote ?? null}
        scope={{ cityId: city.id }}
      />

      <div id="edit-section">
        <EditCityButton
          tripId={tripId}
          city={{
            id: city.id,
            name: city.name,
            startDate: city.startDate.toISOString(),
            endDate: city.endDate.toISOString(),
          }}
          tripStartDate={city.trip.startDate.toISOString()}
          tripEndDate={city.trip.endDate.toISOString()}
        />
      </div>

      <ActivityRecommendations
        cityId={city.id}
        cityName={city.name}
        country={city.country ?? undefined}
        tripId={tripId}
        tripStartDate={city.endDate.toISOString()}
        tripEndDate={city.trip.endDate.toISOString()}
        initialData={cachedActivities}
        pois={pois.map((p) => ({ id: p.id, name: p.name }))}
      />

      <CityPlanningSection
        cityId={city.id}
        pois={pois}
        dayPlans={dayPlans}
        cityLat={city.latitude ?? undefined}
        cityLon={city.longitude ?? undefined}
        cityName={city.name}
        country={city.country ?? undefined}
        favouriteItems={favouriteItems}
        initialUserRatings={initialUserRatings}
        initialNotInterested={initialNotInterested}
        initialVisitedPoiIds={initialVisitedPoiIds}
        dayNotes={dayNotes}
      />
    </div>
  );
}
