import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { DeleteTripButton } from "./delete-button";
import { CitiesSection } from "./cities-section";

export const dynamic = "force-dynamic";

function formatDate(d: Date) {
  return new Date(d).toLocaleDateString();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const tripId = Number(id);
  if (!Number.isInteger(tripId)) return { title: "Trip" };
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  return { title: trip?.name ?? "Trip" };
}

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tripId = Number(id);
  if (!Number.isInteger(tripId)) notFound();

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { cities: { orderBy: { order: "asc" } } },
  });
  if (!trip) notFound();

  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { label: "Trips", href: "/" },
          { label: trip.name },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle>{trip.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
            <dt className="text-[hsl(var(--muted-foreground))]">Start date</dt>
            <dd>{formatDate(trip.startDate)}</dd>
            <dt className="text-[hsl(var(--muted-foreground))]">End date</dt>
            <dd>{formatDate(trip.endDate)}</dd>
          </dl>
          <DeleteTripButton id={trip.id} />
        </CardContent>
      </Card>

      <CitiesSection
        tripId={trip.id}
        cities={trip.cities.map((c) => ({
          id: c.id,
          name: c.name,
          startDate: c.startDate.toISOString(),
          endDate: c.endDate.toISOString(),
        }))}
      />
    </div>
  );
}
