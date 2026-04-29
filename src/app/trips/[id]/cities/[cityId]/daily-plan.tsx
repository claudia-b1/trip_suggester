"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CATEGORY_STYLES, type Category } from "@/lib/categories";
import { TIME_SLOTS, type TimeSlot } from "@/lib/slots";
import type { PoiDTO } from "./pois-section";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

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
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
};

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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

export function DailyPlan({
  cityId,
  pois,
  dayPlans,
}: {
  cityId: number;
  pois: PoiDTO[];
  dayPlans: DayPlanDTO[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [selectedPoiId, setSelectedPoiId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoPlanning, setAutoPlanning] = useState(false);

  const assignedIds = new Set(
    dayPlans.flatMap((dp) => dp.activities.map((a) => a.poiId)),
  );
  const unassigned = pois.filter((p) => !assignedIds.has(p.id));
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
    setSelectedPoiId(null);
    router.refresh();
  }

  async function autoPlan() {
    const hasExisting = dayPlans.some((dp) => dp.activities.length > 0);
    if (hasExisting) {
      const ok = await confirm({
        title: "Overwrite plan?",
        message: "Auto-plan will replace the current assignments for this city.",
        confirmText: "Overwrite",
        variant: "destructive",
      });
      if (!ok) return;
    }
    setAutoPlanning(true);
    const res = await fetch(`/api/cities/${cityId}/auto-plan`, {
      method: "POST",
    });
    setAutoPlanning(false);
    if (!res.ok) {
      const body: { error?: string } = await res.json().catch(() => ({}));
      toast(body.error ?? "Failed to auto-plan", { variant: "error" });
      return;
    }
    setSelectedPoiId(null);
    toast("Plan generated.");
    router.refresh();
  }

  async function remove(activityId: number) {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/day-activities/${activityId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast("Failed to remove activity", { variant: "error" });
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Click a POI in the sidebar, then click a slot to assign it.
        </p>
        <Button
          type="button"
          onClick={autoPlan}
          disabled={autoPlanning || pois.length === 0}
        >
          {autoPlanning ? "Planning…" : "Auto-plan with AI"}
        </Button>
      </div>

    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <aside className="space-y-2">
        <h4 className="text-sm font-semibold">
          Unassigned POIs{" "}
          <span className="text-[hsl(var(--muted-foreground))]">({unassigned.length})</span>
        </h4>
        {unassigned.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            All POIs are assigned.
          </p>
        ) : (
          <ul className="space-y-1">
            {unassigned.map((poi) => {
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
                      <span className="font-medium">{poi.name}</span>
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

      <div className="space-y-4">
        {dayPlans.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No days in this range.
          </p>
        ) : (
          dayPlans.map((dp, idx) => {
            const total = dp.activities.length;
            return (
              <div
                key={dp.id}
                className="space-y-3 rounded-md border border-[hsl(var(--border))] p-3"
              >
                <div className="flex items-center justify-between">
                  <h5 className="font-semibold">
                    Day {idx + 1} · {formatDay(dp.date)}
                  </h5>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {total} {total === 1 ? "POI" : "POIs"}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {TIME_SLOTS.map((slot) => {
                    const items = dp.activities.filter((a) => a.timeSlot === slot);
                    return (
                      <div
                        key={slot}
                        className="space-y-2 rounded-md bg-[hsl(var(--muted))] p-2"
                      >
                        <div className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                          {SLOT_LABELS[slot]}
                        </div>
                        <ul className="space-y-1">
                          {items.map((a) => (
                            <li
                              key={a.id}
                              className="flex items-center justify-between gap-1 rounded bg-[hsl(var(--background))] px-2 py-1 text-sm"
                            >
                              <div className="flex min-w-0 items-center gap-1">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: CATEGORY_STYLES[a.poiCategory].dot }}
                                />
                                <span className="truncate">{a.poiName}</span>
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
                          onClick={() => assign(dp.id, slot)}
                          className="w-full"
                        >
                          {selectedPoi ? `+ Assign ${selectedPoi.name}` : "+ Assign here"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
    </div>
  );
}
