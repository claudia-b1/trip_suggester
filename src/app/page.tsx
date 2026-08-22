import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { TripGrid } from "@/components/trip-grid";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [trips, archivedCount] = await Promise.all([
    prisma.trip.findMany({
      orderBy: { startDate: "asc" },
      include: { cities: { select: { id: true } } },
    }),
    prisma.trip.count({ where: { archived: true } }),
  ]);

  const serializedTrips = trips.map((t) => ({
    id: t.id,
    name: t.name,
    startDate: t.startDate.toISOString(),
    endDate: t.endDate.toISOString(),
    createdAt: t.createdAt.toISOString(),
    archived: t.archived,
    coverImage: t.coverImage,
    cityCount: t.cities.length,
  }));

  return (
    <div className="space-y-8">
      {/* Hero section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[hsl(var(--primary))]/10 via-[hsl(var(--primary))]/5 to-transparent border border-[hsl(var(--border))] px-8 py-12">
        <div className="absolute -right-8 -top-8 text-[120px] opacity-10 select-none">🌍</div>
        <div className="relative">
          <h1 className="text-4xl font-bold tracking-tight text-gradient">Where to next?</h1>
          <p className="mt-2 text-lg text-[hsl(var(--muted-foreground))]">
            Plan your perfect trip with smart recommendations and daily itineraries.
          </p>
          <div className="mt-6">
            <Button asChild size="lg">
              <Link href="/trips/new">
                <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create a trip
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Trips section */}
      <div>
        <h2 className="mb-4 text-xl font-semibold">Your trips</h2>

        {trips.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[hsl(var(--border))] px-8 py-16 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="mb-4 h-20 w-20 text-[hsl(var(--muted-foreground))]/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 8H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V10a2 2 0 00-2-2z"/>
              <path d="M8 8V6a4 4 0 018 0v2"/>
              <line x1="12" y1="13" x2="12" y2="17"/>
              <circle cx="12" cy="13" r="1"/>
            </svg>
            <p className="text-lg font-medium">No trips yet</p>
            <p className="mt-1 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">
              Start by creating your first trip — add cities and discover points of interest from there.
            </p>
            <div className="mt-5">
              <Button asChild>
                <Link href="/trips/new">Create your first trip</Link>
              </Button>
            </div>
          </div>
        ) : (
          <TripGrid trips={serializedTrips} archivedCount={archivedCount} />
        )}
      </div>
    </div>
  );
}
