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

  await ensureDayPlans(city.id, city.startDate, city.endDate);

  // Auto-sync: ensure all matching favourites are added as POIs
  let syncedCount = 0;
  if (city.latitude != null && city.longitude != null) {
    try {
      syncedCount = await syncFavouritesToCity(
        city.id,
        city.latitude,
        city.longitude,
        city.country?.trim() || null,
        city.discoverRadiusKm ?? null,
        userId,
        city.type ?? "destination",
      );
    } catch {
      // Best-effort — don't block page load
    }
  }

  // If new POIs were created by the sync, re-query to include them
  if (syncedCount > 0) {
    const freshPois = await prisma.poi.findMany({
      where: { cityId: city.id },
      orderBy: { createdAt: "asc" },
    });
    city.pois = freshPois;
  }

  let dayPlansRaw = await prisma.dayPlan.findMany({
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

  // Auto-assign accommodation to EVENING slot of day plans (all nights except last).
  // Only when an accommodation is explicitly selected (accommodationPoiId is set).
  const accomPoiForAssign = city.accommodationPoiId
    ? city.pois.find((p) => p.id === city.accommodationPoiId)
    : null;
  if (accomPoiForAssign && dayPlansRaw.length > 0) {
    const daysNeedingAccom = (dayPlansRaw.length > 1 ? dayPlansRaw.slice(0, -1) : dayPlansRaw)
      .filter((dp) => !dp.activities.some((a) => a.poi.category === "ACCOMMODATION"));
    if (daysNeedingAccom.length > 0) {
      await Promise.allSettled(
        daysNeedingAccom.map((dp) =>
          prisma.dayActivity.create({
            data: {
              dayPlanId: dp.id,
              poiId: accomPoiForAssign.id,
              timeSlot: "EVENING",
              order: dp.activities.length,
            },
          }),
        ),
      );
      // Re-query to include the new activities
      dayPlansRaw = await prisma.dayPlan.findMany({
        where: { cityId: city.id, date: { gte: city.startDate, lte: city.endDate } },
        orderBy: { date: "asc" },
        include: { activities: { orderBy: { order: "asc" }, include: { poi: true } } },
      });
    }
  }

  // Fetch favourite items nearby, filter by country then by distance.
  // Travel stops use a wide 80 km radius so nearby favourites always appear.
  // Destinations only show favourites after a discover has been run (discoverRadiusKm is set),
  // using that radius as the cutoff.
  const DEFAULT_FAV_RADIUS_KM = 80;
  const hasDiscoverRadius = city.discoverRadiusKm != null;
  const showFavourites = isStop || hasDiscoverRadius;
  const favRadiusKm = isStop
    ? DEFAULT_FAV_RADIUS_KM
    : (city.discoverRadiusKm ?? 0);

  const allCountryFavs = await prisma.favouriteItem.findMany({
    where: {
      ...(city.country ? { country: { equals: city.country, mode: "insensitive" } } : {}),
      list: { userId },
    },
    include: { list: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  // Haversine distance filter — returns empty for destinations without a discover radius
  const favouriteItemsRaw = showFavourites
    ? (city.latitude != null && city.longitude != null)
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
      : allCountryFavs
    : [];

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
    phoneNumber: f.phoneNumber ?? null,
    openingHours: f.openingHours ?? null,
    priceLevel: f.priceLevel ?? null,
    fee: f.fee ?? null,
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
    address: p.address ?? null,
    notes: p.notes ?? null,
    hasOriginalData: !!p.originalData,
    extraFields: p.extraFields as Record<string, unknown> | null,
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

  // Auto-set accommodationPoiId if it's null but ACCOMMODATION POIs exist.
  // Only for destinations — travel stops require explicit selection by the user.
  const accomPois = city.pois.filter((p) => p.category === "ACCOMMODATION");
  if (!isStop && !city.accommodationPoiId && accomPois.length > 0) {
    const firstAccom = accomPois.find((p) => p.latitude != null && p.longitude != null);
    if (firstAccom) {
      await prisma.city.update({
        where: { id: city.id },
        data: { accommodationPoiId: firstAccom.id },
      });
      city.accommodationPoiId = firstAccom.id;
    }
  }

  // Backfill accommodation addresses via Mapbox reverse geocode
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (mapboxToken) {
    const needsAddress = accomPois.filter((p) => !p.description && p.latitude != null && p.longitude != null);
    if (needsAddress.length > 0) {
      await Promise.allSettled(
        needsAddress.map(async (p) => {
          try {
            const res = await fetch(
              `https://api.mapbox.com/geocoding/v5/mapbox.places/${p.longitude},${p.latitude}.json?types=poi,address&limit=1&access_token=${mapboxToken}`,
            );
            if (!res.ok) return;
            const data = await res.json() as { features?: Array<{ place_name: string }> };
            const address = data.features?.[0]?.place_name;
            if (address) {
              await prisma.poi.update({ where: { id: p.id }, data: { description: address } });
              p.description = address;
            }
          } catch { /* best-effort */ }
        }),
      );
    }
  }

  const accommodations = accomPois.map((p) => {
    // Use favourite's address field when available (POI description may contain notes)
    let address: string | undefined;
    if (p.favouriteItemId) {
      const fav = allCountryFavs.find((f) => f.id === p.favouriteItemId);
      address = fav?.address ?? undefined;
    }
    if (!address && p.description && p.description.includes(",")) {
      address = p.description;
    }
    return { name: p.name, address };
  });

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
        isSubcity={!!city.parentCityId}
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
            type: city.type ?? "destination",
          },
          tripStartDate: city.trip.startDate.toISOString(),
          tripEndDate: city.trip.endDate.toISOString(),
          poiCount: pois.length,
          hasRecommendations: !!cachedActivities,
          hasAccommodation: !!city.accommodationPoiId,
        }}
        isStop={isStop}
        accommodations={isStop ? undefined : accommodations}
        stopAccommodation={isStop ? {
          initial: (() => {
            // Show only the explicitly selected accommodation (via accommodationPoiId)
            const selectedId = city.accommodationPoiId;
            if (!selectedId) return null;
            const a = accomPois.find((p) => p.id === selectedId);
            if (a && a.latitude != null && a.longitude != null) {
              // Use favourite's address field (not POI description which may contain notes)
              let address: string | undefined;
              if (a.favouriteItemId) {
                const fav = allCountryFavs.find((f) => f.id === a.favouriteItemId);
                address = fav?.address ?? undefined;
              }
              // If not from a favourite, description may be a Mapbox-backfilled address — use it only
              // if it looks like an address (contains a comma, typical of geocoded addresses)
              if (!address && a.description && a.description.includes(",")) {
                address = a.description;
              }
              // Otherwise, CityHeader's backfill useEffect will reverse-geocode
              return { id: a.id, name: a.name, latitude: a.latitude, longitude: a.longitude, address };
            }
            return null;
          })(),
          favourites: favouriteItems,
          cityLat: city.latitude,
          cityLon: city.longitude,
          pois: pois.map((p) => ({ id: p.id, name: p.name, category: p.category, latitude: p.latitude, longitude: p.longitude })),
          dayPlanIds: dayPlans.map((dp) => dp.id),
        } : undefined}
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
          <StopPlanningSection
            tripId={tripId}
            cityId={city.id}
            pois={pois as StopPoiDTO[]}
            cityLat={city.latitude ?? undefined}
            cityLon={city.longitude ?? undefined}
            cityName={city.nickname ?? city.name}
            country={city.country ?? undefined}
            favouriteItems={favouriteItems}
            initialAccommodation={
              (() => {
                const selectedId = city.accommodationPoiId;
                if (!selectedId) return null;
                const accom = city.pois.find((p) => p.id === selectedId);
                if (accom && accom.latitude != null && accom.longitude != null) {
                  // Use favourite address (not POI description which may contain notes)
                  let addr: string | undefined;
                  if (accom.favouriteItemId) {
                    const fav = allCountryFavs.find((f) => f.id === accom.favouriteItemId);
                    addr = fav?.address ?? undefined;
                  }
                  if (!addr && accom.description && accom.description.includes(",")) {
                    addr = accom.description;
                  }
                  return { id: accom.id, name: accom.name, latitude: accom.latitude, longitude: accom.longitude, address: addr };
                }
                return null;
              })()
            }
            dayPlans={dayPlans}
            initialNote={cityNote ?? null}
            initialRadiusKm={city.discoverRadiusKm ?? undefined}
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
            tripId={tripId}
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
