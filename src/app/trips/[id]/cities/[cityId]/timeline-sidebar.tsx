"use client";

import { useEffect, useState } from "react";
import { CATEGORY_STYLES, type Category } from "@/lib/categories";
import type { TimeSlot } from "@/lib/slots";
import type { DayPlanDTO } from "./daily-plan";

const SLOT_ORDER = { MORNING: 0, AFTERNOON: 1, EVENING: 2 } as const;
const SLOT_LABELS = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening" } as const;
const SLOT_ICONS = { MORNING: "🌅", AFTERNOON: "☀️", EVENING: "🌙" } as const;
const NIGHT_ICON = "🌜";
const ALL_SLOTS: TimeSlot[] = ["MORNING", "AFTERNOON", "EVENING"];

function formatDay(iso: string, idx: number) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })} (Dag ${idx + 1})`;
}

type SubcityDayPlanForTimeline = {
  cityName: string;
  date: string;
  activities: { poiName: string; poiCategory: string; timeSlot: string }[];
};

export function TimelineSidebar({
  dayPlans,
  onActivityClick,
  onDayDoubleClick,
  onDropPoi,
  subcityDayPlans,
  favouritedPoiIds,
  compact,
}: {
  dayPlans: DayPlanDTO[];
  onActivityClick?: (dayDate: string, activityId: number) => void;
  onDayDoubleClick?: (dayDate: string) => void;
  onDropPoi?: (dayPlanId: number, timeSlot: TimeSlot, poiId: number) => void;
  subcityDayPlans?: SubcityDayPlanForTimeline[];
  favouritedPoiIds?: Set<number>;
  /** Compact mode: skip view-mode toggle, always show all days, tighter spacing */
  compact?: boolean;
}) {
  // Track which slot is being dragged over for visual feedback
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  // Track whether any POI drag is in progress (to show all day slots)
  const [poiDragDetected, setPoiDragDetected] = useState(false);

  useEffect(() => {
    if (!onDropPoi) return;
    function handleDragOver(e: DragEvent) {
      if (e.dataTransfer?.types.includes("application/x-poi-id")) {
        setPoiDragDetected(true);
      }
    }
    function handleEnd() { setPoiDragDetected(false); }
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragend", handleEnd);
    document.addEventListener("drop", handleEnd);
    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("dragend", handleEnd);
      document.removeEventListener("drop", handleEnd);
    };
  }, [onDropPoi]);
  // Drag-and-drop handlers for POI drops
  function handleSlotDragOver(e: React.DragEvent, key: string) {
    if (!e.dataTransfer.types.includes("application/x-poi-id")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverSlot(key);
  }

  function handleSlotDragLeave(e: React.DragEvent) {
    // Only clear when truly leaving the slot (not entering a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverSlot(null);
  }

  function handleSlotDrop(e: React.DragEvent, dayPlanId: number, slot: TimeSlot) {
    e.preventDefault();
    setDragOverSlot(null);
    const rawId = e.dataTransfer.getData("application/x-poi-id");
    const poiId = Number(rawId);
    if (!poiId || !onDropPoi) return;
    onDropPoi(dayPlanId, slot, poiId);
  }

  // Collapsible state
  const [timelineOpen, setTimelineOpen] = useState(true);
  // View mode: "active" = only days with activities (default), "all" = all days, "today" = from today onward
  // In compact mode, always show all days
  const [viewMode, setViewMode] = useState<"active" | "all" | "today">(compact ? "all" : "active");

  // When dragging a POI, show all days (as drop targets); otherwise filter by view mode
  const isDragging = poiDragDetected || dragOverSlot !== null;
  const allDays = dayPlans.map((dp, idx) => ({ ...dp, dayIndex: idx }));

  const todayStr = new Date().toISOString().slice(0, 10);
  const visibleDays = isDragging
    ? allDays
    : viewMode === "all"
      ? allDays
      : viewMode === "today"
        ? allDays.filter((dp) => dp.date.slice(0, 10) >= todayStr)
        : allDays.filter((dp) => dp.activities.length > 0);

  if (visibleDays.length === 0 && viewMode === "active") return null;

  return (
    <div className="sticky top-20 space-y-3">
      {/* Header row with title + hide toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">📋 Timeline</h3>
        <button
          type="button"
          onClick={() => setTimelineOpen((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-3 w-3 transition-transform ${timelineOpen ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          {timelineOpen ? "Hide" : "Show"}
        </button>
      </div>

      {timelineOpen && <>
      {/* View mode toggle — hidden in compact mode */}
      {!compact && (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setViewMode("all")}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
            viewMode === "all"
              ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] font-medium"
              : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          }`}
          title="Show all days in the destination"
        >
          Start plan
        </button>
        <button
          type="button"
          onClick={() => setViewMode("today")}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
            viewMode === "today"
              ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] font-medium"
              : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          }`}
          title="Show from today onward"
        >
          First next day
        </button>
        {viewMode !== "active" && (
          <button
            type="button"
            onClick={() => setViewMode("active")}
            className="text-[10px] px-1 py-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
            title="Show only days with activities"
          >
            ✕
          </button>
        )}
      </div>
      )}

      {visibleDays.length === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))] italic pl-6">
          {viewMode === "today" ? "No remaining days from today" : "No days to show"}
        </p>
      ) : (
      <div className="relative space-y-0">
        {/* Vertical timeline line */}
        <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-[hsl(var(--primary))]/30 to-[hsl(var(--border))]" />

        {visibleDays.map((dp) => {
          // Group activities by slot, sorted chronologically
          const slotGroups = (["MORNING", "AFTERNOON", "EVENING"] as const)
            .map((slot) => ({
              slot,
              activities: dp.activities
                .filter((a) => a.timeSlot === slot),
            }));

          // Which slot groups have non-accommodation activities
          const activeSlotGroups = slotGroups.filter(
            (g) => g.activities.filter((a) => a.poiCategory !== "ACCOMMODATION").length > 0,
          );

          // Separate accommodation activities from regular ones
          const accommodationActivities = dp.activities.filter((a) => a.poiCategory === "ACCOMMODATION");
          const regularCount = dp.activities.length - accommodationActivities.length;

          return (
            <div key={dp.id} className="relative pl-6 pb-4">
              {/* Day dot */}
              <div className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2 border-[hsl(var(--primary))] bg-[hsl(var(--background))] shadow-sm" />

              <div className="space-y-2">
                <div
                  className={`flex items-center justify-between ${onDayDoubleClick ? "cursor-pointer hover:bg-[hsl(var(--muted))]/50 rounded-md px-1 -mx-1 transition-colors" : ""}`}
                  onClick={() => onDayDoubleClick?.(dp.date)}
                  title={onDayDoubleClick ? "Click to jump to this day" : undefined}
                >
                  <p className="text-xs font-semibold text-[hsl(var(--foreground))]">
                    {formatDay(dp.date, dp.dayIndex)}
                  </p>
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-full px-1.5 py-0.5">
                    {regularCount} place{regularCount !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Render active slots with activities, plus drop zones for all slots when dragging */}
                {(onDropPoi && isDragging ? ALL_SLOTS : activeSlotGroups.map((g) => g.slot)).map((slot) => {
                  const slotKey = `${dp.id}-${slot}`;
                  const isOver = dragOverSlot === slotKey;
                  const activities = dp.activities.filter((a) => a.timeSlot === slot);
                  const nonAccom = activities.filter((a) => a.poiCategory !== "ACCOMMODATION");

                  return (
                    <div
                      key={slot}
                      className={`space-y-1 rounded-md px-1 py-0.5 transition-all ${
                        isOver
                          ? "bg-blue-100/60 ring-1 ring-blue-300 dark:bg-blue-900/30 dark:ring-blue-600"
                          : ""
                      }`}
                      onDragOver={(e) => handleSlotDragOver(e, slotKey)}
                      onDragLeave={handleSlotDragLeave}
                      onDrop={(e) => handleSlotDrop(e, dp.id, slot)}
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        {SLOT_ICONS[slot]} {SLOT_LABELS[slot]}
                      </p>
                      {nonAccom.length > 0 ? (
                        <ul className="space-y-0.5">
                          {nonAccom.map((a) => (
                            <li
                              key={a.id}
                              onClick={() => onActivityClick?.(dp.date, a.id)}
                              className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-[hsl(var(--muted))] ${
                                onActivityClick ? "cursor-pointer" : "cursor-default"
                              }`}
                            >
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: CATEGORY_STYLES[a.poiCategory].dot }}
                              />
                              <span className="truncate text-[hsl(var(--foreground))]">{a.poiName}</span>
                              {favouritedPoiIds?.has(a.poiId) && (
                                <span className="shrink-0 text-pink-500 text-[10px]" title="Favourited">♥</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : isOver ? (
                        <div className="rounded border border-dashed border-blue-300 px-1.5 py-1 text-center text-[10px] text-blue-500">
                          Drop here
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {/* Subcity activities for this date */}
                {(() => {
                  if (!subcityDayPlans) return null;
                  const dateKey = dp.date.slice(0, 10);
                  const matching = subcityDayPlans.filter(
                    (sdp) => sdp.date.slice(0, 10) === dateKey && sdp.activities.length > 0,
                  );
                  if (matching.length === 0) return null;
                  return matching.map((sdp) => (
                    <div key={`sub-${sdp.cityName}-${sdp.date}`} className="space-y-0.5">
                      <p className="text-[10px] font-medium text-[hsl(var(--primary))]/70 truncate">
                        ↳ {sdp.cityName}
                      </p>
                      <ul className="space-y-0.5">
                        {sdp.activities.map((a, idx) => (
                          <li
                            key={idx}
                            className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-[hsl(var(--muted-foreground))]"
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--primary))]/30" />
                            <span className="truncate">{a.poiName}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ));
                })()}

                {/* Accommodation as "Night" section */}
                {accommodationActivities.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-indigo-400">
                      {NIGHT_ICON} Night
                    </p>
                    <ul className="space-y-0.5">
                      {accommodationActivities.map((a) => (
                        <li
                          key={a.id}
                          onClick={() => onActivityClick?.(dp.date, a.id)}
                          className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-colors hover:bg-[hsl(var(--muted))] ${
                            onActivityClick ? "cursor-pointer" : "cursor-default"
                          }`}
                        >
                          <span className="text-[10px]">🏠</span>
                          <span className="truncate text-indigo-400">{a.poiName}</span>
                          {favouritedPoiIds?.has(a.poiId) && (
                            <span className="shrink-0 text-pink-500 text-[10px]" title="Favourited">♥</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}
      </>}
    </div>
  );
}
