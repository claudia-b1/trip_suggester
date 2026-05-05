import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { isCategory, CATEGORIES, type Category } from "@/lib/categories";
import { isTimeSlot, type TimeSlot } from "@/lib/slots";
import { ensureDayPlans } from "@/lib/day-plans";
import { PoisSection, type PoiDTO } from "./pois-section";
import type { DayPlanDTO } from "./daily-plan";
import { RecommendationsPanel } from "./recommendations-panel";
import { EditCityButton } from "./edit-city-button";
import { CityHeader } from "./city-header";

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
    select: { id: true, order: true },
  });
  const totalCities = siblingCities.length;
  const currentIdx = siblingCities.findIndex((c) => c.id === cityIdNum);
  const prevCityId = currentIdx > 0 ? siblingCities[currentIdx - 1].id : null;
  const nextCityId = currentIdx < siblingCities.length - 1 ? siblingCities[currentIdx + 1].id : null;

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
    isUnescoSite: p.isUnescoSite,
    inceptionYear: p.inceptionYear,
    wikidataId: p.wikidataId,
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
        poiCounts={poiCounts}
        plannedCount={plannedCount}
        totalPois={pois.length}
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
        />
      </div>

      <div id="discover-section">
        <RecommendationsPanel cityId={city.id} poisCount={pois.length} />
      </div>

      <div id="pois-section">
        <PoisSection cityId={city.id} pois={pois} dayPlans={dayPlans} cityLat={city.latitude ?? undefined} cityLon={city.longitude ?? undefined} />
      </div>
    </div>
  );
}
