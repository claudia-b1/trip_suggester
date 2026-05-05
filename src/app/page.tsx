import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

function formatDate(d: Date) {
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function durationLabel(start: Date, end: Date) {
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (days >= 14) return `${Math.round(days / 7)} weeks`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

const TRIP_GRADIENTS = [
  "from-blue-500/20 to-violet-500/20",
  "from-emerald-500/20 to-teal-500/20",
  "from-orange-500/20 to-rose-500/20",
  "from-indigo-500/20 to-cyan-500/20",
  "from-pink-500/20 to-amber-500/20",
  "from-sky-500/20 to-purple-500/20",
];

export default async function HomePage() {
  const trips = await prisma.trip.findMany({
    orderBy: { startDate: "asc" },
    include: { cities: { select: { id: true } } },
  });

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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((trip, idx) => {
              const grad = TRIP_GRADIENTS[idx % TRIP_GRADIENTS.length];
              const cityCount = trip.cities.length;
              const duration = durationLabel(trip.startDate, trip.endDate);
              return (
                <Link
                  key={trip.id}
                  href={`/trips/${trip.id}`}
                  className="group relative overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
                >
                  {/* Gradient header */}
                  <div className={`h-24 bg-gradient-to-br ${grad} flex items-end p-4`}>
                    <span className="text-3xl opacity-60 group-hover:opacity-100 transition-opacity">
                      {cityCount > 3 ? "🌎" : cityCount > 1 ? "✈️" : "📍"}
                    </span>
                  </div>

                  <div className="p-4 space-y-2">
                    <h3 className="text-lg font-semibold leading-tight group-hover:text-[hsl(var(--primary))] transition-colors">
                      {trip.name}
                    </h3>
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">
                      {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
                    </p>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--primary))]/10 px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--primary))]">
                        📅 {duration}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--muted))] px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                        🏙️ {cityCount} {cityCount === 1 ? "city" : "cities"}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
