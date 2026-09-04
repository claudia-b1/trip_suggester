"use client";

import { useState } from "react";

const MARKER_COLORS = ["#4f46e5", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

type TimelineSubcity = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  order: number;
  parentCityId: number | null;
  type?: string;
};

type TimelineCity = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  order: number;
  parentCityId: number | null;
  type?: string;
  subcities: TimelineSubcity[];
};

export function TripTimeline({
  cities,
  tripStartDate,
  tripEndDate,
}: {
  cities: TimelineCity[];
  tripStartDate: string;
  tripEndDate: string;
}) {
  const [open, setOpen] = useState(true);

  const tripStart = new Date(tripStartDate).getTime();
  const tripEnd = new Date(tripEndDate).getTime();
  const tripDuration = tripEnd - tripStart || 1;
  const totalDays = Math.round(tripDuration / 86400000) + 1;

  // Sort by startDate first, then order — matches sortCities() in cities-section.tsx
  const sortedCities = [...cities].sort((a, b) => {
    const dt = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    return dt !== 0 ? dt : a.order - b.order;
  });

  // Generate date ticks — show ~5-7 evenly-spaced dates
  const tickCount = Math.min(totalDays, 7);
  const ticks: { label: string; pct: number }[] = [];
  for (let t = 0; t < tickCount; t++) {
    const frac = tickCount <= 1 ? 0 : t / (tickCount - 1);
    const d = new Date(tripStart + frac * tripDuration);
    ticks.push({
      label: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      pct: frac * 100,
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide hover:text-[hsl(var(--foreground))] transition-colors py-1"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        Timeline
      </button>

      {open && (
        <div className="space-y-2 pt-1">
          {/* Date tick header */}
          <div className="relative h-5 ml-[72px] sm:ml-[130px]">
            {ticks.map((tick, i) => (
              <span
                key={i}
                className="absolute text-[10px] text-[hsl(var(--muted-foreground))] -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${tick.pct}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          {/* City rows */}
          {sortedCities.map((city, i) => {
            const destIndex = sortedCities.filter((c, ci) => ci < i && c.type !== "stop").length;
            const color = city.type === "stop" ? "#6b7280" : MARKER_COLORS[destIndex % MARKER_COLORS.length];
            const cityStart = new Date(city.startDate).getTime();
            const cityEnd = new Date(city.endDate).getTime();
            const left = ((cityStart - tripStart) / tripDuration) * 100;
            const width = Math.max(((cityEnd - cityStart) / tripDuration) * 100, 3);
            const cityDays = Math.round((cityEnd - cityStart) / 86400000) + 1;

            const sortedSubs = [...(city.subcities ?? [])].sort((a, b) => {
              const dt = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
              return dt !== 0 ? dt : a.order - b.order;
            });

            return (
              <div key={city.id} className="space-y-0.5">
                {/* Parent row */}
                <div className="flex items-center gap-2">
                  {/* City label */}
                  <div className="w-[64px] sm:w-[120px] shrink-0 flex items-center gap-1 sm:gap-1.5 min-w-0">
                    {city.type === "stop" ? (
                      <span className="h-2.5 w-2.5 shrink-0 text-[10px] leading-none">{"🚗"}</span>
                    ) : (
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    )}
                    <span className={`text-[10px] sm:text-xs truncate ${city.type === "stop" ? "text-[hsl(var(--muted-foreground))]" : "font-medium"}`}>{city.name}</span>
                  </div>
                  {/* Bar track */}
                  <div className="relative h-7 flex-1 rounded-md bg-[hsl(var(--muted))]/50">
                    {/* Vertical grid lines */}
                    {ticks.map((tick, j) => (
                      <div
                        key={j}
                        className="absolute top-0 h-full w-px bg-[hsl(var(--border))]/50"
                        style={{ left: `${tick.pct}%` }}
                      />
                    ))}
                    {/* City bar */}
                    <div
                      className={`absolute top-1 bottom-1 rounded-md flex items-center justify-center overflow-hidden ${city.type === "stop" ? "border border-dashed border-gray-400 bg-gray-200/30 dark:bg-gray-700/30" : "shadow-sm"}`}
                      style={{ left: `${left}%`, width: `${width}%`, ...(city.type !== "stop" ? { backgroundColor: color } : {}) }}
                    >
                      <span className={`text-[10px] font-medium whitespace-nowrap px-1.5 ${city.type === "stop" ? "text-gray-500 dark:text-gray-400" : "text-white/90 drop-shadow-sm"}`}>
                        {city.type === "stop" ? "stop" : `${cityDays}d`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Sub-destination rows */}
                {sortedSubs.length > 0 && (
                  <div className="relative">
                    {/* Vertical connector line from parent to subcities */}
                    <div
                      className="absolute left-[18px] top-0 w-px border-l border-dashed"
                      style={{ borderColor: color, opacity: 0.4, bottom: 10 }}
                    />
                    {sortedSubs.map((sub, si) => {
                      const subStart = new Date(sub.startDate).getTime();
                      const subEnd = new Date(sub.endDate).getTime();
                      const subLeft = ((subStart - tripStart) / tripDuration) * 100;
                      const subWidth = Math.max(((subEnd - subStart) / tripDuration) * 100, 2);
                      const subDays = Math.round((subEnd - subStart) / 86400000) + 1;
                      const isLast = si === sortedSubs.length - 1;

                      return (
                        <div key={sub.id} className="flex items-center gap-2">
                          {/* Subcity label — indented with connecting branch */}
                          <div className="w-[64px] sm:w-[120px] shrink-0 flex items-center gap-1 min-w-0 pl-3 sm:pl-4">
                            <span className="text-[10px] select-none" style={{ color, opacity: 0.5 }}>
                              {isLast ? "└" : "├"}
                            </span>
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">{sub.name}</span>
                          </div>
                          {/* Bar track — thinner */}
                          <div className="relative h-5 flex-1 rounded-md">
                            {/* Vertical grid lines */}
                            {ticks.map((tick, j) => (
                              <div
                                key={j}
                                className="absolute top-0 h-full w-px bg-[hsl(var(--border))]/30"
                                style={{ left: `${tick.pct}%` }}
                              />
                            ))}
                            {/* Subcity bar — lighter, thinner, dashed border */}
                            <div
                              className="absolute top-1 bottom-1 rounded flex items-center justify-center overflow-hidden border border-dashed"
                              style={{
                                left: `${subLeft}%`,
                                width: `${subWidth}%`,
                                backgroundColor: color,
                                opacity: 0.35,
                                borderColor: color,
                              }}
                            >
                              <span className="text-[9px] font-medium text-white whitespace-nowrap px-1 drop-shadow-sm">
                                {subDays}d
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
