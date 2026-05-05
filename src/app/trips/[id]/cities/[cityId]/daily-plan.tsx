"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CATEGORY_STYLES, type Category } from "@/lib/categories";
import { TIME_SLOTS, type TimeSlot } from "@/lib/slots";
import type { PoiDTO } from "./pois-section";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PoiMap } from "./poi-map";
import { PoiHoverCard, type HoverPoiData } from "@/components/ui/poi-hover-card";

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
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function CategoryBadge({ category }: { category: Category }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[category].badge}`}
    >
      {category}
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

  const activityCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const dp of dayPlans) {
      const d = new Date(dp.date);
      map.set(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, dp.activities.length);
    }
    return map;
  }, [dayPlans]);

  const selectedD = new Date(selectedDate);
  const selectedKey = `${selectedD.getFullYear()}-${selectedD.getMonth()}-${selectedD.getDate()}`;

  const prevMonth = () => setViewMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setViewMonth(new Date(year, month + 1, 1));
  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

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
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div key={d} className="py-1 text-[hsl(var(--muted-foreground))] font-medium">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day == null) return <div key={`e-${i}`} />;
          const key = `${year}-${month}-${day}`;
          const isTripDay = tripDates.has(key);
          const isSelected = key === selectedKey;
          const count = activityCounts.get(key) ?? 0;

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
              {isTripDay && count > 0 && !isSelected && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-blue-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Day Map Modal ────────────────────────────────────────────────────────────

const SLOT_ORDER: Record<TimeSlot, number> = { MORNING: 0, AFTERNOON: 1, EVENING: 2 };

function DayMapModal({
  pois,
  activities,
  dayLabel,
  onClose,
}: {
  pois: { id: number; name: string; category: Category; description: string | null; latitude: number | null; longitude: number | null; photoUrl?: string | null }[];
  activities: DayActivityDTO[];
  dayLabel: string;
  onClose: () => void;
}) {
  const openGoogleMapsRoute = useCallback(() => {
    // Order POIs by time slot, then by position within slot (array index = order)
    const ordered = TIME_SLOTS.flatMap((slot) =>
      activities.filter((a) => a.timeSlot === slot),
    )
      .map((act) => pois.find((p) => p.id === act.poiId))
      .filter((p): p is NonNullable<typeof p> => p != null && p.latitude != null && p.longitude != null);

    if (ordered.length < 2) return;

    const origin = ordered[0];
    const destination = ordered[ordered.length - 1];
    const waypoints = ordered.slice(1, -1);

    let url = `https://www.google.com/maps/dir/?api=1&travelmode=walking`;
    url += `&origin=${origin.latitude},${origin.longitude}`;
    url += `&destination=${destination.latitude},${destination.longitude}`;
    if (waypoints.length > 0) {
      url += `&waypoints=${waypoints.map((p) => `${p.latitude},${p.longitude}`).join("|")}`;
    }
    window.open(url, "_blank", "noopener");
  }, [pois, activities]);

  const hasEnoughPois = pois.filter((p) => p.latitude != null && p.longitude != null).length >= 2;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-[90vw] max-w-3xl rounded-lg bg-[hsl(var(--background))] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
          <h3 className="text-sm font-semibold">{dayLabel} — Assigned POIs</h3>
          <div className="flex items-center gap-2">
            {hasEnoughPois && (
              <button
                type="button"
                onClick={openGoogleMapsRoute}
                className="rounded-md border border-[hsl(var(--border))] bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                🚶 Walking route in Google Maps
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded p-1 hover:bg-[hsl(var(--muted))] text-lg leading-none">×</button>
          </div>
        </div>
        <div className="p-4">
          <PoiMap pois={pois} />
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
}: {
  cityId: number;
  pois: PoiDTO[];
  dayPlans: DayPlanDTO[];
  setDayPlans: React.Dispatch<React.SetStateAction<DayPlanDTO[]>>;
  scrollToActivity?: { date: string; activityId: number } | null;
  onScrollComplete?: () => void;
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
      const el = document.querySelector(`[data-activity-id="${scrollToActivity.activityId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-[hsl(var(--primary))]");
        setTimeout(() => el.classList.remove("ring-2", "ring-[hsl(var(--primary))]"), 1500);
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
        photoUrl: p.photoUrl,
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
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDropOnItem(e: React.DragEvent, toDayPlanId: number, toSlot: TimeSlot, targetIndex: number) {
    e.preventDefault();
    e.stopPropagation();
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

  async function optimizeRoute(dayPlanId: number) {
    const dp = dayPlans.find((d) => d.id === dayPlanId);
    if (!dp) return;
    setBusy(true);

    // Nearest-neighbor within each slot
    const optimized: DayActivityDTO[] = [];
    for (const slot of TIME_SLOTS) {
      const slotActivities: DayActivityDTO[] = dp.activities.filter((a) => a.timeSlot === slot);
      if (slotActivities.length <= 1) {
        optimized.push(...slotActivities);
        continue;
      }
      type CoordItem = { activity: DayActivityDTO; lat: number; lng: number };
      const withCoords: CoordItem[] = slotActivities.map((a) => {
        const poi = pois.find((p) => p.id === a.poiId);
        return { activity: a, lat: poi?.latitude ?? 0, lng: poi?.longitude ?? 0 };
      });
      // Nearest-neighbor starting from first item
      const ordered: CoordItem[] = [];
      const remaining = [...withCoords];
      let current = remaining.shift()!;
      ordered.push(current);
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
      optimized.push(...ordered.map((o) => o.activity));
    }

    // Optimistic update
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
    setBusy(false);
    toast("Route optimized for the day.");
    router.refresh();
  }

  // Map modal data
  const mapPois = useMemo(() => {
    if (!mapDayPlan) return [];
    const poiIds = mapDayPlan.activities.map((a) => a.poiId);
    return pois.filter((p) => poiIds.includes(p.id));
  }, [mapDayPlan, pois]);

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
                      Day {idx + 1} · {formatDay(dp.date)}
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
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        {/* Left sidebar: Unassigned POIs only */}
        <aside className="space-y-2">
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
                  {cat}
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
              No {catFilter} POIs unassigned.
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
                        <span className="font-medium truncate">{poi.name}</span>
                        <CategoryBadge category={poi.category} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {selectedPoi && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Selected: <strong>{selectedPoi.name}</strong>. Click a slot to assign.
            </p>
          )}
        </aside>

        {/* Right: Calendar + Selected day view */}
        <div className="space-y-4">
          {/* Mini Calendar */}
          <div className="rounded-md border border-[hsl(var(--border))] p-3">
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
            <div className="space-y-3 rounded-md border border-[hsl(var(--border))] p-3">
              <div className="flex items-center justify-between">
                <h5 className="font-semibold">
                  Day {currentDayIndex + 1} · {formatDay(currentDayPlan.date)}
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
                        className="text-xs text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-1"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        Show on map
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

              {/* Time slots grid with drag & drop */}
              <div className="grid gap-3 sm:grid-cols-3">
                {TIME_SLOTS.map((slot) => {
                  const items = currentDayPlan.activities.filter((a) => a.timeSlot === slot);
                  const isDropTarget = !!dragActivity;
                  return (
                    <div
                      key={slot}
                      className={`space-y-2 rounded-lg p-3 transition-colors ${SLOT_CSS[slot]} ${
                        isDropTarget ? "ring-2 ring-dashed ring-blue-300" : ""
                      }`}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, currentDayPlan.id, slot)}
                    >
                      <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        {SLOT_LABELS[slot]}
                      </div>
                      {items.length === 0 && !selectedPoi && (
                        <div className="rounded-lg border-2 border-dashed border-[hsl(var(--border))] px-3 py-4 text-center text-xs text-[hsl(var(--muted-foreground))]">
                          Drag a POI here
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
                              <span className="flex flex-col items-center gap-[2px] text-[hsl(var(--muted-foreground))] opacity-40 group-hover:opacity-100 transition-opacity" title="Drag to reorder">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3" height="3" rx="1"/><rect x="14" y="5" width="3" height="3" rx="1"/><rect x="7" y="11" width="3" height="3" rx="1"/><rect x="14" y="11" width="3" height="3" rx="1"/><rect x="7" y="17" width="3" height="3" rx="1"/><rect x="14" y="17" width="3" height="3" rx="1"/></svg>
                              </span>
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: CATEGORY_STYLES[a.poiCategory].dot }}
                              />
                              <PoiHoverCard poi={poiLookup.get(a.poiId) ?? null}>
                                <span className="truncate">{a.poiName}</span>
                              </PoiHoverCard>
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
                })}
              </div>

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
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {currentDayIndex + 1} / {dayPlans.length}
                </span>
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
          dayLabel={`Day ${dayPlans.indexOf(mapDayPlan) + 1} · ${formatDay(mapDayPlan.date)}`}
          onClose={() => setMapDayPlan(null)}
        />
      )}
    </div>
  );
}
