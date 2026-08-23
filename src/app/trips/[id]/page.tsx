import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { DeleteTripButton } from "./delete-button";
import { EditTripButton } from "./edit-trip-button";
import { ArchiveTripButton } from "./archive-trip-button";
import { CoverImageUpload } from "./cover-image-upload";
import { CitiesSection } from "./cities-section";
import { TripTimeline } from "./trip-timeline";
import { TripNoteEditor } from "@/components/ui/trip-note-editor";

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

  // Load trip-level note (one per trip, not scoped to city/day)
  const tripNote = await prisma.tripNote.findFirst({
    where: { tripId, cityId: null, dayPlanId: null },
    select: { id: true, content: true },
  });

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Trips", href: "/" },
          { label: trip.name },
        ]}
      />

      {/* Trip header with cover image or gradient */}
      <div className="relative overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        {trip.coverImage ? (
          <div className="h-40 w-full overflow-hidden">
            <img src={trip.coverImage} alt={trip.name} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="h-3 bg-gradient-to-r from-blue-500 via-violet-500 to-indigo-500" />
        )}
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-gradient">{trip.name}</h1>
                {trip.archived && (
                  <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    📦 Archived
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
                <span className="mx-2">·</span>
                {(() => { const days = Math.round((trip.endDate.getTime() - trip.startDate.getTime()) / 86400000) + 1; return `${days} day${days === 1 ? "" : "s"}`; })()}
                <span className="mx-2">·</span>
                {trip.cities.length} {trip.cities.length === 1 ? "city" : "cities"}
              </p>
              <div className="mt-2">
                <CoverImageUpload tripId={trip.id} currentImage={trip.coverImage} />
              </div>
            </div>
            <div className="flex gap-2">
              <ArchiveTripButton id={trip.id} archived={trip.archived} />
              <EditTripButton
                trip={{
                  id: trip.id,
                  name: trip.name,
                  startDate: trip.startDate.toISOString(),
                  endDate: trip.endDate.toISOString(),
                }}
              />
              <DeleteTripButton id={trip.id} />
            </div>
          </div>

          {/* Gantt-style city timeline */}
          {trip.cities.length > 0 && (
            <TripTimeline
              cities={trip.cities.map((c) => ({
                id: c.id,
                name: c.name,
                startDate: c.startDate.toISOString(),
                endDate: c.endDate.toISOString(),
                order: c.order,
              }))}
              tripStartDate={trip.startDate.toISOString()}
              tripEndDate={trip.endDate.toISOString()}
            />
          )}
        </div>
      </div>

      <TripNoteEditor
        initialNote={tripNote ?? null}
        scope={{ tripId: trip.id }}
      />

      <CitiesSection
        tripId={trip.id}
        cities={trip.cities.map((c) => ({
          id: c.id,
          name: c.name,
          startDate: c.startDate.toISOString(),
          endDate: c.endDate.toISOString(),
          latitude: c.latitude ?? null,
          longitude: c.longitude ?? null,
          order: c.order,
        }))}
        tripStartDate={trip.startDate.toISOString()}
        tripEndDate={trip.endDate.toISOString()}
      />
    </div>
  );
}
