"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CATEGORY_STYLES, CATEGORY_ICONS, type Category } from "@/lib/categories";
import { EditCityButton } from "./edit-city-button";

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
  poiCounts: Record<Category, number>;
  plannedCount: number;
  totalPois: number;
  editProps?: {
    tripId: number;
    city: { id: number; name: string; nickname: string | null; startDate: string; endDate: string };
    tripStartDate: string;
    tripEndDate: string;
  };
  /** Whether this is a travel stop (simplified page — no auto-plan) */
  isStop?: boolean;
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
  poiCounts,
  plannedCount,
  totalPois,
  editProps,
  isStop,
}: CityHeaderProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [autoPlanLoading, setAutoPlanLoading] = useState(false);

  const msPerDay = 86_400_000;
  const nights = Math.round(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / msPerDay,
  );
  const days = nights + 1;

  const planPct = totalPois > 0 ? Math.round((plannedCount / totalPois) * 100) : 0;

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

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  const hasCategories = Object.values(poiCounts).some((v) => v > 0);

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

      {/* Row 3: POI stats + planning progress */}
      {(hasCategories || totalPois > 0) && (
        <div className="flex items-center gap-4 flex-wrap">
          {hasCategories && (
            <div className="flex items-center gap-2">
              {(Object.entries(poiCounts) as [Category, number][])
                .filter(([, count]) => count > 0)
                .map(([cat, count]) => (
                  <span
                    key={cat}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[cat].badge}`}
                  >
                    {CATEGORY_ICONS[cat]} {count}
                  </span>
                ))}
            </div>
          )}
          {totalPois > 0 && (
            <>
              {hasCategories && (
                <span className="text-[hsl(var(--muted-foreground))]">·</span>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  📋 {plannedCount}/{totalPois} planned
                </span>
                <div className="h-1.5 w-24 rounded-full bg-[hsl(var(--muted))]">
                  <div
                    className="h-full rounded-full bg-[hsl(var(--primary))] transition-all"
                    style={{ width: `${planPct}%` }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Row 4: Quick action chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => scrollTo("pois-section")}
          className="rounded-full text-xs"
        >
          🗺 Map
        </Button>
        {!isStop && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoPlan}
            disabled={autoPlanLoading || totalPois === 0}
            className="rounded-full text-xs"
          >
            {autoPlanLoading ? "Planning…" : "📋 Auto-plan"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => scrollTo("discover-section")}
          className="rounded-full text-xs"
        >
          🧭 Discover
        </Button>
      </div>
    </div>
  );
}
