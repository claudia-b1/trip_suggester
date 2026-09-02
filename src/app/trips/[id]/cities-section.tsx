"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useRef } from "react";
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
  nickname: string | null;
  startDate: string;
  endDate: string;
  latitude: number | null;
  longitude: number | null;
  order: number;
  parentCityId: number | null;
  type: string; // "destination" | "stop"
  subcities: City[];
};

/** Display name: prefer nickname over system name */
function displayName(city: City): string {
  return city.nickname ?? city.name;
}

/** Short date like "Jun 6" */
function fmtShort(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function sortCities(list: City[]): City[] {
  return [...list]
    .sort((a, b) => {
      const dt = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
      return dt !== 0 ? dt : a.order - b.order;
    })
    .map((c) => ({
      ...c,
      subcities: c.subcities
        ? [...c.subcities].sort((a, b) => {
            const dt = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
            return dt !== 0 ? dt : a.order - b.order;
          })
        : [],
    }));
}

/** Add days to a YYYY-MM-DD string, returning another YYYY-MM-DD string (timezone-safe). */
function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
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
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const confirm = useConfirm();
  const prefillHandled = useRef(false);
  const addFormRef = useRef<HTMLFormElement>(null);

  // Local sorted list — enables optimistic reorder
  const [localCities, setLocalCities] = useState<City[]>(() => sortCities(cities));
  useEffect(() => { setLocalCities(sortCities(cities)); }, [cities]);

  // Pre-fill the add city form from query params (e.g. from recommendations nearby city)
  useEffect(() => {
    if (prefillHandled.current) return;
    const addCity = searchParams.get("addCity");
    if (addCity !== "1") return;
    prefillHandled.current = true;

    const cityName = searchParams.get("cityName") ?? "";
    const cityCountry = searchParams.get("cityCountry") ?? "";
    const cityLat = searchParams.get("cityLat");
    const cityLng = searchParams.get("cityLng");
    const parentCityIdParam = searchParams.get("parentCityId") ?? searchParams.get("addSubTo");

    if (cityName) {
      setName(cityName);
      if (cityCountry || cityLat || cityLng) {
        setCityMeta({
          name: cityName,
          country: cityCountry || "",
          countryCode: "",
          latitude: cityLat ? parseFloat(cityLat) : 0,
          longitude: cityLng ? parseFloat(cityLng) : 0,
          timezone: "",
        });
      }
    }

    // If a parentCityId is specified, use openAddForm with it to get proper date defaults
    if (parentCityIdParam) {
      const pid = Number(parentCityIdParam);
      if (Number.isInteger(pid)) {
        setAddParentCityId(pid);
      }
    }

    // Set default dates — use parent's range if adding sub-destination
    const parentCity = parentCityIdParam ? localCities.find((c) => c.id === Number(parentCityIdParam)) : null;
    const rangeStart = parentCity ? new Date(parentCity.startDate) : new Date(tripStartDate);
    const rangeEnd = parentCity ? new Date(parentCity.endDate) : new Date(tripEndDate);
    const today = new Date();
    const defaultStart = rangeStart > today ? rangeStart : today;
    const clampedStart = defaultStart < rangeStart ? rangeStart : defaultStart > rangeEnd ? rangeEnd : defaultStart;
    const defaultEnd = new Date(clampedStart);
    defaultEnd.setDate(defaultEnd.getDate() + (parentCity ? 1 : 2));
    const clampedEnd = defaultEnd > rangeEnd ? rangeEnd : defaultEnd;
    setStartDate(clampedStart.toISOString().slice(0, 10));
    setEndDate(clampedEnd.toISOString().slice(0, 10));
    setDateError(null);
    setAddOpen(true);

    // Scroll to the form after it renders
    requestAnimationFrame(() => {
      addFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    // Clean the URL by removing query params (replace without re-rendering)
    const url = new URL(window.location.href);
    url.searchParams.delete("addCity");
    url.searchParams.delete("cityName");
    url.searchParams.delete("cityCountry");
    url.searchParams.delete("cityLat");
    url.searchParams.delete("cityLng");
    url.searchParams.delete("parentCityId");
    window.history.replaceState({}, "", url.pathname + url.search);
  }, [searchParams, tripStartDate, tripEndDate]);

  // Map cities (only those with coords), numbered in display order — include subcities
  const mapCities = useMemo<TripCity[]>(() => {
    const result: TripCity[] = [];
    let num = 0;
    for (const c of localCities) {
      num++;
      if (c.latitude != null && c.longitude != null) {
        result.push({ id: c.id, name: displayName(c), latitude: c.latitude!, longitude: c.longitude!, order: num, parentCityId: null, type: c.type });
      }
      for (const s of c.subcities ?? []) {
        if (s.latitude != null && s.longitude != null) {
          result.push({ id: s.id, name: displayName(s), latitude: s.latitude!, longitude: s.longitude!, order: num, parentCityId: c.id, type: s.type });
        }
      }
    }
    return result;
  }, [localCities]);

  async function moveCity(cityId: number, dir: "up" | "down", parentId: number | null) {
    if (parentId !== null) {
      // Reorder within subcities of a parent
      const parent = localCities.find((c) => c.id === parentId);
      if (!parent) return;
      const subs = parent.subcities;
      const idx = subs.findIndex((c) => c.id === cityId);
      if (idx === -1) return;
      const city = subs[idx];
      const neighbor = subs[dir === "up" ? idx - 1 : idx + 1];
      if (!neighbor) return;
      if (city.startDate.slice(0, 10) !== neighbor.startDate.slice(0, 10)) return;

      // Optimistic swap
      const newSubs = [...subs];
      newSubs[idx] = neighbor;
      newSubs[dir === "up" ? idx - 1 : idx + 1] = city;
      setLocalCities((prev) =>
        prev.map((c) => (c.id === parentId ? { ...c, subcities: newSubs } : c)),
      );

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
        toast("Failed to reorder destinations", { variant: "error" });
        setLocalCities(sortCities(cities));
        return;
      }
      router.refresh();
      return;
    }

    // Reorder top-level cities
    const idx = localCities.findIndex((c) => c.id === cityId);
    if (idx === -1) return;
    const city = localCities[idx];
    const neighbor = localCities[dir === "up" ? idx - 1 : idx + 1];
    if (!neighbor) return;
    if (city.startDate.slice(0, 10) !== neighbor.startDate.slice(0, 10)) return;

    const next = [...localCities];
    next[idx] = neighbor;
    next[dir === "up" ? idx - 1 : idx + 1] = city;
    setLocalCities(next);

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
      toast("Failed to reorder destinations", { variant: "error" });
      setLocalCities(sortCities(cities));
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
  const [nickname, setNickname] = useState("");
  const [showNickname, setShowNickname] = useState(false);
  // Travel stop toggle
  const [isStop, setIsStop] = useState(false);
  // When adding a sub-destination, this is set to the parent city id
  const [addParentCityId, setAddParentCityId] = useState<number | null>(null);
  // "Move under" dropdown state
  const [moveMenuOpenId, setMoveMenuOpenId] = useState<number | null>(null);
  // Sub-destination parent picker
  const [subDestPickerOpen, setSubDestPickerOpen] = useState(false);
  // Generation options for new city
  const [genAbout, setGenAbout] = useState(true);
  const [genRecommendations, setGenRecommendations] = useState(true);
  const [genMustDo, setGenMustDo] = useState(true);
  const [genNearbyCities, setGenNearbyCities] = useState(true);
  const [genNearbyActivities, setGenNearbyActivities] = useState(true);
  const [maxCitiesKm, setMaxCitiesKm] = useState(150);
  const [maxActivitiesKm, setMaxActivitiesKm] = useState(50);
  const [generating, setGenerating] = useState<string | null>(null); // null | "about" | "recommendations" | "done"

  function openAddForm(parentCityId?: number) {
    // If adding a sub-destination, default dates to parent's range
    const parentCity = parentCityId ? localCities.find((c) => c.id === parentCityId) : null;

    const rangeStart = parentCity ? new Date(parentCity.startDate) : new Date(tripStartDate);
    const rangeEnd = parentCity ? new Date(parentCity.endDate) : new Date(tripEndDate);
    const today = new Date();

    const defaultStart = rangeStart > today ? rangeStart : today;
    const clampedStart = defaultStart < rangeStart ? rangeStart : defaultStart > rangeEnd ? rangeEnd : defaultStart;

    const defaultEnd = new Date(clampedStart);
    defaultEnd.setDate(defaultEnd.getDate() + (parentCity ? 1 : 2));
    const clampedEnd = defaultEnd > rangeEnd ? rangeEnd : defaultEnd;

    setStartDate(clampedStart.toISOString().slice(0, 10));
    setEndDate(clampedEnd.toISOString().slice(0, 10));
    setDateError(null);
    setAddParentCityId(parentCityId ?? null);
    setAddOpen(true);
  }

  function closeAddForm() {
    setName("");
    setNickname("");
    setShowNickname(false);
    setIsStop(false);
    setStartDate("");
    setEndDate("");
    setCityMeta(null);
    setDateError(null);
    setAddParentCityId(null);
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
        ...(nickname.trim() && { nickname: nickname.trim() }),
        startDate,
        endDate: endDate || startDate,
        ...(isStop && { type: "stop" }),
        ...(addParentCityId != null && { parentCityId: addParentCityId }),
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
      toast("Failed to add destination", { variant: "error" });
      setSubmitting(false);
      return;
    }
    const newCity = await res.json();
    const newCityId = newCity.id;
    setSubmitting(false);

    // Run background generation tasks (skip for travel stops)
    const shouldGenAbout = genAbout && !isStop;
    const shouldGenRecs = genRecommendations && (genMustDo || genNearbyCities || genNearbyActivities) && !isStop;

    if (shouldGenAbout || shouldGenRecs) {
      // Show generating state and keep form open
      if (shouldGenAbout) {
        setGenerating("about");
        try {
          await fetch(`/api/cities/${newCityId}/city-info`, { method: "POST" });
        } catch { /* ignore - non-critical */ }
      }

      if (shouldGenRecs) {
        setGenerating("recommendations");
        try {
          await fetch(`/api/cities/${newCityId}/activities`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              includeMustDo: genMustDo,
              includeNearbyCities: genNearbyCities,
              includeNearbyActivities: genNearbyActivities,
              maxNearbyCitiesKm: maxCitiesKm,
              maxNearbyActivitiesKm: maxActivitiesKm,
            }),
          });
        } catch { /* ignore - non-critical */ }
      }

      setGenerating(null);
    }

    setName("");
    setNickname("");
    setShowNickname(false);
    setStartDate("");
    setEndDate("");
    setCityMeta(null);
    setAddParentCityId(null);
    setAddOpen(false);
    router.refresh();
    toast(`Added ${newCity.nickname || newCity.name}${addParentCityId ? " as sub-destination" : ""}`);
  }

  async function onDelete(city: City) {
    const hasSubs = city.subcities && city.subcities.length > 0;
    const ok = await confirm({
      title: "Delete destination?",
      message: hasSubs
        ? `Remove "${displayName(city)}", its ${city.subcities.length} sub-destination(s), and all their POIs and day plans? This cannot be undone.`
        : `Remove "${displayName(city)}" and its POIs and day plans? This cannot be undone.`,
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
      toast("Failed to delete destination", { variant: "error" });
      return;
    }
    router.refresh();
  }

  async function moveUnder(cityId: number, newParentId: number) {
    setMoveMenuOpenId(null);
    const res = await fetch(`/api/trips/${tripId}/cities/${cityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentCityId: newParentId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast(data?.error || "Failed to move destination", { variant: "error" });
      return;
    }
    router.refresh();
    toast("Moved as sub-destination");
  }

  async function detachSubcity(cityId: number) {
    const res = await fetch(`/api/trips/${tripId}/cities/${cityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentCityId: null }),
    });
    if (!res.ok) {
      toast("Failed to detach destination", { variant: "error" });
      return;
    }
    router.refresh();
    toast("Promoted to top-level destination");
  }

  // Helper to render a single destination row
  function renderCityRow(city: City, index: number, isSubcity: boolean, parentIndex?: number) {
    const days = Math.round((new Date(city.endDate).getTime() - new Date(city.startDate).getTime()) / 86400000) + 1;
    const sameDay = city.startDate.slice(0, 10) === city.endDate.slice(0, 10);

    if (isSubcity) {
      const parentCity = localCities.find((c) => c.id === city.parentCityId);
      const siblings = parentCity?.subcities ?? [];
      const sibIdx = siblings.findIndex((s) => s.id === city.id);
      const sameDatePrev = sibIdx > 0 && siblings[sibIdx - 1].startDate.slice(0, 10) === city.startDate.slice(0, 10);
      const sameDateNext = sibIdx < siblings.length - 1 && siblings[sibIdx + 1].startDate.slice(0, 10) === city.startDate.slice(0, 10);

      return (
        <div
          key={city.id}
          className="group relative ml-8 flex items-center gap-2 rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 transition-all duration-150 hover:shadow-sm hover:border-[hsl(var(--ring))]"
        >
          {/* Connecting indicator */}
          <span className="absolute -left-5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] text-xs select-none">└</span>

          {/* Reorder column for subcities */}
          <div className="flex flex-col gap-0.5 shrink-0 w-5 sm:w-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => moveCity(city.id, "up", city.parentCityId)}
              aria-label="Move up"
              className={`flex h-5 w-5 sm:h-3 sm:w-3 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors ${sameDatePrev ? "" : "invisible"}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 sm:h-2.5 sm:w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button
              type="button"
              onClick={() => moveCity(city.id, "down", city.parentCityId)}
              aria-label="Move down"
              className={`flex h-5 w-5 sm:h-3 sm:w-3 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors ${sameDateNext ? "" : "invisible"}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 sm:h-2.5 sm:w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>

          <Link href={`/trips/${tripId}/cities/${city.id}`} className="flex-1 min-w-0">
            <p className="truncate text-xs font-medium group-hover:text-[hsl(var(--primary))] transition-colors">{displayName(city)}</p>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {sameDay
                ? `${fmtShort(city.startDate)} · ${days}d`
                : `${fmtShort(city.startDate)} – ${fmtShort(city.endDate)} · ${days}d`}
            </p>
          </Link>

          {/* Detach button */}
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-1 sm:py-0.5 text-[10px] text-[hsl(var(--muted-foreground))] opacity-100 sm:opacity-0 transition-all hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] sm:group-hover:opacity-100"
            onClick={() => detachSubcity(city.id)}
            title="Promote to top-level destination"
          >
            Detach
          </button>

          {/* Delete button */}
          <button
            type="button"
            className="shrink-0 rounded p-1.5 sm:p-1 text-[hsl(var(--muted-foreground))] opacity-100 sm:opacity-0 transition-all hover:bg-red-50 hover:text-red-600 sm:group-hover:opacity-100 disabled:opacity-30"
            onClick={() => onDelete(city)}
            disabled={deletingId === city.id}
            aria-label={`Delete ${displayName(city)}`}
          >
            {deletingId === city.id ? (
              <span className="text-[10px]">…</span>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 sm:h-3 sm:w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
    }

    // Top-level destination row
    const color = MARKER_COLORS[index % MARKER_COLORS.length];
    const sameDatePrev = index > 0 && localCities[index - 1].startDate.slice(0, 10) === city.startDate.slice(0, 10);
    const sameDateNext = index < localCities.length - 1 && localCities[index + 1].startDate.slice(0, 10) === city.startDate.slice(0, 10);
    const canMoveUp = sameDatePrev;
    const canMoveDown = sameDateNext;
    const otherTopLevel = localCities.filter((c) => c.id !== city.id);

    return (
      <div key={city.id}>
        <div className="group relative flex items-center gap-2.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 transition-all duration-150 hover:shadow-sm hover:border-[hsl(var(--ring))]">
          {/* Reorder column */}
          <div className="flex flex-col gap-0.5 shrink-0 w-6 sm:w-4 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => moveCity(city.id, "up", null)}
              aria-label="Move up"
              className={`flex h-6 w-6 sm:h-4 sm:w-4 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors ${canMoveUp ? "" : "invisible"}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-3 sm:w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button
              type="button"
              onClick={() => moveCity(city.id, "down", null)}
              aria-label="Move down"
              className={`flex h-6 w-6 sm:h-4 sm:w-4 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors ${canMoveDown ? "" : "invisible"}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-3 sm:w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>

          {/* Badge: number for destinations, car icon for stops */}
          {city.type === "stop" ? (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm bg-[hsl(var(--muted))] border border-dashed border-[hsl(var(--border))]" title="Travel stop">
              {"🚗"}
            </span>
          ) : (() => {
            // Destination number excludes stops
            const destIndex = localCities.filter((c, ci) => ci < index && c.type !== "stop").length;
            return (
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
                style={{ backgroundColor: MARKER_COLORS[destIndex % MARKER_COLORS.length] }}
              >
                {destIndex + 1}
              </span>
            );
          })()}

          <Link href={`/trips/${tripId}/cities/${city.id}`} className="flex-1 min-w-0">
            <p className={`truncate font-medium group-hover:text-[hsl(var(--primary))] transition-colors ${city.type === "stop" ? "text-xs text-[hsl(var(--muted-foreground))]" : "text-sm"}`}>{displayName(city)}</p>
            <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
              {city.type === "stop"
                ? fmtShort(city.startDate)
                : sameDay
                ? `${fmtShort(city.startDate)} · ${days}d`
                : `${fmtShort(city.startDate)} – ${fmtShort(city.endDate)} · ${days}d`}
            </p>
          </Link>

          {/* Move under dropdown */}
          {otherTopLevel.length > 0 && (
            <div className="relative shrink-0">
              <button
                type="button"
                className="rounded px-1.5 py-1 sm:py-0.5 text-[10px] text-[hsl(var(--muted-foreground))] opacity-100 sm:opacity-0 transition-all hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] sm:group-hover:opacity-100"
                onClick={() => setMoveMenuOpenId(moveMenuOpenId === city.id ? null : city.id)}
                title="Move under another destination"
              >
                Move under…
              </button>
              {moveMenuOpenId === city.id && (
                <div className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--popover))] py-1 shadow-lg">
                  {otherTopLevel.map((other) => (
                    <button
                      key={other.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[hsl(var(--muted))] transition-colors text-left"
                      onClick={() => moveUnder(city.id, other.id)}
                    >
                      {displayName(other)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Delete button */}
          <button
            type="button"
            className="shrink-0 rounded p-1.5 sm:p-1 text-[hsl(var(--muted-foreground))] opacity-100 sm:opacity-0 transition-all hover:bg-red-50 hover:text-red-600 sm:group-hover:opacity-100 disabled:opacity-30"
            onClick={() => onDelete(city)}
            disabled={deletingId === city.id}
            aria-label={`Delete ${displayName(city)}`}
          >
            {deletingId === city.id ? (
              <span className="text-[10px]">…</span>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-3.5 sm:w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4h6v2" />
              </svg>
            )}
          </button>
        </div>

        {/* Subcities */}
        {city.subcities && city.subcities.length > 0 && (
          <div className="flex flex-col gap-1 mt-1">
            {city.subcities.map((sub, si) => renderCityRow(sub, si, true, index))}
          </div>
        )}

      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Destinations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {cities.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[hsl(var(--border))] px-6 py-10 text-center">
            <span className="text-4xl mb-2">🏙️</span>
            <p className="text-sm font-medium">No destinations yet</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Add one below to start planning.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row">
            {/* Destination list — compact vertical stack */}
            <div className="flex flex-col gap-1.5 sm:w-64 shrink-0">
              {localCities.map((city, i) => renderCityRow(city, i, false))}
            </div>

            {/* Map */}
            {mapCities.length > 0 && (
              <div className="flex-1 h-[280px] sm:h-auto" style={{ minHeight: 280 }}>
                <TripMap cities={mapCities} />
              </div>
            )}
          </div>
        )}

        <div className="border-t border-[hsl(var(--border))] pt-4">
          {!addOpen ? (
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => { setSubDestPickerOpen(false); openAddForm(); }}>
                + Add destination
              </Button>
              {/* Sub-destination: pick parent first */}
              {localCities.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSubDestPickerOpen((v) => !v)}
                    className="text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] transition-colors"
                  >
                    + Add sub-destination
                  </button>
                  {subDestPickerOpen && (
                    <div className="absolute left-0 top-full mt-1 z-20 min-w-[200px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1 shadow-lg">
                      <p className="px-2 py-1 text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Under which destination?</p>
                      {localCities.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-[hsl(var(--muted))] transition-colors text-left"
                          onClick={() => { setSubDestPickerOpen(false); openAddForm(c.id); }}
                        >
                          <span>{c.type === "stop" ? "🚗" : "📍"}</span>
                          <span className="truncate">{displayName(c)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <form
              ref={addFormRef}
              onSubmit={onAdd}
              className="space-y-4"
              noValidate
            >
          {addParentCityId && (
            <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]/50 rounded-md px-3 py-1.5">
              <span>Adding sub-destination under</span>
              <span className="font-medium text-[hsl(var(--foreground))]">
                {(() => { const p = localCities.find((c) => c.id === addParentCityId); return p ? displayName(p) : ""; })()}
              </span>
              <button
                type="button"
                className="ml-auto text-[10px] hover:text-[hsl(var(--foreground))]"
                onClick={() => setAddParentCityId(null)}
              >
                (add as top-level instead)
              </button>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="city-name">Location</Label>
            <CityAutocomplete
              id="city-name"
              value={name}
              onChange={setName}
              onSelect={(d) => {
                setName(d.name);
                setCityMeta(d);
              }}
              placeholder="Search destinations…"
              required
            />
            {cityMeta && (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {[cityMeta.country, cityMeta.timezone].filter(Boolean).join(" · ")}
              </p>
            )}
            {/* Nickname toggle — appears after city is selected */}
            {cityMeta && !showNickname && (
              <button
                type="button"
                className="text-xs text-[hsl(var(--primary))] hover:underline"
                onClick={() => setShowNickname(true)}
              >
                + Set display name
              </button>
            )}
            {showNickname && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="city-nickname" className="text-xs whitespace-nowrap">Display name</Label>
                  <button
                    type="button"
                    className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    onClick={() => { setShowNickname(false); setNickname(""); }}
                  >
                    ✕
                  </button>
                </div>
                <Input
                  id="city-nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder={`e.g. "Amalfi Coast" instead of "${name}"`}
                  className="text-sm"
                />
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  Shown everywhere instead of &ldquo;{name}&rdquo;. The original name is kept for geocoding.
                </p>
              </div>
            )}
          </div>
          {/* Travel stop toggle (not for sub-destinations) */}
          {!addParentCityId && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isStop}
                onChange={(e) => {
                  setIsStop(e.target.checked);
                  if (e.target.checked && startDate) {
                    // Default stop to 2 days / 1 night
                    const computed = addDaysToDate(startDate, 1);
                    const maxDate = tripEndDate.slice(0, 10);
                    setEndDate(computed > maxDate ? maxDate : computed);
                  }
                }}
                className="rounded"
              />
              <span className="text-[hsl(var(--muted-foreground))]">Travel stop (passing through)</span>
            </label>
          )}

          <div className={isStop ? "grid gap-4 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2"}>
            <div className="space-y-2">
              <Label htmlFor="city-start">{isStop ? "Arrival" : "Start"}</Label>
              <Input
                id="city-start"
                type="date"
                value={startDate}
                min={tripStartDate.slice(0, 10)}
                max={tripEndDate.slice(0, 10)}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (isStop) {
                    // Default stop end = start + 1 (2 days, 1 night)
                    const computed = addDaysToDate(e.target.value, 1);
                    const maxDate = addParentCityId
                      ? (localCities.find((c) => c.id === addParentCityId)?.endDate.slice(0, 10) ?? tripEndDate.slice(0, 10))
                      : tripEndDate.slice(0, 10);
                    setEndDate(computed > maxDate ? maxDate : computed);
                  } else {
                    setDateError(validateDates(e.target.value, endDate));
                    if (endDate && endDate < e.target.value) {
                      setEndDate(e.target.value);
                    }
                  }
                }}
                required
              />
            </div>
            {isStop ? (
              <div className="space-y-2">
                <Label htmlFor="city-end-stop">Departure</Label>
                <Input
                  id="city-end-stop"
                  type="date"
                  value={endDate || (() => {
                    if (!startDate) return "";
                    const computed = addDaysToDate(startDate, 1);
                    const maxDate = tripEndDate.slice(0, 10);
                    return computed > maxDate ? maxDate : computed;
                  })()}
                  min={startDate || tripStartDate.slice(0, 10)}
                  max={tripEndDate.slice(0, 10)}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                  }}
                  required
                />
              </div>
            ) : (
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
            )}
          </div>
          {dateError && !isStop && (
            <p className="text-sm text-red-600">{dateError}</p>
          )}

          {/* Generation options (hidden for travel stops) */}
          {!isStop && <div className="space-y-2 rounded-lg border border-[hsl(var(--border))] p-3 bg-[hsl(var(--muted))]/30">
            <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Generate on creation
            </p>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={genAbout} onChange={(e) => setGenAbout(e.target.checked)} className="rounded" />
              About destination (AI-generated insights)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={genRecommendations} onChange={(e) => setGenRecommendations(e.target.checked)} className="rounded" />
              General recommendations
            </label>
            {genRecommendations && (
              <div className="ml-6 space-y-1.5">
                <label className="flex items-center gap-2 text-xs cursor-pointer text-[hsl(var(--muted-foreground))]">
                  <input type="checkbox" checked={genMustDo} onChange={(e) => setGenMustDo(e.target.checked)} className="rounded h-3.5 w-3.5" />
                  Must-do activities
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer text-[hsl(var(--muted-foreground))]">
                  <input type="checkbox" checked={genNearbyCities} onChange={(e) => setGenNearbyCities(e.target.checked)} className="rounded h-3.5 w-3.5" />
                  Nearby cities
                  {genNearbyCities && (
                    <span className="inline-flex items-center gap-1 ml-1">
                      <input
                        type="number"
                        value={maxCitiesKm}
                        onChange={(e) => setMaxCitiesKm(Number(e.target.value) || 150)}
                        className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                        min={10}
                        max={500}
                      />
                      <span className="text-[10px]">km max</span>
                    </span>
                  )}
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer text-[hsl(var(--muted-foreground))]">
                  <input type="checkbox" checked={genNearbyActivities} onChange={(e) => setGenNearbyActivities(e.target.checked)} className="rounded h-3.5 w-3.5" />
                  Recommended activities nearby
                  {genNearbyActivities && (
                    <span className="inline-flex items-center gap-1 ml-1">
                      <input
                        type="number"
                        value={maxActivitiesKm}
                        onChange={(e) => setMaxActivitiesKm(Number(e.target.value) || 50)}
                        className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                        min={5}
                        max={200}
                      />
                      <span className="text-[10px]">km max</span>
                    </span>
                  )}
                </label>
              </div>
            )}
          </div>}

          {generating && (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--primary))] animate-pulse">
              <span className="spinner" />
              {generating === "about" ? "Generating destination info…" : "Generating recommendations…"}
            </div>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={submitting || !!generating || !!dateError}>
              {submitting ? "Adding…" : generating ? "Generating…" : isStop ? "Add travel stop" : addParentCityId ? "Add sub-destination" : "Add destination"}
            </Button>
            <Button type="button" variant="outline" onClick={closeAddForm} disabled={submitting || !!generating}>
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
