import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function formatDate(d: Date) {
  return new Date(d).toLocaleDateString();
}

export default async function HomePage() {
  const trips = await prisma.trip.findMany({ orderBy: { startDate: "asc" } });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your trips</h1>
        <Button asChild>
          <Link href="/trips/new">Create trip</Link>
        </Button>
      </div>

      {trips.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-6 text-center">
            <p className="text-base font-medium">No trips yet</p>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Start by creating your first trip — add cities and points of
              interest from there.
            </p>
            <div className="pt-2">
              <Button asChild>
                <Link href="/trips/new">Create your first trip</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-[hsl(var(--border))]">
            {trips.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/trips/${trip.id}`}
                  className="flex flex-col gap-1 p-4 hover:bg-[hsl(var(--muted))] sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-medium">{trip.name}</span>
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">
                    {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
