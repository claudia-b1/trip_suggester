"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { CopyToUserModal } from "@/components/user/copy-to-user-modal";
import { useUser } from "@/components/user/user-provider";

type TripItem = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  archived: boolean;
  coverImage: string | null;
  cityCount: number;
};

type SortOption = "date-asc" | "date-desc" | "name-asc" | "created-desc";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "date-asc", label: "Upcoming first" },
  { value: "date-desc", label: "Past first" },
  { value: "name-asc", label: "A → Z" },
  { value: "created-desc", label: "Recently added" },
];

const TRIP_GRADIENTS = [
  "from-blue-500/20 to-violet-500/20",
  "from-emerald-500/20 to-teal-500/20",
  "from-orange-500/20 to-rose-500/20",
  "from-indigo-500/20 to-cyan-500/20",
  "from-pink-500/20 to-amber-500/20",
  "from-sky-500/20 to-purple-500/20",
];

function formatDate(d: string) {
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function durationLabel(start: string, end: string) {
  const days =
    Math.round(
      (new Date(end).getTime() - new Date(start).getTime()) / 86400000,
    ) + 1;
  if (days >= 14) return `${Math.round(days / 7)} weeks`;
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function TripGrid({
  trips,
  archivedCount,
}: {
  trips: TripItem[];
  archivedCount: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { users } = useUser();

  const [sortBy, setSortBy] = useState<SortOption>("date-asc");
  const [showArchived, setShowArchived] = useState(false);
  const [copyTrip, setCopyTrip] = useState<TripItem | null>(null);

  // Restore sort preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("trip-sort");
    if (saved && SORT_OPTIONS.some((o) => o.value === saved)) {
      setSortBy(saved as SortOption);
    }
  }, []);

  function handleSortChange(val: SortOption) {
    setSortBy(val);
    localStorage.setItem("trip-sort", val);
  }

  const visibleTrips = useMemo(() => {
    const filtered = showArchived
      ? trips
      : trips.filter((t) => !t.archived);

    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "date-asc":
          return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
        case "date-desc":
          return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "created-desc":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default:
          return 0;
      }
    });

    return sorted;
  }, [trips, sortBy, showArchived]);

  async function toggleArchive(id: number, archived: boolean) {
    const res = await fetch(`/api/trips/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !archived }),
    });
    if (res.ok) {
      toast(archived ? "Trip unarchived" : "Trip archived");
      router.refresh();
    } else {
      toast("Failed to update trip", { variant: "error" });
    }
  }

  return (
    <div className="space-y-3">
      {/* Sort + Archive controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">Sort:</span>
          <div className="inline-flex rounded-md border border-[hsl(var(--border))] p-0.5">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleSortChange(opt.value)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  sortBy === opt.value
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={`ml-auto rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-all ${
              showArchived
                ? "border-amber-400 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            }`}
          >
            {showArchived ? "Hide" : "Show"} archived ({archivedCount})
          </button>
        )}
      </div>

      {/* Trip cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleTrips.map((trip, idx) => {
          const grad = TRIP_GRADIENTS[idx % TRIP_GRADIENTS.length];
          const cityCount = trip.cityCount;
          const duration = durationLabel(trip.startDate, trip.endDate);
          const isPast = new Date(trip.endDate) < new Date();

          return (
            <div
              key={trip.id}
              className={`group relative overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${
                trip.archived ? "opacity-60" : ""
              }`}
            >
              <Link href={`/trips/${trip.id}`}>
                {/* Cover image or gradient header */}
                {trip.coverImage ? (
                  <div className="h-28 w-full overflow-hidden">
                    <img
                      src={trip.coverImage}
                      alt={trip.name}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                ) : (
                  <div className={`h-24 bg-gradient-to-br ${grad} flex items-end p-4`}>
                    <span className="text-3xl opacity-60 group-hover:opacity-100 transition-opacity">
                      {cityCount > 3 ? "🌎" : cityCount > 1 ? "✈️" : "📍"}
                    </span>
                  </div>
                )}

                <div className="p-4 space-y-2">
                  <h3 className="text-lg font-semibold leading-tight group-hover:text-[hsl(var(--primary))] transition-colors">
                    {trip.name}
                  </h3>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--primary))]/10 px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--primary))]">
                      📅 {duration}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--muted))] px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                      🏙️ {cityCount} {cityCount === 1 ? "destination" : "destinations"}
                    </span>
                    {trip.archived && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        📦 Archived
                      </span>
                    )}
                  </div>
                </div>
              </Link>

              {/* Copy + Archive buttons */}
              {users.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCopyTrip(trip);
                  }}
                  className="absolute right-10 top-2 flex h-8 w-8 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-black/40 text-white opacity-100 sm:opacity-0 transition-opacity sm:group-hover:opacity-100 hover:bg-black/60"
                  title="Copy to another user"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleArchive(trip.id, trip.archived);
                }}
                className="absolute right-2 top-2 flex h-8 w-8 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-black/40 text-white opacity-100 sm:opacity-0 transition-opacity sm:group-hover:opacity-100 hover:bg-black/60"
                title={trip.archived ? "Unarchive trip" : "Archive trip"}
              >
                {trip.archived ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="17 11 12 6 7 11" />
                    <line x1="12" y1="6" x2="12" y2="18" />
                    <path d="M5 18h14" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="21 8 21 21 3 21 3 8" />
                    <rect x="1" y="3" width="22" height="5" />
                    <line x1="10" y1="12" x2="14" y2="12" />
                  </svg>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {visibleTrips.length === 0 && trips.length > 0 && (
        <p className="text-center text-sm text-[hsl(var(--muted-foreground))] py-8">
          All trips are archived.{" "}
          <button onClick={() => setShowArchived(true)} className="text-[hsl(var(--primary))] hover:underline">
            Show archived trips
          </button>
        </p>
      )}

      {copyTrip && (
        <CopyToUserModal
          entityType="trip"
          entityName={copyTrip.name}
          onCopy={async (targetUserId) => {
            const res = await fetch(`/api/trips/${copyTrip.id}/copy`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ targetUserId }),
            });
            if (res.ok) {
              toast("Trip copied successfully");
            } else {
              toast("Failed to copy trip", { variant: "error" });
            }
          }}
          onClose={() => setCopyTrip(null)}
        />
      )}
    </div>
  );
}
