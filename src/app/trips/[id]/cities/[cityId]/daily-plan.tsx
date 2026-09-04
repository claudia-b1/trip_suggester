"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CATEGORY_STYLES, CATEGORY_LABELS, type Category } from "@/lib/categories";
import { TIME_SLOTS, type TimeSlot } from "@/lib/slots";
import type { PoiDTO } from "./pois-section";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PoiMap } from "./poi-map";
import { PoiHoverCard, type HoverPoiData } from "@/components/ui/poi-hover-card";
import { TripNoteEditor } from "@/components/ui/trip-note-editor";

export type DayActivityDTO = {
  id: number;
  poiId: number;
  poiName: string;
  poiCategory: Category;
  timeSlot: TimeSlot;
};

export type DayPlanDTO = {
  id: number;
  date: string; // ISO
  activities: DayActivityDTO[];
};

export type SubcityDayPlanDTO = {
  cityId: number;
  cityName: string;
  tripId: number;
  date: string; // ISO
  activities: { poiName: string; poiCategory: string; timeSlot: string }[];
};

const SLOT_LABELS: Record<TimeSlot, string> = {
  MORNING: "🌅 Morning",
  AFTERNOON: "☀️ Afternoon",
  EVENING: "🌙 Evening",
};

const SLOT_CSS: Record<TimeSlot, string> = {
  MORNING: "slot-morning",
  AFTERNOON: "slot-afternoon",
  EVENING: "slot-evening",
};

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatDayWithIndex(iso: string, dayIndex: number) {
  return `${formatDay(iso)} (Dag ${dayIndex + 1})`;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function CategoryBadge({ category }: { category: Category }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[category].badge}`}
    >
      {CATEGORY_LABELS[category]}
    </span>
  );
}

// ─── Mini Calendar ────────────────────────────────────────────────────────────

function MiniCalendar({
  dayPlans,
  selectedDate,
  onSelect,
}: {
  dayPlans: DayPlanDTO[];
  selectedDate: string;
  onSelect: (iso: string) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const sel = new Date(selectedDate);
    return new Date(sel.getFullYear(), sel.getMonth(), 1);
  });

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = new Date(year, month, 1).getDay();

  const tripDates = useMemo(() => {
    const set = new Set<string>();
    for (const dp of dayPlans) {
      const d = new Date(dp.date);
      set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    return set;
  }, [dayPlans]);

  const activityInfo = useMemo(() => {
    const map = new Map<string, { pois: number; accommodation: number }>();
    for (const dp of dayPlans) {
      const d = new Date(dp.date);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const poiCount = dp.activities.filter((a) => a.poiCategory !== "ACCOMMODATION").length;
      const accomCount = dp.activities.filter((a) => a.poiCategory === "ACCOMMODATION").length;
      map.set(key, { pois: poiCount, accommodation: accomCount });
    }
    return map;
  }, [dayPlans]);

  const selectedD = new Date(selectedDate);
  const selectedKey = `${selectedD.getFullYear()}-${selectedD.getMonth()}-${selectedD.getDate()}`;

  const prevMonth = () => setViewMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setViewMonth(new Date(year, month + 1, 1));
  const monthLabel = viewMonth.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="w-full select-none">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={prevMonth} className="p-1 hover:bg-[hsl(var(--muted))] rounded text-sm">‹</button>
        <span className="text-sm font-medium">{monthLabel}</span>
        <button type="button" onClick={nextMonth} className="p-1 hover:bg-[hsl(var(--muted))] rounded text-sm">›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {["zo", "ma", "di", "wo", "do", "vr", "za"].map((d) => (
          <div key={d} className="py-1 text-[hsl(var(--muted-foreground))] font-medium">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day == null) return <div key={`e-${i}`} />;
          const key = `${year}-${month}-${day}`;
          const isTripDay = tripDates.has(key);
          const isSelected = key === selectedKey;
          const info = activityInfo.get(key);
          const hasPois = (info?.pois ?? 0) > 0;
          const hasAccom = (info?.accommodation ?? 0) > 0;

          const matchingPlan = isTripDay
            ? dayPlans.find((dp) => {
                const d = new Date(dp.date);
                return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
              })
            : null;

          return (
            <button
              key={key}
              type="button"
              disabled={!isTripDay}
              onClick={() => matchingPlan && onSelect(matchingPlan.date)}
              className={`relative rounded py-1 text-xs transition-colors ${
                isSelected
                  ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-bold"
                  : isTripDay
                    ? "hover:bg-[hsl(var(--muted))] font-medium cursor-pointer"
                    : "text-[hsl(var(--muted-foreground))] opacity-40 cursor-default"
              }`}
            >
              {day}
              {isTripDay && !isSelected && (hasPois || hasAccom) && (
                <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                  {hasPois && <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />}
                  {hasAccom && <span className="text-[8px] leading-none">🏠</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Multi-day Accommodation Assigner ────────────────────────────────────────

function MultiDayAccommodation({
  poi,
  dayPlans,
  busy,
  onAssigned,
}: {
  poi: PoiDTO;
  dayPlans: DayPlanDTO[];
  busy: boolean;
  onAssigned: () => void;
}) {
  const { toast } = useToast();
  const [selectedDays, setSelectedDays] = useState<Set<number>>(() => new Set());
  const [assigning, setAssigning] = useState(false);

  // Days where this POI is already assigned
  const alreadyAssigned = new Set(
    dayPlans.filter((dp) => dp.activities.some((a) => a.poiId === poi.id)).map((dp) => dp.id),
  );

  function toggleDay(id: number) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedDays(new Set(dayPlans.filter((dp) => !alreadyAssigned.has(dp.id)).map((dp) => dp.id)));
  }

  async function handleAssign() {
    if (selectedDays.size === 0) return;
    setAssigning(true);
    try {
      const res = await fetch("/api/day-plans/batch-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poiId: poi.id,
          dayPlanIds: [...selectedDays],
          timeSlot: "EVENING",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast(`Assigned to ${data.created} day${data.created !== 1 ? "s" : ""}`);
        onAssigned();
      } else {
        toast("Failed to assign", { variant: "error" });
      }
    } finally {
      setAssigning(false);
    }
  }

  const unassignedDays = dayPlans.filter((dp) => !alreadyAssigned.has(dp.id));

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 dark:border-indigo-800 dark:bg-indigo-950/20 p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
          🏠 Assign to multiple days
        </span>
        {unassignedDays.length > 0 && (
          <button
            type="button"
            onClick={selectAll}
            className="text-[10px] text-indigo-500 hover:text-indigo-700"
          >
            Select all
          </button>
        )}
      </div>
      <div className="max-h-[200px] overflow-y-auto space-y-0.5">
        {dayPlans.map((dp, idx) => {
          const isAssigned = alreadyAssigned.has(dp.id);
          const isChecked = selectedDays.has(dp.id);
          return (
            <label
              key={dp.id}
              className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-colors ${
                isAssigned
                  ? "text-[hsl(var(--muted-foreground))] opacity-50"
                  : "text-[hsl(var(--foreground))] hover:bg-indigo-100/50 dark:hover:bg-indigo-900/20 cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={isAssigned || isChecked}
                disabled={isAssigned || busy || assigning}
                onChange={() => toggleDay(dp.id)}
                className="rounded border-indigo-300"
              />
              <span className={isAssigned ? "line-through" : ""}>
                {formatDayWithIndex(dp.date, idx)}
              </span>
              {isAssigned && <span className="text-[9px] text-indigo-400 ml-auto">assigned</span>}
            </label>
          );
        })}
      </div>
      {selectedDays.size > 0 && (
        <button
          type="button"
          onClick={handleAssign}
          disabled={assigning || busy}
          className="w-full rounded-md bg-indigo-500 px-2 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors"
        >
          {assigning
            ? "Assigning..."
            : `Assign to ${selectedDays.size} day${selectedDays.size !== 1 ? "s" : ""}`}
        </button>
      )}
    </div>
  );
}

// ─── Day Map Modal ────────────────────────────────────────────────────────────

const SLOT_ORDER: Record<TimeSlot, number> = { MORNING: 0, AFTERNOON: 1, EVENING: 2 };

type AccommodationLoc = { name: string; latitude: number; longitude: number } | null;

function DayMapModal({
  pois,
  activities,
  dayLabel,
  onClose,
  startAccom,
  endAccom,
}: {
  pois: { id: number; name: string; category: Category; description: string | null; latitude: number | null; longitude: number | null; photoUrl?: string | null }[];
  activities: DayActivityDTO[];
  dayLabel: string;
  onClose: () => void;
  /** Accommodation from the night before (where you wake up) */
  startAccom: AccommodationLoc;
  /** Accommodation for the current night (where you sleep) */
  endAccom: AccommodationLoc;
}) {
  // Order non-accommodation POIs by time slot
  const orderedPois = useMemo(() =>
    TIME_SLOTS.flatMap((slot) =>
      activities.filter((a) => a.timeSlot === slot && a.poiCategory !== "ACCOMMODATION"),
    )
      .map((act) => pois.find((p) => p.id === act.poiId))
      .filter((p): p is NonNullable<typeof p> => p != null && p.latitude != null && p.longitude != null),
    [activities, pois],
  );

  const openGoogleMapsRoute = useCallback(() => {
    if (orderedPois.length === 0) return;

    // Route through POIs only — accommodation is NOT included in the route
    const origin = orderedPois[0];
    const destination = orderedPois[orderedPois.length - 1];
    const waypoints = orderedPois.slice(1, -1);

    let url = `https://www.google.com/maps/dir/?api=1&travelmode=walking`;
    url += `&origin=${origin.latitude},${origin.longitude}`;
    url += `&destination=${destination.latitude},${destination.longitude}`;
    if (waypoints.length > 0) {
      url += `&waypoints=${waypoints.map((p) => `${p.latitude},${p.longitude}`).join("|")}`;
    }
    window.open(url, "_blank", "noopener");
  }, [orderedPois]);

  const openRoundTrip = useCallback(() => {
    // Round trip: accommodation → best route through POIs → accommodation
    const accom = startAccom ?? endAccom;
    if (!accom || orderedPois.length === 0) return;

    let url = `https://www.google.com/maps/dir/?api=1&travelmode=walking`;
    url += `&origin=${accom.latitude},${accom.longitude}`;
    url += `&destination=${accom.latitude},${accom.longitude}`;
    url += `&waypoints=${orderedPois.map((p) => `${p.latitude},${p.longitude}`).join("|")}`;
    window.open(url, "_blank", "noopener");
  }, [orderedPois, startAccom, endAccom]);

  const hasLocatedPois = orderedPois.length >= 2;
  const hasAccom = startAccom != null || endAccom != null;

  // Compute numbered labels for POIs based on activity order (slot order, then position within slot)
  const poiNumbers = useMemo(() => {
    const nums: Record<number, number> = {};
    let n = 1;
    for (const slot of TIME_SLOTS) {
      for (const act of activities.filter((a) => a.timeSlot === slot)) {
        if (act.poiCategory !== "ACCOMMODATION" && !(act.poiId in nums)) {
          nums[act.poiId] = n++;
        }
      }
    }
    return nums;
  }, [activities]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-[90vw] max-w-3xl rounded-lg bg-[hsl(var(--background))] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
          <h3 className="text-sm font-semibold">{dayLabel} — Assigned POIs</h3>
          <div className="flex items-center gap-2">
            {hasLocatedPois && (
              <>
                <button
                  type="button"
                  onClick={openGoogleMapsRoute}
                  className="rounded-md border border-[hsl(var(--border))] bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
                  title="Walking route through POIs in order"
                >
                  🚶 Walking route
                </button>
                {hasAccom && (
                  <button
                    type="button"
                    onClick={openRoundTrip}
                    className="rounded-md border border-[hsl(var(--border))] bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
                    title={`Round trip from ${(startAccom ?? endAccom)!.name}`}
                  >
                    🏠 Round trip
                  </button>
                )}
              </>
            )}
            <button type="button" onClick={onClose} className="rounded p-1 hover:bg-[hsl(var(--muted))] text-lg leading-none">×</button>
          </div>
        </div>
        <div className="p-4">
          <PoiMap pois={pois} poiNumbers={poiNumbers} />
        </div>
      </div>
    </div>
  );
}

export function DailyPlan({
  cityId,
  pois,
  dayPlans,
  setDayPlans,
  scrollToActivity,
  onScrollComplete,
  dayNotes,
  subcityDayPlans,
  favouritedPoiIds,
  hideSidebar,
}: {
  cityId: number;
  pois: PoiDTO[];
  dayPlans: DayPlanDTO[];
  setDayPlans: React.Dispatch<React.SetStateAction<DayPlanDTO[]>>;
  scrollToActivity?: { date: string; activityId: number } | null;
  onScrollComplete?: () => void;
  dayNotes?: Record<number, { id: number; content: string }>;
  subcityDayPlans?: SubcityDayPlanDTO[];
  favouritedPoiIds?: Set<number>;
  hideSidebar?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [selectedPoiId, setSelectedPoiId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoPlanning, setAutoPlanning] = useState(false);
  const [autoPlanOpen, setAutoPlanOpen] = useState(false);
  const [autoPlanMode, setAutoPlanMode] = useState<"all" | "selected">("all");
  const [selectedDayIds, setSelectedDayIds] = useState<Set<number>>(() => new Set());
  const [catFilter, setCatFilter] = useState<Category | null>(null);
  const [mapDayPlan, setMapDayPlan] = useState<DayPlanDTO | null>(null);
  const [dragActivity, setDragActivity] = useState<{ activityId: number; fromDayPlanId: number; fromSlot: TimeSlot } | null>(null);
  const [poiDragActive, setPoiDragActive] = useState(false);
  const [poiDragOverSlot, setPoiDragOverSlot] = useState<string | null>(null);

  // Detect POI drags (from POI list/grid) to show drop targets
  useEffect(() => {
    function onDragOver(e: DragEvent) {
      if (e.dataTransfer?.types.includes("application/x-poi-id")) {
        setPoiDragActive(true);
      }
    }
    function onEnd() { setPoiDragActive(false); setPoiDragOverSlot(null); }
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragend", onEnd);
    document.addEventListener("drop", onEnd);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragend", onEnd);
      document.removeEventListener("drop", onEnd);
    };
  }, []);

  // Move day plan state
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveTargetDayPlanId, setMoveTargetDayPlanId] = useState<number | null>(null);
  const [moveMode, setMoveMode] = useState<"replace" | "merge">("replace");

  // Cross-slot rearrangement suggestion shown after route optimisation
  type CrossSlotSuggestion = {
    activityId: number;
    poiName: string;
    fromSlot: TimeSlot;
    toSlot: TimeSlot;
  };
  const [crossSlotSuggestion, setCrossSlotSuggestion] = useState<CrossSlotSuggestion | null>(null);

  // Calendar: default selected date
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    if (dayPlans.length === 0) return new Date().toISOString();
    const now = new Date();
    const firstDay = new Date(dayPlans[0].date);
    if (firstDay > now) return dayPlans[0].date;
    const todayPlan = dayPlans.find((dp) => isSameDay(new Date(dp.date), now));
    if (todayPlan) return todayPlan.date;
    return dayPlans[0].date;
  });

  const currentDayPlan = dayPlans.find((dp) => dp.date === selectedDate) ?? dayPlans[0] ?? null;
  const currentDayIndex = dayPlans.findIndex((dp) => dp.date === selectedDate);

  // Handle scroll-to-activity from timeline sidebar
  useEffect(() => {
    if (!scrollToActivity) return;
    setSelectedDate(scrollToActivity.date);
    // Wait for DOM to update, then scroll & highlight
    requestAnimationFrame(() => {
      if (scrollToActivity.activityId > 0) {
        const el = document.querySelector(`[data-activity-id="${scrollToActivity.activityId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-2", "ring-[hsl(var(--primary))]");
          setTimeout(() => el.classList.remove("ring-2", "ring-[hsl(var(--primary))]"), 1500);
        }
      } else {
        // Just navigate to the day — scroll the plan view into view
        const planEl = document.getElementById("daily-plan-day-view");
        if (planEl) planEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      onScrollComplete?.();
    });
  }, [scrollToActivity, onScrollComplete]);

  const assignedIds = new Set(
    dayPlans.flatMap((dp) => dp.activities.map((a) => a.poiId)),
  );
  const unassigned = pois.filter((p) => !assignedIds.has(p.id));
  const presentCategories = Array.from(new Set(unassigned.map((p) => p.category))).sort();
  const filteredUnassigned = catFilter
    ? unassigned.filter((p) => p.category === catFilter)
    : unassigned;
  const selectedPoi = pois.find((p) => p.id === selectedPoiId) ?? null;

  async function assign(dayPlanId: number, timeSlot: TimeSlot) {
    if (!selectedPoi || busy) return;
    setBusy(true);
    const res = await fetch(`/api/day-plans/${dayPlanId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ poiId: selectedPoi.id, timeSlot }),
    });
    setBusy(false);
    if (!res.ok) {
      toast("Failed to assign POI", { variant: "error" });
      return;
    }
    // Optimistic update
    const created = await res.json().catch(() => null);
    const newActivity: DayActivityDTO = {
      id: created?.id ?? Date.now(),
      poiId: selectedPoi.id,
      poiName: selectedPoi.name,
      poiCategory: selectedPoi.category,
      timeSlot,
    };
    setDayPlans((prev) =>
      prev.map((dp) =>
        dp.id === dayPlanId ? { ...dp, activities: [...dp.activities, newActivity] } : dp,
      ),
    );
    setSelectedPoiId(null);
    router.refresh();
  }

  async function moveActivity(activityId: number, toDayPlanId: number, toSlot: TimeSlot, targetIndex?: number) {
    setBusy(true);
    // Optimistic update
    setDayPlans((prev) => {
      let activity: DayActivityDTO | undefined;
      const without = prev.map((dp) => {
        const found = dp.activities.find((a) => a.id === activityId);
        if (found) activity = found;
        return { ...dp, activities: dp.activities.filter((a) => a.id !== activityId) };
      });
      if (!activity) return prev;
      return without.map((dp) => {
        if (dp.id !== toDayPlanId) return dp;
        const movedActivity = { ...activity!, timeSlot: toSlot };
        if (targetIndex != null) {
          const slotItems = dp.activities.filter((a) => a.timeSlot === toSlot);
          const others = dp.activities.filter((a) => a.timeSlot !== toSlot);
          slotItems.splice(targetIndex, 0, movedActivity);
          return { ...dp, activities: [...others, ...slotItems] };
        }
        return { ...dp, activities: [...dp.activities, movedActivity] };
      });
    });
    const res = await fetch(`/api/day-activities/${activityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dayPlanId: toDayPlanId, timeSlot: toSlot, order: targetIndex }),
    });
    setBusy(false);
    if (!res.ok) {
      toast("Failed to move activity", { variant: "error" });
    }
    router.refresh();
  }

  async function autoPlan() {
    const targetIds = autoPlanMode === "selected" ? Array.from(selectedDayIds) : null;
    if (autoPlanMode === "selected" && (!targetIds || targetIds.length === 0)) return;

    const hasExisting = dayPlans
      .filter((dp) => !targetIds || targetIds.includes(dp.id))
      .some((dp) => dp.activities.length > 0);
    if (hasExisting) {
      const ok = await confirm({
        title: "Overwrite plan?",
        message: autoPlanMode === "all"
          ? "Auto-plan will replace the current assignments for all days."
          : `Auto-plan will replace the assignments for ${targetIds!.length} selected day(s).`,
        confirmText: "Overwrite",
        variant: "destructive",
      });
      if (!ok) return;
    }
    setAutoPlanning(true);
    const res = await fetch(`/api/cities/${cityId}/auto-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targetIds ? { dayPlanIds: targetIds } : {}),
    });
    setAutoPlanning(false);
    if (!res.ok) {
      const body: { error?: string } = await res.json().catch(() => ({}));
      toast(body.error ?? "Failed to auto-plan", { variant: "error" });
      return;
    }
    setSelectedPoiId(null);
    setAutoPlanOpen(false);
    toast("Plan generated.");
    router.refresh();
  }

  async function remove(activityId: number) {
    if (busy) return;
    setBusy(true);
    // Optimistic update
    setDayPlans((prev) =>
      prev.map((dp) => ({ ...dp, activities: dp.activities.filter((a) => a.id !== activityId) })),
    );
    const res = await fetch(`/api/day-activities/${activityId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast("Failed to remove activity", { variant: "error" });
    }
    router.refresh();
  }

  async function clearDay(dayPlanId: number) {
    if (busy) return;
    const ok = await confirm({
      title: "Clear day?",
      message: "This will remove all activities for this day.",
      confirmText: "Clear",
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    // Optimistic update
    setDayPlans((prev) =>
      prev.map((dp) => (dp.id === dayPlanId ? { ...dp, activities: [] } : dp)),
    );
    const res = await fetch(`/api/day-plans/${dayPlanId}/activities`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast("Failed to clear day", { variant: "error" });
    } else {
      toast("Day cleared.");
    }
    router.refresh();
  }

  async function moveDayTo() {
    if (!currentDayPlan || !moveTargetDayPlanId || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/day-plans/${currentDayPlan.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDayPlanId: moveTargetDayPlanId, mode: moveMode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to move");
      }
      const { moved } = await res.json();
      const targetIndex = dayPlans.findIndex((dp) => dp.id === moveTargetDayPlanId);
      toast(`Moved ${moved} activities to Dag ${targetIndex + 1}`);
      setMoveModalOpen(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to move", { variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    if (busy) return;
    const ok = await confirm({
      title: "Clear entire plan?",
      message: "This will remove all activities for every day.",
      confirmText: "Clear all",
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    // Optimistic update
    setDayPlans((prev) => prev.map((dp) => ({ ...dp, activities: [] })));
    const results = await Promise.all(
      dayPlans.map((dp) =>
        fetch(`/api/day-plans/${dp.id}/activities`, { method: "DELETE" }),
      ),
    );
    setBusy(false);
    if (results.some((r) => !r.ok)) {
      toast("Some days failed to clear", { variant: "error" });
    } else {
      toast("Plan cleared.");
    }
    router.refresh();
  }

  const totalActivities = dayPlans.reduce((s, dp) => s + dp.activities.length, 0);

  // Lookup map for hover cards
  const poiLookup = useMemo(() => {
    const map = new Map<number, HoverPoiData>();
    for (const p of pois) {
      map.set(p.id, {
        name: p.name,
        category: p.category,
        description: p.description,
        photoUrl: p.photoUrl ? `/api/pois/${p.id}/photo` : null,
        rating: p.rating,
        estimatedDurationMinutes: p.estimatedDurationMinutes,
      });
    }
    return map;
  }, [pois]);

  // Drag & Drop handlers
  function handleDragStart(e: React.DragEvent, activityId: number, dayPlanId: number, slot: TimeSlot) {
    setDragActivity({ activityId, fromDayPlanId: dayPlanId, fromSlot: slot });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-activity-id", String(activityId));
  }

  function handleDragOver(e: React.DragEvent) {
    const isPoi = e.dataTransfer.types.includes("application/x-poi-id");
    const isActivity = e.dataTransfer.types.includes("application/x-activity-id");
    if (!isPoi && !isActivity) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isPoi ? "copy" : "move";
  }

  function handleDropOnItem(e: React.DragEvent, toDayPlanId: number, toSlot: TimeSlot, targetIndex: number) {
    e.preventDefault();
    e.stopPropagation();
    // POI drop from list/grid
    if (e.dataTransfer.types.includes("application/x-poi-id")) {
      handlePoiDrop(e, toDayPlanId, toSlot);
      return;
    }
    const rawId = e.dataTransfer.getData("application/x-activity-id");
    const activityId = Number(rawId);
    if (!activityId) return;
    const from = dragActivity;
    setDragActivity(null);

    if (from && from.fromDayPlanId === toDayPlanId && from.fromSlot === toSlot) {
      // Same slot — reorder
      reorderInSlot(toDayPlanId, toSlot, activityId, targetIndex);
    } else {
      // Different slot/day — move then insert at position
      moveActivity(activityId, toDayPlanId, toSlot, targetIndex);
    }
  }

  function handleDrop(e: React.DragEvent, toDayPlanId: number, toSlot: TimeSlot) {
    e.preventDefault();
    // POI drop from list/grid
    if (e.dataTransfer.types.includes("application/x-poi-id")) {
      handlePoiDrop(e, toDayPlanId, toSlot);
      return;
    }
    const rawId = e.dataTransfer.getData("application/x-activity-id");
    const activityId = Number(rawId);
    if (!activityId) return;
    const from = dragActivity;
    setDragActivity(null);
    if (from && from.fromDayPlanId === toDayPlanId && from.fromSlot === toSlot) {
      // Same slot — dropped on the slot container (not on a specific item), move to end
      const dp = dayPlans.find((d) => d.id === toDayPlanId);
      const slotItems = dp?.activities.filter((a) => a.timeSlot === toSlot) ?? [];
      reorderInSlot(toDayPlanId, toSlot, activityId, slotItems.length - 1);
      return;
    }
    moveActivity(activityId, toDayPlanId, toSlot);
  }

  function handleDragEnd() {
    setDragActivity(null);
  }

  // Handle POI dropped from POI list/grid onto a day plan slot
  async function handlePoiDrop(e: React.DragEvent, dayPlanId: number, slot: TimeSlot) {
    e.preventDefault();
    e.stopPropagation();
    setPoiDragOverSlot(null);
    const rawId = e.dataTransfer.getData("application/x-poi-id");
    const poiId = Number(rawId);
    if (!poiId) return;

    const poi = pois.find((p) => p.id === poiId);
    if (!poi) return;

    // Check if already assigned to this day+slot
    const dp = dayPlans.find((d) => d.id === dayPlanId);
    if (dp?.activities.some((a) => a.poiId === poiId && a.timeSlot === slot)) {
      toast("Already assigned to this slot", { variant: "error" });
      return;
    }

    // Optimistic update
    const tempId = Date.now();
    setDayPlans((prev) =>
      prev.map((d) =>
        d.id === dayPlanId
          ? {
              ...d,
              activities: [
                ...d.activities,
                { id: tempId, poiId: poi.id, poiName: poi.name, poiCategory: poi.category, timeSlot: slot },
              ],
            }
          : d,
      ),
    );

    const res = await fetch(`/api/day-plans/${dayPlanId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ poiId, timeSlot: slot }),
    });

    if (!res.ok) {
      toast("Failed to assign POI", { variant: "error" });
      setDayPlans((prev) =>
        prev.map((d) =>
          d.id === dayPlanId
            ? { ...d, activities: d.activities.filter((a) => a.id !== tempId) }
            : d,
        ),
      );
      return;
    }

    toast(`${poi.name} added to plan!`);
    router.refresh();
  }

  async function reorderInSlot(dayPlanId: number, slot: TimeSlot, activityId: number, targetIndex: number) {
    // Optimistic update: move activity to target position within slot
    setDayPlans((prev) =>
      prev.map((dp) => {
        if (dp.id !== dayPlanId) return dp;
        const slotItems = dp.activities.filter((a) => a.timeSlot === slot);
        const others = dp.activities.filter((a) => a.timeSlot !== slot);
        const fromIndex = slotItems.findIndex((a) => a.id === activityId);
        if (fromIndex === -1 || fromIndex === targetIndex) return dp;
        const item = slotItems[fromIndex];
        const reordered = slotItems.filter((a) => a.id !== activityId);
        reordered.splice(targetIndex, 0, item);
        return { ...dp, activities: [...others, ...reordered] };
      }),
    );
    // Persist new order for all items in the slot
    const dp = dayPlans.find((d) => d.id === dayPlanId);
    if (!dp) return;
    const slotItems = dp.activities.filter((a) => a.timeSlot === slot);
    const reordered = slotItems.filter((a) => a.id !== activityId);
    reordered.splice(targetIndex, 0, slotItems.find((a) => a.id === activityId)!);
    await Promise.all(
      reordered.map((a, i) =>
        fetch(`/api/day-activities/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: i }),
        }),
      ),
    );
    router.refresh();
  }

  /** Nearest-neighbour heuristic fallback (used when Mapbox API is unavailable or >12 POIs).
   *  If `startCoord` is provided (e.g. accommodation), the first POI chosen is the one nearest to it. */
  function nearestNeighbourSort(
    activities: DayActivityDTO[],
    startCoord?: { lat: number; lng: number },
  ): DayActivityDTO[] {
    type CoordItem = { activity: DayActivityDTO; lat: number; lng: number };
    const items: CoordItem[] = activities.map((a) => {
      const poi = pois.find((p) => p.id === a.poiId);
      return { activity: a, lat: poi?.latitude ?? 0, lng: poi?.longitude ?? 0 };
    });
    const ordered: CoordItem[] = [];
    const remaining = [...items];

    if (startCoord && remaining.length > 0) {
      // Pick the POI nearest to the starting coordinate (e.g. accommodation)
      let nearest = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const dist = (remaining[i].lat - startCoord.lat) ** 2 + (remaining[i].lng - startCoord.lng) ** 2;
        if (dist < nearestDist) { nearestDist = dist; nearest = i; }
      }
      const first = remaining.splice(nearest, 1)[0];
      ordered.push(first);
    } else if (remaining.length > 0) {
      ordered.push(remaining.shift()!);
    }

    let current = ordered[ordered.length - 1];
    while (remaining.length > 0) {
      let nearest = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const dist = (remaining[i].lat - current.lat) ** 2 + (remaining[i].lng - current.lng) ** 2;
        if (dist < nearestDist) { nearestDist = dist; nearest = i; }
      }
      current = remaining.splice(nearest, 1)[0];
      ordered.push(current);
    }
    return ordered.map((o) => o.activity);
  }

  /** Compute Euclidean centroid of a set of activities (lat/lon average). */
  function centroid(activities: DayActivityDTO[]): { lat: number; lon: number } | null {
    const coords = activities
      .map((a) => pois.find((p) => p.id === a.poiId))
      .filter((p): p is PoiDTO => p != null && p.latitude != null && p.longitude != null);
    if (coords.length === 0) return null;
    return {
      lat: coords.reduce((s, p) => s + p.latitude!, 0) / coords.length,
      lon: coords.reduce((s, p) => s + p.longitude!, 0) / coords.length,
    };
  }

  /** After optimising each slot, detect the single best cross-slot move (if any). */
  function detectCrossSlotSuggestion(
    activitiesBySlot: Record<TimeSlot, DayActivityDTO[]>,
  ): CrossSlotSuggestion | null {
    let bestGain = 0;
    let best: CrossSlotSuggestion | null = null;

    for (const fromSlot of TIME_SLOTS) {
      const fromItems = activitiesBySlot[fromSlot] ?? [];
      if (fromItems.length < 2) continue; // need ≥2 so we don't empty the slot
      const fromCentroid = centroid(fromItems);
      if (!fromCentroid) continue;

      for (const toSlot of TIME_SLOTS) {
        if (toSlot === fromSlot) continue;
        const toItems = activitiesBySlot[toSlot] ?? [];
        const toCentroid = centroid(toItems);
        if (!toCentroid) continue;

        for (const activity of fromItems) {
          const poi = pois.find((p) => p.id === activity.poiId);
          if (!poi?.latitude || !poi?.longitude) continue;

          // Distance from this POI to its current slot centroid (excluding itself)
          const otherFrom = fromItems.filter((a) => a.id !== activity.id);
          const otherFromCentroid = centroid(otherFrom);
          if (!otherFromCentroid) continue;

          const distFrom = (poi.latitude - otherFromCentroid.lat) ** 2 + (poi.longitude! - otherFromCentroid.lon) ** 2;
          const distTo = (poi.latitude - toCentroid.lat) ** 2 + (poi.longitude! - toCentroid.lon) ** 2;

          // Suggest only if moving reduces distance by >30%
          const gain = distFrom - distTo;
          if (gain > 0 && distFrom > 0 && gain / distFrom > 0.30 && gain > bestGain) {
            bestGain = gain;
            best = {
              activityId: activity.id,
              poiName: activity.poiName,
              fromSlot,
              toSlot,
            };
          }
        }
      }
    }
    return best;
  }

  /**
   * Core optimization engine. Takes an explicit activities array so it never
   * reads from the stale dayPlans closure — both optimizeRoute and
   * applyCrossSlotSuggestion call this after preparing the correct list.
   *
   * `accomStart` — accommodation where the traveller wakes up (previous night).
   * The MORNING slot's first POI will be the one nearest to it.
   * `accomEnd` — accommodation where the traveller sleeps (current night).
   * The last occupied slot's final POI will be the one nearest to it.
   */
  async function optimizeActivities(
    dayPlanId: number,
    activities: DayActivityDTO[],
    accomStart?: { lat: number; lng: number } | null,
    accomEnd?: { lat: number; lng: number } | null,
  ): Promise<void> {
    const optimized: DayActivityDTO[] = [];
    const activitiesBySlot: Record<TimeSlot, DayActivityDTO[]> = {
      MORNING: [],
      AFTERNOON: [],
      EVENING: [],
    };

    // Determine which slot is the first/last with ≥1 non-accommodation activities
    const occupiedSlots = TIME_SLOTS.filter((s) =>
      activities.some((a) => a.timeSlot === s && a.poiCategory !== "ACCOMMODATION"),
    );
    const firstSlot = occupiedSlots[0] ?? null;
    const lastSlot = occupiedSlots[occupiedSlots.length - 1] ?? null;

    for (const slot of TIME_SLOTS) {
      const slotActivities = activities.filter((a) => a.timeSlot === slot);
      if (slotActivities.length <= 1) {
        optimized.push(...slotActivities);
        activitiesBySlot[slot] = slotActivities;
        continue;
      }

      const withCoords = slotActivities.filter((a) => {
        const poi = pois.find((p) => p.id === a.poiId);
        return poi?.latitude != null && poi?.longitude != null;
      });
      const noCoords = slotActivities.filter((a) => {
        const poi = pois.find((p) => p.id === a.poiId);
        return poi?.latitude == null || poi?.longitude == null;
      });

      // Determine anchor start/end for this slot based on accommodation
      const slotAnchorStart = slot === firstSlot ? accomStart : undefined;
      const slotAnchorEnd = slot === lastSlot ? accomEnd : undefined;

      let orderedSlot = slotActivities;

      if (withCoords.length >= 2 && withCoords.length <= 12) {
        // Pre-sort: place the POI nearest to start-accommodation first,
        // and the POI nearest to end-accommodation last, before calling Mapbox
        // (which pins source=first, destination=last).
        const sorted = [...withCoords];
        if (slotAnchorStart) {
          let nearestIdx = 0;
          let nearestDist = Infinity;
          for (let i = 0; i < sorted.length; i++) {
            const poi = pois.find((p) => p.id === sorted[i].poiId)!;
            const dist = (poi.latitude! - slotAnchorStart.lat) ** 2 + (poi.longitude! - slotAnchorStart.lng) ** 2;
            if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
          }
          // Move nearest-to-accommodation to position 0
          if (nearestIdx !== 0) {
            const [item] = sorted.splice(nearestIdx, 1);
            sorted.unshift(item);
          }
        }
        if (slotAnchorEnd) {
          let nearestIdx = sorted.length - 1;
          let nearestDist = Infinity;
          // Search from index 1 (or 0 if no start anchor) to avoid displacing the start
          const searchStart = slotAnchorStart ? 1 : 0;
          for (let i = searchStart; i < sorted.length; i++) {
            const poi = pois.find((p) => p.id === sorted[i].poiId)!;
            const dist = (poi.latitude! - slotAnchorEnd.lat) ** 2 + (poi.longitude! - slotAnchorEnd.lng) ** 2;
            if (dist < nearestDist) { nearestDist = dist; nearestIdx = i; }
          }
          // Move nearest-to-end-accommodation to last position
          if (nearestIdx !== sorted.length - 1) {
            const [item] = sorted.splice(nearestIdx, 1);
            sorted.push(item);
          }
        }

        try {
          const res = await fetch(`/api/cities/${cityId}/optimize-route`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              waypoints: sorted.map((a) => {
                const poi = pois.find((p) => p.id === a.poiId)!;
                return { id: String(a.id), lat: poi.latitude, lon: poi.longitude };
              }),
            }),
          });

          if (res.ok) {
            const data = (await res.json()) as { orderedIds: string[] };
            const idToActivity = new Map(withCoords.map((a) => [String(a.id), a]));
            orderedSlot = [
              ...data.orderedIds
                .map((id) => idToActivity.get(id))
                .filter((a): a is DayActivityDTO => a != null),
              ...noCoords,
            ];
          }
        } catch {
          // Network error — fall through to heuristic
        }
      }

      // Fallback: nearest-neighbour if Mapbox didn't produce a result
      if (orderedSlot === slotActivities && withCoords.length >= 2) {
        orderedSlot = nearestNeighbourSort(slotActivities, slotAnchorStart ?? undefined);
      }

      optimized.push(...orderedSlot);
      activitiesBySlot[slot] = orderedSlot;
    }

    // Optimistic UI update
    setDayPlans((prev) =>
      prev.map((d) => (d.id === dayPlanId ? { ...d, activities: optimized } : d)),
    );

    // Persist new order
    await Promise.all(
      optimized.map((a, i) =>
        fetch(`/api/day-activities/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: i }),
        }),
      ),
    );

    // Surface cross-slot suggestion based on freshly optimised slots
    setCrossSlotSuggestion(detectCrossSlotSuggestion(activitiesBySlot));

    setBusy(false);
    toast("Route optimized per time slot.");
    router.refresh();
  }

  /** Resolve start/end accommodation coordinates for a day plan.
   *  Start = where you wake up (previous night), End = where you sleep (current night). */
  function resolveAccom(dp: DayPlanDTO): {
    accomStart: { lat: number; lng: number } | null;
    accomEnd: { lat: number; lng: number } | null;
  } {
    const dayIdx = dayPlans.indexOf(dp);

    function findAccomCoord(plan: DayPlanDTO | undefined): { lat: number; lng: number } | null {
      if (!plan) return null;
      for (const act of plan.activities) {
        if (act.poiCategory === "ACCOMMODATION") {
          const poi = pois.find((p) => p.id === act.poiId);
          if (poi?.latitude != null && poi?.longitude != null) {
            return { lat: poi.latitude, lng: poi.longitude };
          }
        }
      }
      return null;
    }

    const prevAccom = dayIdx > 0 ? findAccomCoord(dayPlans[dayIdx - 1]) : null;
    const curAccom = findAccomCoord(dp);
    return {
      accomStart: prevAccom ?? curAccom,
      accomEnd: curAccom ?? prevAccom,
    };
  }

  async function optimizeRoute(dayPlanId: number) {
    const dp = dayPlans.find((d) => d.id === dayPlanId);
    if (!dp) return;
    setBusy(true);
    setCrossSlotSuggestion(null);

    const { accomStart, accomEnd } = resolveAccom(dp);
    await optimizeActivities(dayPlanId, dp.activities, accomStart, accomEnd);
  }

  /** Apply the cross-slot suggestion: move the activity to the target slot, then re-optimise. */
  async function applyCrossSlotSuggestion() {
    if (!crossSlotSuggestion) return;
    const { activityId, toSlot } = crossSlotSuggestion;

    // Find the day plan that owns this activity
    const dp = dayPlans.find((d) => d.activities.some((a) => a.id === activityId));
    if (!dp) return;

    setCrossSlotSuggestion(null);
    setBusy(true);

    // Build updated activities with the activity in its new slot (in-memory, no stale state)
    const updatedActivities: DayActivityDTO[] = dp.activities.map((a) =>
      a.id === activityId ? { ...a, timeSlot: toSlot } : a,
    );

    // Optimistic UI: show the activity in the new slot immediately
    setDayPlans((prev) =>
      prev.map((d) => (d.id === dp.id ? { ...d, activities: updatedActivities } : d)),
    );

    // Persist the slot change
    await fetch(`/api/day-activities/${activityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeSlot: toSlot }),
    });

    // Now optimise using the already-updated activities array (no stale closure issue)
    const { accomStart, accomEnd } = resolveAccom(dp);
    await optimizeActivities(dp.id, updatedActivities, accomStart, accomEnd);
  }

  // Map modal data
  const mapPois = useMemo(() => {
    if (!mapDayPlan) return [];
    const poiIds = mapDayPlan.activities.map((a) => a.poiId);
    return pois.filter((p) => poiIds.includes(p.id));
  }, [mapDayPlan, pois]);

  // Resolve accommodation locations for the selected day's walking route
  const { startAccom, endAccom } = useMemo((): { startAccom: AccommodationLoc; endAccom: AccommodationLoc } => {
    if (!mapDayPlan) return { startAccom: null, endAccom: null };

    const dayIdx = dayPlans.indexOf(mapDayPlan);

    // Helper: find the first accommodation POI with valid coords from a day plan's activities
    function findAccom(dp: DayPlanDTO | undefined): AccommodationLoc {
      if (!dp) return null;
      for (const act of dp.activities) {
        if (act.poiCategory === "ACCOMMODATION") {
          const poi = pois.find((p) => p.id === act.poiId);
          if (poi?.latitude != null && poi?.longitude != null) {
            return { name: poi.name, latitude: poi.latitude, longitude: poi.longitude };
          }
        }
      }
      return null;
    }

    // Start: accommodation from the night before (previous day), fall back to current day
    const prevDayAccom = dayIdx > 0 ? findAccom(dayPlans[dayIdx - 1]) : null;
    const curDayAccom = findAccom(mapDayPlan);

    return {
      startAccom: prevDayAccom ?? curDayAccom,
      endAccom: curDayAccom ?? prevDayAccom,
    };
  }, [mapDayPlan, dayPlans, pois]);

  return (
    <div className="space-y-4">
      {/* Header & auto-plan controls */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Drag POIs between slots/days, or click a POI then a slot to assign.
          </p>
          <div className="flex items-center gap-2">
            {totalActivities > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearAll}
                disabled={busy}
                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="mr-1 h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                Clear plan
              </Button>
            )}
            {!autoPlanOpen ? (
              <Button
                type="button"
                onClick={() => setAutoPlanOpen(true)}
                disabled={pois.length === 0}
              >
                Auto-plan with AI
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAutoPlanOpen(false)}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>

        {autoPlanOpen && (
          <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-3 space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAutoPlanMode("all")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  autoPlanMode === "all"
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "bg-[hsl(var(--background))] border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                All days
              </button>
              <button
                type="button"
                onClick={() => setAutoPlanMode("selected")}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  autoPlanMode === "selected"
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "bg-[hsl(var(--background))] border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                Select days
              </button>
            </div>

            {autoPlanMode === "selected" && (
              <div className="flex flex-wrap gap-2">
                {dayPlans.map((dp, idx) => {
                  const checked = selectedDayIds.has(dp.id);
                  return (
                    <button
                      key={dp.id}
                      type="button"
                      onClick={() =>
                        setSelectedDayIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(dp.id)) next.delete(dp.id);
                          else next.add(dp.id);
                          return next;
                        })
                      }
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        checked
                          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                          : "border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:bg-[hsl(var(--muted))]"
                      }`}
                    >
                      {formatDayWithIndex(dp.date, idx)}
                    </button>
                  );
                })}
              </div>
            )}

            <Button
              type="button"
              onClick={autoPlan}
              disabled={autoPlanning || (autoPlanMode === "selected" && selectedDayIds.size === 0)}
              className="w-full"
            >
              {autoPlanning
                ? <><span className="spinner mr-1.5" /> Planning…</>
                : autoPlanMode === "all"
                  ? "Plan all days"
                  : `Plan ${selectedDayIds.size} selected day${selectedDayIds.size !== 1 ? "s" : ""}`}
            </Button>
          </div>
        )}
      </div>

      {/* Main grid: sidebar + day view */}
      <div className={`grid gap-4 ${hideSidebar ? "" : "md:grid-cols-[220px_1fr]"}`}>
        {/* Left sidebar: Unassigned POIs only */}
        {!hideSidebar && <aside className="space-y-2">
          <div className="flex items-center justify-between gap-1">
            <h4 className="text-sm font-semibold">
              Unassigned POIs{" "}
              <span className="text-[hsl(var(--muted-foreground))]">({filteredUnassigned.length})</span>
            </h4>
          </div>
          {presentCategories.length > 1 && (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setCatFilter(null)}
                className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  catFilter === null
                    ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                All
              </button>
              {presentCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCatFilter(catFilter === cat ? null : cat)}
                  className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                    catFilter === cat
                      ? `${CATEGORY_STYLES[cat].badge} border-transparent`
                      : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          )}
          {unassigned.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              All POIs are assigned.
            </p>
          ) : filteredUnassigned.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No {catFilter ? CATEGORY_LABELS[catFilter] : ""} POIs unassigned.
            </p>
          ) : (
            <ul className="space-y-1 max-h-[400px] overflow-y-auto">
              {filteredUnassigned.map((poi) => {
                const isSelected = poi.id === selectedPoiId;
                return (
                  <li key={poi.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedPoiId(isSelected ? null : poi.id)}
                      className={`w-full rounded-md border p-2 text-left text-sm transition-colors ${
                        isSelected
                          ? "border-[hsl(var(--primary))] bg-[hsl(var(--muted))]"
                          : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate flex items-center gap-1">
                          {poi.name}
                          {favouritedPoiIds?.has(poi.id) && <span className="text-red-400 text-[10px]">♥</span>}
                        </span>
                        <CategoryBadge category={poi.category} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selectedPoi && (
            <div className="space-y-2">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                Selected: <strong>{selectedPoi.name}</strong>. Click a slot to assign.
              </p>
              {/* Multi-day assignment for accommodation */}
              {selectedPoi.category === "ACCOMMODATION" && (
                <MultiDayAccommodation
                  poi={selectedPoi}
                  dayPlans={dayPlans}
                  busy={busy}
                  onAssigned={() => { setSelectedPoiId(null); router.refresh(); }}
                />
              )}
            </div>
          )}
        </aside>}

        {/* Calendar + Selected day view */}
        <div className={hideSidebar ? "grid gap-4 md:grid-cols-[1fr_4fr]" : "space-y-4"}>
          {/* Mini Calendar */}
          <div className={`rounded-md border border-[hsl(var(--border))] p-3 ${hideSidebar ? "self-start sticky top-20" : ""}`}>
            <MiniCalendar
              dayPlans={dayPlans}
              selectedDate={selectedDate}
              onSelect={setSelectedDate}
            />
          </div>

          {dayPlans.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No days in this range.
            </p>
          ) : currentDayPlan ? (
            <div id="daily-plan-day-view" className="space-y-3 rounded-md border border-[hsl(var(--border))] p-3">
              <div className="flex items-center justify-between">
                <h5 className="font-semibold">
                  {formatDayWithIndex(currentDayPlan.date, currentDayIndex)}
                </h5>
                <div className="flex items-center gap-2">
                  {currentDayPlan.activities.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => optimizeRoute(currentDayPlan.id)}
                        disabled={busy}
                        className="text-xs text-green-600 hover:text-green-800 transition-colors flex items-center gap-1"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        Optimize route
                      </button>
                      <button
                        type="button"
                        onClick={() => setMapDayPlan(currentDayPlan)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-1"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        Show on map
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMoveTargetDayPlanId(null);
                          setMoveMode("replace");
                          setMoveModalOpen((v) => !v);
                        }}
                        disabled={busy}
                        className="text-xs text-purple-600 hover:text-purple-800 transition-colors flex items-center gap-1"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                        Move to...
                      </button>
                      <button
                        type="button"
                        onClick={() => clearDay(currentDayPlan.id)}
                        disabled={busy}
                        className="text-xs text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors"
                      >
                        Clear day
                      </button>
                    </>
                  )}
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {currentDayPlan.activities.length} {currentDayPlan.activities.length === 1 ? "POI" : "POIs"}
                  </span>
                </div>
              </div>

              {/* Move day plan modal */}
              {moveModalOpen && (
                <div className="rounded-lg border border-purple-200 bg-purple-50/30 dark:border-purple-800 dark:bg-purple-950/20 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">Move activities to another day</span>
                    <button type="button" onClick={() => setMoveModalOpen(false)} className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">Cancel</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {dayPlans.map((dp, idx) => {
                      const isCurrentDay = dp.id === currentDayPlan.id;
                      const isSelected = dp.id === moveTargetDayPlanId;
                      return (
                        <button
                          key={dp.id}
                          type="button"
                          disabled={isCurrentDay}
                          onClick={() => setMoveTargetDayPlanId(dp.id)}
                          className={`rounded-md px-2 py-1 text-[11px] border transition-colors ${
                            isCurrentDay
                              ? "opacity-30 cursor-not-allowed border-transparent bg-[hsl(var(--muted))]"
                              : isSelected
                              ? "border-purple-500 bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
                              : "border-[hsl(var(--border))] hover:border-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                          }`}
                          title={isCurrentDay ? "Current day" : `Move to Dag ${idx + 1}`}
                        >
                          <div className="font-medium">Dag {idx + 1}</div>
                          <div className="text-[10px] text-[hsl(var(--muted-foreground))]">
                            {formatDay(dp.date)}
                          </div>
                          {dp.activities.filter((a) => a.poiCategory !== "ACCOMMODATION").length > 0 && (
                            <div className="text-[9px] text-amber-600 dark:text-amber-400 mt-0.5">
                              {dp.activities.filter((a) => a.poiCategory !== "ACCOMMODATION").length} activities
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {moveTargetDayPlanId && (() => {
                    const targetDp = dayPlans.find((dp) => dp.id === moveTargetDayPlanId);
                    const targetNonAccom = targetDp?.activities.filter((a) => a.poiCategory !== "ACCOMMODATION").length ?? 0;
                    return (
                      <div className="space-y-2">
                        {targetNonAccom > 0 && (
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input type="radio" name="moveMode" checked={moveMode === "replace"} onChange={() => setMoveMode("replace")} className="accent-purple-600" />
                              Replace existing ({targetNonAccom} activities)
                            </label>
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input type="radio" name="moveMode" checked={moveMode === "merge"} onChange={() => setMoveMode("merge")} className="accent-purple-600" />
                              Merge (add to existing)
                            </label>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={moveDayTo}
                          disabled={busy}
                          className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
                        >
                          {busy ? "Moving..." : `Move ${currentDayPlan.activities.filter((a) => a.poiCategory !== "ACCOMMODATION").length} activities`}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Cross-slot rearrangement suggestion */}
              {crossSlotSuggestion && currentDayPlan.activities.some((a) => a.id === crossSlotSuggestion.activityId) && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <span className="shrink-0">💡</span>
                  <span className="flex-1">
                    Consider moving <strong>{crossSlotSuggestion.poiName}</strong> from{" "}
                    <strong>{SLOT_LABELS[crossSlotSuggestion.fromSlot].replace(/^[^\s]+ /, "")}</strong> →{" "}
                    <strong>{SLOT_LABELS[crossSlotSuggestion.toSlot].replace(/^[^\s]+ /, "")}</strong> for a shorter walking route.
                  </span>
                  <button
                    type="button"
                    onClick={applyCrossSlotSuggestion}
                    disabled={busy}
                    className="shrink-0 rounded-full bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => setCrossSlotSuggestion(null)}
                    className="shrink-0 text-amber-500 hover:text-amber-700 text-base leading-none"
                    aria-label="Dismiss suggestion"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Accommodation section */}
              {(() => {
                const accommodationActivities = currentDayPlan.activities.filter(
                  (a) => a.poiCategory === "ACCOMMODATION"
                );
                return (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/30 dark:border-indigo-800 dark:bg-indigo-950/20 p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                        🏠 Accommodation
                      </span>
                    </div>
                    {accommodationActivities.length === 0 ? (
                      <div className="rounded-lg border-2 border-dashed border-indigo-200 dark:border-indigo-800 px-3 py-2.5 text-center text-xs text-indigo-400">
                        {selectedPoi?.category === "ACCOMMODATION"
                          ? <button type="button" onClick={() => assign(currentDayPlan.id, "EVENING")} disabled={busy} className="text-indigo-500 hover:text-indigo-700 font-medium">+ Assign {selectedPoi.name}</button>
                          : "No accommodation assigned"}
                      </div>
                    ) : (
                      <ul className="space-y-1">
                        {accommodationActivities.map((a) => (
                          <li
                            key={a.id}
                            className="flex items-center justify-between gap-1 rounded-lg bg-[hsl(var(--background))] px-2.5 py-2 text-sm shadow-sm border border-indigo-100 dark:border-indigo-800"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="text-indigo-500">🏠</span>
                              <PoiHoverCard poi={poiLookup.get(a.poiId) ?? null}>
                                <span className="truncate font-medium">{a.poiName}</span>
                              </PoiHoverCard>
                              {favouritedPoiIds?.has(a.poiId) && (
                                <span className="text-red-400 text-[10px] shrink-0" title="In favourites">♥</span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => remove(a.id)}
                              disabled={busy}
                              aria-label={`Remove ${a.poiName}`}
                              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-red-600"
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}

              {/* Time slots grid with drag & drop */}
              <div className="grid gap-3 sm:grid-cols-3">
                {(() => {
                  let runningNumber = 0;
                  return TIME_SLOTS.map((slot) => {
                  const items = currentDayPlan.activities.filter((a) => a.timeSlot === slot && a.poiCategory !== "ACCOMMODATION");
                  const slotStartNum = runningNumber;
                  runningNumber += items.length;
                  const isDropTarget = !!dragActivity || poiDragActive;
                  const slotKey = `slot-${slot}`;
                  const isPoiOver = poiDragOverSlot === slotKey;
                  return (
                    <div
                      key={slot}
                      className={`space-y-2 rounded-lg p-3 transition-colors ${SLOT_CSS[slot]} ${
                        isPoiOver
                          ? "ring-2 ring-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/20"
                          : isDropTarget
                            ? "ring-2 ring-dashed ring-indigo-300"
                            : ""
                      }`}
                      onDragOver={(e) => {
                        handleDragOver(e);
                        if (e.dataTransfer.types.includes("application/x-poi-id")) {
                          setPoiDragOverSlot(slotKey);
                        }
                      }}
                      onDragLeave={(e) => {
                        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                        if (poiDragOverSlot === slotKey) setPoiDragOverSlot(null);
                      }}
                      onDrop={(e) => handleDrop(e, currentDayPlan.id, slot)}
                    >
                      <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        {SLOT_LABELS[slot]}
                      </div>
                      {items.length === 0 && !selectedPoi && (
                        <div className={`rounded-lg border-2 border-dashed px-3 py-4 text-center text-xs ${
                          isPoiOver
                            ? "border-indigo-300 text-indigo-500"
                            : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]"
                        }`}>
                          {isPoiOver ? "Drop here" : "Drag a POI here"}
                        </div>
                      )}
                      <ul className="space-y-1">
                        {items.map((a, idx) => (
                          <li
                            key={a.id}
                            data-activity-id={a.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, a.id, currentDayPlan.id, slot)}
                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onDrop={(e) => handleDropOnItem(e, currentDayPlan.id, slot, idx)}
                            onDragEnd={handleDragEnd}
                            className="flex items-center justify-between gap-1 rounded-lg bg-[hsl(var(--background))] px-2.5 py-2 text-sm cursor-grab active:cursor-grabbing shadow-sm border border-[hsl(var(--border))] hover:shadow-md transition-all"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="flex flex-col items-center gap-[2px] text-[hsl(var(--muted-foreground))] opacity-100 sm:opacity-40 sm:group-hover:opacity-100 transition-opacity" title="Drag to reorder">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3" height="3" rx="1"/><rect x="14" y="5" width="3" height="3" rx="1"/><rect x="7" y="11" width="3" height="3" rx="1"/><rect x="14" y="11" width="3" height="3" rx="1"/><rect x="7" y="17" width="3" height="3" rx="1"/><rect x="14" y="17" width="3" height="3" rx="1"/></svg>
                              </span>
                              <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))]/15 text-[9px] font-bold text-[hsl(var(--primary))]">
                                {slotStartNum + idx + 1}
                              </span>
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: CATEGORY_STYLES[a.poiCategory].dot }}
                              />
                              <PoiHoverCard poi={poiLookup.get(a.poiId) ?? null}>
                                <span className="truncate">{a.poiName}</span>
                              </PoiHoverCard>
                              {favouritedPoiIds?.has(a.poiId) && (
                                <span className="text-red-400 text-[10px] shrink-0" title="In favourites">♥</span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => remove(a.id)}
                              disabled={busy}
                              aria-label={`Remove ${a.poiName}`}
                              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-red-600"
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!selectedPoi || busy}
                        onClick={() => assign(currentDayPlan.id, slot)}
                        className="w-full"
                      >
                        {selectedPoi ? `+ Assign ${selectedPoi.name}` : "+ Assign here"}
                      </Button>
                    </div>
                  );
                });
                })()}
              </div>

              {/* Subcity activities for this date (read-only, from sub-destinations) */}
              {(() => {
                if (!subcityDayPlans || subcityDayPlans.length === 0) return null;
                const currentDate = currentDayPlan.date.slice(0, 10);
                const matchingSubs = subcityDayPlans.filter(
                  (sdp) => sdp.date.slice(0, 10) === currentDate && sdp.activities.length > 0,
                );
                if (matchingSubs.length === 0) return null;
                return (
                  <div className="space-y-2 rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      Sub-destination activities
                    </div>
                    {matchingSubs.map((sdp) => (
                      <div key={`${sdp.cityId}-${sdp.date}`} className="space-y-1">
                        {sdp.activities.map((a, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-2 rounded-md bg-[hsl(var(--background))] px-2.5 py-1.5 text-sm border border-[hsl(var(--border))]"
                          >
                            <Link
                              href={`/trips/${sdp.tripId}/cities/${sdp.cityId}`}
                              className="inline-flex items-center rounded-full bg-[hsl(var(--primary))]/10 px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/20 transition-colors shrink-0"
                            >
                              {sdp.cityName}
                            </Link>
                            <span className="truncate text-[hsl(var(--muted-foreground))]">{a.poiName}</span>
                            <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]">
                              {a.timeSlot === "MORNING" ? "🌅" : a.timeSlot === "AFTERNOON" ? "☀️" : "🌙"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Day note */}
              <TripNoteEditor
                initialNote={dayNotes?.[currentDayPlan.id] ?? null}
                scope={{ dayPlanId: currentDayPlan.id }}
                compact
              />

              {/* Day navigation arrows */}
              <div className="flex items-center justify-between pt-2 border-t border-[hsl(var(--border))]">
                <button
                  type="button"
                  disabled={currentDayIndex <= 0}
                  onClick={() => currentDayIndex > 0 && setSelectedDate(dayPlans[currentDayIndex - 1].date)}
                  className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-30 disabled:cursor-default"
                >
                  ← Previous day
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentDayIndex <= 0}
                    onClick={() => setSelectedDate(dayPlans[0].date)}
                    title="Go to first day"
                    className="text-[10px] px-1.5 py-0.5 rounded border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-30 disabled:cursor-default transition-colors"
                  >
                    Start
                  </button>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {currentDayIndex + 1} / {dayPlans.length}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={currentDayIndex >= dayPlans.length - 1}
                  onClick={() => currentDayIndex < dayPlans.length - 1 && setSelectedDate(dayPlans[currentDayIndex + 1].date)}
                  className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-30 disabled:cursor-default"
                >
                  Next day →
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Day Map Modal */}
      {mapDayPlan && (
        <DayMapModal
          pois={mapPois}
          activities={mapDayPlan.activities}
          dayLabel={formatDayWithIndex(mapDayPlan.date, dayPlans.indexOf(mapDayPlan))}
          onClose={() => setMapDayPlan(null)}
          startAccom={startAccom}
          endAccom={endAccom}
        />
      )}
    </div>
  );
}
