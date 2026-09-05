"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CATEGORY_STYLES, CATEGORY_ICONS, type Category } from "@/lib/categories";
import { EditCityButton } from "./edit-city-button";
import { AddSubDestinationModal } from "@/components/ui/add-subdestination-modal";
import type { FavouriteItemDTO } from "@/components/favourites/favourites-provider";

function countryCodeToFlag(code: string): string {
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

function formatDateShort(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function LiveClock({ timezone }: { timezone: string }) {
  const [time, setTime] = useState("");

  useEffect(() => {
    function update() {
      try {
        setTime(
          new Date().toLocaleTimeString("en-US", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
        );
      } catch {
        setTime("");
      }
    }
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [timezone]);

  if (!time) return null;
  return (
    <span className="tabular-nums" suppressHydrationWarning>
      {time}
    </span>
  );
}

export type CityHeaderProps = {
  cityId: number;
  tripId: number;
  name: string;
  nickname: string | null;
  country: string | null;
  countryCode: string | null;
  timezone: string | null;
  startDate: string;
  endDate: string;
  cityOrder: number;
  totalCities: number;
  prevCityId: number | null;
  nextCityId: number | null;
  cities: { id: number; name: string; nickname?: string | null }[];
  activeCityId?: number;
  parentCity?: { id: number; name: string } | null;
  /** Whether this city is itself a sub-destination (has a parent) */
  isSubcity?: boolean;
  poiCounts: Record<Category, number>;
  plannedCount: number;
  totalPois: number;
  editProps?: {
    tripId: number;
    city: { id: number; name: string; nickname: string | null; startDate: string; endDate: string; type?: string };
    tripStartDate: string;
    tripEndDate: string;
    poiCount: number;
    hasRecommendations: boolean;
    hasAccommodation: boolean;
  };
  /** Whether this is a travel stop (simplified page — no auto-plan) */
  isStop?: boolean;
  accommodations?: { name: string; address?: string }[];
  /** Stop-only: interactive accommodation picker data */
  stopAccommodation?: {
    initial: { id: number; name: string; latitude: number; longitude: number; address?: string } | null;
    favourites: FavouriteItemDTO[];
    cityLat: number | null;
    cityLon: number | null;
    pois: { id: number; name: string; category: string; latitude: number | null; longitude: number | null }[];
    dayPlanIds: number[];
  };
};

export function CityHeader({
  cityId,
  tripId,
  name,
  nickname,
  country,
  countryCode,
  timezone,
  startDate,
  endDate,
  cityOrder,
  totalCities,
  prevCityId,
  nextCityId,
  cities,
  activeCityId,
  parentCity,
  isSubcity,
  poiCounts,
  plannedCount,
  totalPois,
  editProps,
  isStop,
  accommodations,
  stopAccommodation,
}: CityHeaderProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [autoPlanLoading, setAutoPlanLoading] = useState(false);
  const [addSubOpen, setAddSubOpen] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState(false);

  // ── Stop accommodation picker state ──
  const [accom, setAccom] = useState<{ id: number; name: string; latitude: number; longitude: number; address?: string } | null>(
    stopAccommodation?.initial ?? null,
  );
  const [accomOpen, setAccomOpen] = useState(false);
  const [accomQuery, setAccomQuery] = useState("");
  const [accomResults, setAccomResults] = useState<Array<{ id: string; place_name: string; text: string; center: [number, number] }>>([]);
  const [accomResultsOpen, setAccomResultsOpen] = useState(false);
  const [settingAccom, setSettingAccom] = useState(false);
  const accomDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync with server data on refresh
  useEffect(() => {
    setAccom(stopAccommodation?.initial ?? null);
  }, [stopAccommodation?.initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Backfill address via reverse geocode
  useEffect(() => {
    if (!accom || accom.address) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${accom.longitude},${accom.latitude}.json?types=poi,address&limit=1&access_token=${token}`,
        );
        if (!res.ok) return;
        const data = await res.json() as { features?: Array<{ place_name: string }> };
        const address = data.features?.[0]?.place_name;
        if (address) {
          setAccom((prev) => prev ? { ...prev, address } : prev);
          fetch(`/api/pois/${accom.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: address }),
          });
        }
      } catch { /* best-effort */ }
    })();
  }, [accom?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const accomFavourites = useMemo(() => {
    if (!stopAccommodation) return [];
    return stopAccommodation.favourites.filter(
      (f) => f.category === "ACCOMMODATION" && f.latitude != null && f.longitude != null,
    );
  }, [stopAccommodation?.favourites]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleAccomSearch(query: string) {
    setAccomQuery(query);
    if (accomDebounce.current) clearTimeout(accomDebounce.current);
    if (query.trim().length < 2) {
      setAccomResults([]);
      setAccomResultsOpen(false);
      return;
    }
    accomDebounce.current = setTimeout(async () => {
      try {
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        if (!token) return;
        const lat = stopAccommodation?.cityLat;
        const lon = stopAccommodation?.cityLon;
        const proximity = lat != null && lon != null ? `&proximity=${lon},${lat}` : "";
        const url =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query.trim())}.json` +
          `?types=poi,address,place&limit=5${proximity}&access_token=${token}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json() as { features?: Array<{ id: string; place_name: string; text: string; center: [number, number] }> };
        const features = data.features ?? [];
        setAccomResults(features);
        setAccomResultsOpen(features.length > 0);
      } catch { /* ignore */ }
    }, 300);
  }

  async function setAccomFromCoords(name: string, lat: number, lon: number, address?: string) {
    if (!stopAccommodation) return;
    setSettingAccom(true);
    try {
      // Check if an ACCOMMODATION POI with the same name or same coordinates already exists
      const existing = stopAccommodation.pois.find((p) =>
        p.category === "ACCOMMODATION" && (
          p.name.toLowerCase().trim() === name.toLowerCase().trim() ||
          (p.latitude != null && p.longitude != null &&
           Math.abs(p.latitude - lat) < 0.0005 && Math.abs(p.longitude - lon) < 0.0005)
        ),
      );

      let poiId: number;
      if (existing) {
        // Re-use existing POI instead of creating a duplicate
        poiId = existing.id;
      } else {
        // Create new ACCOMMODATION POI
        const res = await fetch(`/api/cities/${cityId}/pois`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            category: "ACCOMMODATION",
            latitude: lat,
            longitude: lon,
            ...(address && { description: address }),
          }),
        });
        if (!res.ok) throw new Error("Failed to create POI");
        const poi = await res.json();
        poiId = poi.id;
      }

      setAccom({ id: poiId, name, latitude: lat, longitude: lon, address });

      // Mark this POI as the selected accommodation on the city
      const patchRes = await fetch(`/api/trips/${tripId}/cities/${cityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accommodationPoiId: poiId }),
      });
      if (!patchRes.ok) throw new Error("Failed to save accommodation selection");

      // Auto-assign to evening slot of all days except last
      const dpIds = stopAccommodation.dayPlanIds;
      const assignDpIds = dpIds.length > 1 ? dpIds.slice(0, -1) : dpIds;
      for (const dpId of assignDpIds) {
        await fetch(`/api/cities/${cityId}/day-plans`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dayPlanId: dpId, poiId, timeSlot: "EVENING" }),
        });
      }

      toast(`Accommodation set: ${name}`);
      router.refresh();
    } catch {
      toast("Failed to set accommodation", { variant: "error" });
    } finally {
      setSettingAccom(false);
      setAccomOpen(false);
      setAccomQuery("");
      setAccomResults([]);
      setAccomResultsOpen(false);
    }
  }

  async function unselectAccom() {
    if (!accom) return;
    setSettingAccom(true);
    try {
      // Clear the selection on the city — the POI itself stays in the list
      await fetch(`/api/trips/${tripId}/cities/${cityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accommodationPoiId: null }),
      });
      setAccom(null);
      toast("Accommodation unselected");
      router.refresh();
    } catch {
      toast("Failed to unselect accommodation", { variant: "error" });
    } finally {
      setSettingAccom(false);
    }
  }

  const msPerDay = 86_400_000;
  const nights = Math.round(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / msPerDay,
  );
  const days = nights + 1;

  // planPct and hasCategories removed — POI stats row no longer shown in header

  async function handleAutoPlan() {
    setAutoPlanLoading(true);
    try {
      const res = await fetch(`/api/cities/${cityId}/auto-plan`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      toast("Auto-plan complete!", { variant: "default" });
      router.refresh();
    } catch {
      toast("Auto-plan failed", { variant: "error" });
    } finally {
      setAutoPlanLoading(false);
    }
  }

  async function handleReEnrich() {
    setEnrichLoading(true);
    try {
      const res = await fetch(`/api/cities/${cityId}/re-enrich`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const skippedMsg = data.skipped > 0 ? ` (${data.skipped} already had photos)` : "";
      toast(`Google photos: ${data.updated} updated out of ${data.checked} POIs${skippedMsg}`);
      if (data.updated > 0) router.refresh();
    } catch {
      toast("Photo refresh failed", { variant: "error" });
    } finally {
      setEnrichLoading(false);
    }
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 space-y-4">
      {/* Row 1: Name + country flag + city position */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {countryCode && (
            <span className="text-3xl leading-none" title={country ?? ""}>
              {countryCodeToFlag(countryCode)}
            </span>
          )}
          <div>
            {parentCity && (
              <button
                onClick={() => router.push(`/trips/${tripId}/cities/${parentCity.id}`)}
                className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] transition-colors mb-0.5 flex items-center gap-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                Sub-destination of {parentCity.name}
              </button>
            )}
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {nickname ?? name}
                {country && (
                  <span className="ml-2 text-lg font-normal text-[hsl(var(--muted-foreground))]">
                    {country}
                  </span>
                )}
              </h1>
              {editProps && (
                <EditCityButton
                  tripId={editProps.tripId}
                  city={editProps.city}
                  tripStartDate={editProps.tripStartDate}
                  tripEndDate={editProps.tripEndDate}
                  poiCount={editProps.poiCount}
                  hasRecommendations={editProps.hasRecommendations}
                  hasAccommodation={editProps.hasAccommodation}
                />
              )}
            </div>
            {nickname && (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {name}
              </p>
            )}
          </div>
        </div>
        {/* Add sub-destination — only for top-level cities (not for subcities themselves) */}
        {!isSubcity && (
          <button
            type="button"
            onClick={() => setAddSubOpen(true)}
            className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--muted))] border border-[hsl(var(--border))] transition-colors shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
            Add sub-destination
          </button>
        )}
        {totalCities > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {cities.map((c) => {
              const isActive = c.id === (activeCityId ?? cityId);
              return (
                <button
                  key={c.id}
                  onClick={() => !isActive && router.push(`/trips/${tripId}/cities/${c.id}`)}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] cursor-default"
                      : "border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
                  }`}
                >
                  {c.nickname ?? c.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Row 2: Dates + duration + timezone */}
      <div className="flex items-center gap-4 flex-wrap text-sm">
        <span className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
          📅
          <span className="text-[hsl(var(--foreground))] font-medium">
            {formatDateShort(startDate)} – {formatDateShort(endDate)}
          </span>
        </span>
        <span className="text-[hsl(var(--muted-foreground))]">·</span>
        <span className="font-medium">
          {nights} night{nights !== 1 ? "s" : ""} · {days} day{days !== 1 ? "s" : ""}
        </span>
        {timezone && (
          <>
            <span className="text-[hsl(var(--muted-foreground))]">·</span>
            <span className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
              🕐 <LiveClock timezone={timezone} />
              <span className="text-xs">{timezone.replace(/_/g, " ")}</span>
            </span>
          </>
        )}
      </div>

      {/* Accommodation — interactive picker for stops, static list for destinations */}
      {isStop && stopAccommodation ? (
        <div className="space-y-1">
          <div className="flex items-start sm:items-center gap-2 text-sm">
            <span className="shrink-0 mt-0.5 sm:mt-0">🏠</span>
            {accom ? (
              <>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium truncate">{accom.name}</span>
                    {accom.address && accom.address !== accom.name && (
                      <span className="hidden sm:inline text-xs text-[hsl(var(--primary))]/70 truncate">{accom.address}</span>
                    )}
                  </div>
                  {accom.address && accom.address !== accom.name && (
                    <p className="sm:hidden text-xs text-[hsl(var(--primary))]/70 truncate">{accom.address}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setAccomOpen((v) => !v)}
                  className="text-[11px] text-[hsl(var(--primary))] hover:underline shrink-0"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={unselectAccom}
                  disabled={settingAccom}
                  className="text-[11px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] shrink-0 disabled:opacity-50"
                >
                  Unselect
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setAccomOpen((v) => !v)}
                className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              >
                {accomOpen ? "Cancel" : "Select accommodation"}
              </button>
            )}
          </div>

          {/* Picker dropdown */}
          {accomOpen && (
            <div className="ml-6 space-y-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-2.5">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">Search by name or address</p>
                <div className="relative">
                  <input
                    type="text"
                    value={accomQuery}
                    onChange={(e) => handleAccomSearch(e.target.value)}
                    onFocus={() => accomResults.length > 0 && setAccomResultsOpen(true)}
                    onBlur={() => setTimeout(() => setAccomResultsOpen(false), 200)}
                    placeholder="e.g. Hotel Amara, Airbnb Bonn..."
                    autoComplete="off"
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1.5 text-xs text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))]"
                  />
                  {accomResultsOpen && accomResults.length > 0 && (
                    <ul className="absolute z-50 mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg overflow-hidden max-h-40 overflow-y-auto">
                      {accomResults.map((f) => (
                        <li key={f.id}>
                          <button
                            type="button"
                            className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-[hsl(var(--muted))] transition-colors"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              const [lon, lat] = f.center;
                              setAccomFromCoords(f.text, lat, lon, f.place_name);
                            }}
                          >
                            <span className="font-medium">{f.text}</span>
                            <br />
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))] line-clamp-1">{f.place_name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {accomFavourites.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">Or pick from nearby favourites</p>
                  <div className="max-h-32 overflow-y-auto space-y-0.5">
                    {accomFavourites.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        disabled={settingAccom}
                        onClick={() => setAccomFromCoords(f.name, f.latitude, f.longitude, f.address ?? undefined)}
                        className="w-full flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50"
                      >
                        <span className="text-xs shrink-0">🏠</span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium truncate">{f.name}</p>
                          {f.city && (
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">{f.city}</p>
                          )}
                        </div>
                        {f.list?.name && (
                          <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">{f.list.name}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : accommodations && accommodations.length > 0 ? (
        <div className="flex items-start gap-2 text-sm">
          <span className="shrink-0 mt-0.5">🏠</span>
          <div className="flex flex-col gap-0.5 min-w-0">
            {accommodations.map((a, i) => (
              <div key={i} className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate">{a.name}</span>
                  {a.address && a.address !== a.name && (
                    <span className="hidden sm:inline text-xs text-[hsl(var(--primary))]/70 truncate">{a.address}</span>
                  )}
                </div>
                {a.address && a.address !== a.name && (
                  <p className="sm:hidden text-xs text-[hsl(var(--primary))]/70 truncate">{a.address}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Row 3: Quick action chips */}
      {!isStop && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => scrollTo("pois-section")}
            className="rounded-full text-xs"
          >
            🗺 Map
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoPlan}
            disabled={autoPlanLoading || totalPois === 0}
            className="rounded-full text-xs"
          >
            {autoPlanLoading ? "Planning…" : "📋 Auto-plan"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => scrollTo("discover-section")}
            className="rounded-full text-xs"
          >
            🧭 Discover
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReEnrich}
            disabled={enrichLoading || totalPois === 0}
            className="rounded-full text-xs"
          >
            {enrichLoading ? "Refreshing…" : "📸 Google photos"}
          </Button>
        </div>
      )}
      {/* Add sub-destination modal */}
      {addSubOpen && (
        <AddSubDestinationModal
          tripId={tripId}
          parentCityId={cityId}
          parentCityName={nickname ?? name}
          parentStartDate={startDate}
          parentEndDate={endDate}
          onClose={() => setAddSubOpen(false)}
        />
      )}
    </div>
  );
}
