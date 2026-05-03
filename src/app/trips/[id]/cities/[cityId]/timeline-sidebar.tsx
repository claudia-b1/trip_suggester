"use client";

import { CATEGORY_STYLES, type Category } from "@/lib/categories";
import type { DayPlanDTO } from "./daily-plan";

const SLOT_ORDER = { MORNING: 0, AFTERNOON: 1, EVENING: 2 } as const;
const SLOT_LABELS = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" } as const;
const SLOT_ICONS = { MORNING: "🌅", AFTERNOON: "☀️", EVENING: "🌙" } as const;

function formatDay(iso: string, idx: number) {
  const d = new Date(iso);
  return `Day ${idx + 1} · ${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
}

export function TimelineSidebar({ dayPlans }: { dayPlans: DayPlanDTO[] }) {
  // Only show days that have at least one activity
  const activeDays = dayPlans
    .map((dp, idx) => ({ ...dp, dayIndex: idx }))
    .filter((dp) => dp.activities.length > 0);

  if (activeDays.length === 0) return null;

  return (
    <div className="sticky top-4 space-y-4">
      <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Timeline</h3>
      <div className="relative space-y-0">
        {/* Vertical timeline line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-[hsl(var(--border))]" />

        {activeDays.map((dp) => {
          // Group activities by slot, sorted chronologically
          const slotGroups = (["MORNING", "AFTERNOON", "EVENING"] as const)
            .map((slot) => ({
              slot,
              activities: dp.activities
                .filter((a) => a.timeSlot === slot),
            }))
            .filter((g) => g.activities.length > 0);

          return (
            <div key={dp.id} className="relative pl-6 pb-4">
              {/* Day dot */}
              <div className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2 border-[hsl(var(--primary))] bg-[hsl(var(--background))]" />

              <div className="space-y-2">
                <p className="text-xs font-semibold text-[hsl(var(--foreground))]">
                  {formatDay(dp.date, dp.dayIndex)}
                </p>

                {slotGroups.map(({ slot, activities }) => (
                  <div key={slot} className="space-y-1">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      {SLOT_ICONS[slot]} {SLOT_LABELS[slot]}
                    </p>
                    <ul className="space-y-0.5">
                      {activities.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: CATEGORY_STYLES[a.poiCategory].dot }}
                          />
                          <span className="truncate text-[hsl(var(--foreground))]">{a.poiName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
