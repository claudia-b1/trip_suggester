"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CityAutocomplete, type CityDetails } from "@/components/ui/city-autocomplete";
import { TripMap } from "./trip-map";
import type { TripCity } from "./trip-map-impl";

type City = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  latitude: number | null;
  longitude: number | null;
  order: number;
};

/** Short date like "Jun 6" */
function fmtShort(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function sortCities(list: City[]) {
  return [...list].sort((a, b) => {
    const dt = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    return dt !== 0 ? dt : a.order - b.order;
  });
}

function validateDates(start: string, end: string): string | null {
  if (!start || !end) return null;
  if (new Date(end) < new Date(start)) {
    return "End date must be on or after start date.";
  }
  return null;
}

const MARKER_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
];

export function CitiesSection({
  tripId,
  cities,
  tripStartDate,
  tripEndDate,
}: {
  tripId: number;
  cities: City[];
  tripStartDate: string;
  tripEndDate: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();

  // Local sorted list — enables optimistic reorder
  const [localCities, setLocalCities] = useState<City[]>(() => sortCities(cities));
  useEffect(() => { setLocalCities(sortCities(cities)); }, [cities]);

  // Map cities (only those with coords), numbered in display order
  const mapCities = useMemo<TripCity[]>(() =>
    localCities
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c, i) => ({
        id: c.id,
        name: c.name,
        latitude: c.latitude!,
        longitude: c.longitude!,
        order: i + 1,
      })),
    [localCities],
  );

  async function moveCity(cityId: number, dir: "up" | "down") {
    const idx = localCities.findIndex((c) => c.id === cityId);
    if (idx === -1) return;
    const city = localCities[idx];
    const neighbor = localCities[dir === "up" ? idx - 1 : idx + 1];
    if (!neighbor) return;
    // Only allow reorder within same date group
    if (city.startDate.slice(0, 10) !== neighbor.startDate.slice(0, 10)) return;

    // Optimistic: swap positions
    const next = [...localCities];
    next[idx] = neighbor;
    next[dir === "up" ? idx - 1 : idx + 1] = city;
    setLocalCities(next);

    // Persist: swap their order values
    const [r1, r2] = await Promise.all([
      fetch(`/api/trips/${tripId}/cities/${city.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: neighbor.order }),
      }),
      fetch(`/api/trips/${tripId}/cities/${neighbor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: city.order }),
      }),
    ]);
    if (!r1.ok || !r2.ok) {
      toast("Failed to reorder cities", { variant: "error" });
      setLocalCities(sortCities(cities)); // revert
      return;
    }
    router.refresh();
  }

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [cityMeta, setCityMeta] = useState<CityDetails | null>(null);

  function openAddForm() {
    // Set default dates based on trip dates when opening the form
    const tripStart = new Date(tripStartDate);
    const tripEnd = new Date(tripEndDate);
    const today = new Date();
    
    // If trip hasn't started yet, use trip start date
    // If trip is ongoing or past, use today or trip start (whichever is later)
    const defaultStart = tripStart > today ? tripStart : today;
    // Ensure default start is within trip bounds
    const clampedStart = defaultStart < tripStart ? tripStart : defaultStart > tripEnd ? tripEnd : defaultStart;
    
    // Default end date is 3 days after start, but clamped to trip end
    const defaultEnd = new Date(clampedStart);
    defaultEnd.setDate(defaultEnd.getDate() + 2); // +2 to make it 3 days total
    const clampedEnd = defaultEnd > tripEnd ? tripEnd : defaultEnd;
    
    setStartDate(clampedStart.toISOString().slice(0, 10));
    setEndDate(clampedEnd.toISOString().slice(0, 10));
    setDateError(null);
    setAddOpen(true);
  }

  function closeAddForm() {
    setName("");
    setStartDate("");
    setEndDate("");
    setCityMeta(null);
    setDateError(null);
    setAddOpen(false);
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const err = validateDates(startDate, endDate);
    if (err) {
      setDateError(err);
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/trips/${tripId}/cities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        startDate,
        endDate,
        ...(cityMeta && {
          country: cityMeta.country,
          countryCode: cityMeta.countryCode,
          latitude: cityMeta.latitude,
          longitude: cityMeta.longitude,
          timezone: cityMeta.timezone,
        }),
      }),
    });
    if (!res.ok) {
      toast("Failed to add city", { variant: "error" });
      setSubmitting(false);
      return;
    }
    setName("");
    setStartDate("");
    setEndDate("");
    setCityMeta(null);
    setSubmitting(false);
    setAddOpen(false);
    router.refresh();
  }

  async function onDelete(city: City) {
    const ok = await confirm({
      title: "Delete city?",
      message: `Remove "${city.name}" and its POIs and day plans? This cannot be undone.`,
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(city.id);
    const res = await fetch(`/api/trips/${tripId}/cities/${city.id}`, {
      method: "DELETE",
    });
    setDeletingId(null);
    if (!res.ok) {
      toast("Failed to delete city", { variant: "error" });
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cities</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {cities.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[hsl(var(--border))] px-6 py-10 text-center">
            <span className="text-4xl mb-2">🏙️</span>
            <p className="text-sm font-medium">No cities yet</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Add one below to start planning.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* City list — compact vertical stack */}
            <div className="flex flex-col gap-1.5 sm:w-60 shrink-0">
              {localCities.map((city, i) => {
                const days = Math.round((new Date(city.endDate).getTime() - new Date(city.startDate).getTime()) / 86400000) + 1;
                const color = MARKER_COLORS[i % MARKER_COLORS.length];
                const sameDatePrev = i > 0 && localCities[i - 1].startDate.slice(0, 10) === city.startDate.slice(0, 10);
                const sameDateNext = i < localCities.length - 1 && localCities[i + 1].startDate.slice(0, 10) === city.startDate.slice(0, 10);
                const canMoveUp = sameDatePrev;
                const canMoveDown = sameDateNext;
                const sameDay = city.startDate.slice(0, 10) === city.endDate.slice(0, 10);

                return (
                  <div
                    key={city.id}
                    className="group relative flex items-center gap-2.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 transition-all duration-150 hover:shadow-sm hover:border-[hsl(var(--ring))]"
                  >
                    {/* Reorder column — always rendered so the number badge stays aligned */}
                    <div className="flex flex-col gap-0.5 shrink-0 w-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => moveCity(city.id, "up")}
                        aria-label="Move up"
                        className={`flex h-4 w-4 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors ${canMoveUp ? "" : "invisible"}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCity(city.id, "down")}
                        aria-label="Move down"
                        className={`flex h-4 w-4 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors ${canMoveDown ? "" : "invisible"}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                    </div>

                    {/* Number badge */}
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
                      style={{ backgroundColor: color }}
                    >
                      {i + 1}
                    </span>

                    <Link href={`/trips/${tripId}/cities/${city.id}`} className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium group-hover:text-[hsl(var(--primary))] transition-colors">{city.name}</p>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
                        {sameDay
                          ? `${fmtShort(city.startDate)} · ${days}d`
                          : `${fmtShort(city.startDate)} – ${fmtShort(city.endDate)} · ${days}d`}
                      </p>
                    </Link>

                    <button
                      type="button"
                      className="ml-auto shrink-0 rounded p-1 text-[hsl(var(--muted-foreground))] opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:opacity-30"
                      onClick={() => onDelete(city)}
                      disabled={deletingId === city.id}
                      aria-label={`Delete ${city.name}`}
                    >
                      {deletingId === city.id ? (
                        <span className="text-[10px]">…</span>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6" />
                          <path d="M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Map */}
            {mapCities.length > 0 && (
              <div className="flex-1 h-[240px] sm:h-auto" style={{ minHeight: 240 }}>
                <TripMap cities={mapCities} />
              </div>
            )}
          </div>
        )}

        <div className="border-t border-[hsl(var(--border))] pt-4">
          {!addOpen ? (
            <Button variant="outline" onClick={openAddForm}>
              + Add city
            </Button>
          ) : (
            <form
              onSubmit={onAdd}
              className="space-y-4"
              noValidate
            >
          <div className="space-y-2">
            <Label htmlFor="city-name">Name</Label>
            <CityAutocomplete
              id="city-name"
              value={name}
              onChange={setName}
              onSelect={(d) => {
                setName(d.name);
                setCityMeta(d);
              }}
              placeholder="Search cities…"
              required
            />
            {cityMeta && (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {cityMeta.country} · {cityMeta.timezone}
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="city-start">Start</Label>
              <Input
                id="city-start"
                type="date"
                value={startDate}
                min={tripStartDate.slice(0, 10)}
                max={tripEndDate.slice(0, 10)}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setDateError(validateDates(e.target.value, endDate));
                  // If end date is before new start date, update it to match
                  if (endDate && endDate < e.target.value) {
                    setEndDate(e.target.value);
                  }
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city-end">End</Label>
              <Input
                id="city-end"
                type="date"
                value={endDate}
                min={startDate || tripStartDate.slice(0, 10)}
                max={tripEndDate.slice(0, 10)}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDateError(validateDates(startDate, e.target.value));
                }}
                required
                aria-invalid={dateError ? "true" : undefined}
              />
            </div>
          </div>
          {dateError && (
            <p className="text-sm text-red-600">{dateError}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting || !!dateError}>
              {submitting ? "Adding…" : "Add city"}
            </Button>
            <Button type="button" variant="outline" onClick={closeAddForm} disabled={submitting}>
              Cancel
            </Button>
          </div>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
