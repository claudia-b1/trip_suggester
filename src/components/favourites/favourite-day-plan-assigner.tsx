"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TIME_SLOTS, type TimeSlot } from "@/lib/slots";
import { useToast } from "@/components/ui/toast";
import {
  useFavourites,
  type FavouriteItemDTO,
  type DayPlanOption,
} from "./favourites-provider";

/* ── Types for cascade data ───────────────────────────────────────────── */

type TripOption = { id: number; name: string };
type CityOption = { id: number; name: string };
type DayPlanFetched = { id: number; date: string };

/**
 * Inline day-plan assigner for favourite items.
 * Two modes:
 * - **Connected**: when `cityId` + `dayPlans` are provided (via currentCity context on a city page)
 * - **Standalone**: when no city context — shows Trip → City → Day cascade pickers
 */
export function FavouriteDayPlanAssigner({
  item,
  cityId,
  dayPlans,
}: {
  item: FavouriteItemDTO;
  cityId?: number;
  dayPlans?: DayPlanOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { refreshLists } = useFavourites();
  const [open, setOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot>("MORNING");
  const [assigning, setAssigning] = useState(false);

  // Standalone cascade state
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<number | null>(null);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [selectedCity, setSelectedCity] = useState<number | null>(null);
  const [cascadeDayPlans, setCascadeDayPlans] = useState<DayPlanOption[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingDays, setLoadingDays] = useState(false);

  const isConnected = cityId != null && dayPlans != null && dayPlans.length > 0;
  const effectiveCityId = isConnected ? cityId : selectedCity;
  const effectiveDayPlans = isConnected ? dayPlans : cascadeDayPlans;

  // Fetch trips on open (standalone mode)
  useEffect(() => {
    if (!open || isConnected) return;
    if (trips.length > 0) return; // already loaded
    setLoadingTrips(true);
    fetch("/api/trips")
      .then((r) => r.json())
      .then((data: TripOption[]) => setTrips(data))
      .catch(() => {})
      .finally(() => setLoadingTrips(false));
  }, [open, isConnected, trips.length]);

  // Fetch cities when trip changes
  useEffect(() => {
    if (!selectedTrip || isConnected) return;
    setLoadingCities(true);
    setCities([]);
    setSelectedCity(null);
    setCascadeDayPlans([]);
    setSelectedDay(null);
    fetch(`/api/trips/${selectedTrip}/cities`)
      .then((r) => r.json())
      .then((data: CityOption[]) => setCities(data))
      .catch(() => {})
      .finally(() => setLoadingCities(false));
  }, [selectedTrip, isConnected]);

  // Fetch day plans when city changes (standalone)
  useEffect(() => {
    if (!selectedCity || isConnected) return;
    setLoadingDays(true);
    setCascadeDayPlans([]);
    setSelectedDay(null);
    fetch(`/api/cities/${selectedCity}/day-plans`)
      .then((r) => r.json())
      .then((data: DayPlanFetched[]) => {
        setCascadeDayPlans(
          data.map((d) => ({
            id: d.id,
            label: new Date(d.date).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            }),
          })),
        );
      })
      .catch(() => {})
      .finally(() => setLoadingDays(false));
  }, [selectedCity, isConnected]);

  async function assign() {
    if (!selectedDay || !effectiveCityId) return;
    setAssigning(true);
    try {
      // Step 1: Import as POI
      const poiRes = await fetch(`/api/cities/${effectiveCityId}/pois`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: item.name,
          category: item.category,
          description: item.description || undefined,
          latitude: item.latitude,
          longitude: item.longitude,
        }),
      });
      if (!poiRes.ok) {
        toast("Failed to import as POI", { variant: "error" });
        return;
      }
      const newPoi = await poiRes.json();

      // Step 2: Assign to day plan
      const actRes = await fetch(`/api/day-plans/${selectedDay}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poiId: newPoi.id, timeSlot: selectedSlot }),
      });
      if (!actRes.ok) {
        toast("POI imported but failed to assign to day plan", {
          variant: "error",
        });
      } else {
        toast(`${item.name} added to day plan!`);
      }

      setOpen(false);
      await refreshLists();
      router.refresh();
    } catch {
      toast("Something went wrong", { variant: "error" });
    } finally {
      setAssigning(false);
    }
  }

  const selectCls =
    "w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-0.5 text-[10px]";

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
      >
        <span
          className={`text-[8px] transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        📅 Add to day plan
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {/* Trip selector (standalone mode) */}
          {!isConnected && (
            <>
              <select
                value={selectedTrip ?? ""}
                onChange={(e) => setSelectedTrip(Number(e.target.value) || null)}
                className={selectCls}
                disabled={loadingTrips}
              >
                <option value="">
                  {loadingTrips ? "Loading trips..." : "Pick a trip..."}
                </option>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              {/* City selector */}
              {selectedTrip && (
                <select
                  value={selectedCity ?? ""}
                  onChange={(e) =>
                    setSelectedCity(Number(e.target.value) || null)
                  }
                  className={selectCls}
                  disabled={loadingCities}
                >
                  <option value="">
                    {loadingCities ? "Loading cities..." : "Pick a city..."}
                  </option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}

          {/* Day plan selector */}
          {(isConnected || selectedCity) && (
            <select
              value={selectedDay ?? ""}
              onChange={(e) => setSelectedDay(Number(e.target.value) || null)}
              className={selectCls}
              disabled={loadingDays}
            >
              <option value="">
                {loadingDays ? "Loading days..." : "Pick a day..."}
              </option>
              {effectiveDayPlans.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          )}

          {/* Time slot selector */}
          {selectedDay && (
            <>
              <select
                value={selectedSlot}
                onChange={(e) => setSelectedSlot(e.target.value as TimeSlot)}
                className={selectCls}
              >
                {TIME_SLOTS.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={assign}
                disabled={!selectedDay || assigning}
                className="w-full rounded bg-[hsl(var(--primary))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40 hover:opacity-90"
              >
                {assigning
                  ? "Adding..."
                  : `Import & add to ${selectedSlot.toLowerCase()}`}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
