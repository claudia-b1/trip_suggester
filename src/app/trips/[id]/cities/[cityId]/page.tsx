import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { isCategory } from "@/lib/categories";
import { isTimeSlot, type TimeSlot } from "@/lib/slots";
import { ensureDayPlans } from "@/lib/day-plans";
import { PoisSection, type PoiDTO } from "./pois-section";
import type { DayPlanDTO } from "./daily-plan";
import { RecommendationsPanel } from "./recommendations-panel";

export const dynamic = "force-dynamic";

function formatDate(d: Date) {
  return new Date(d).toLocaleDateString();
}

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

  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { label: "Trips", href: "/" },
          { label: city.trip.name, href: `/trips/${tripId}` },
          { label: city.name },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle>{city.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt className="text-[hsl(var(--muted-foreground))]">Start date</dt>
            <dd>{formatDate(city.startDate)}</dd>
            <dt className="text-[hsl(var(--muted-foreground))]">End date</dt>
            <dd>{formatDate(city.endDate)}</dd>
          </dl>
        </CardContent>
      </Card>

      <RecommendationsPanel cityId={city.id} />

      <PoisSection cityId={city.id} pois={pois} dayPlans={dayPlans} />
    </div>
  );
}
