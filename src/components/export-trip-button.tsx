"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type CityOption = {
  id: number;
  name: string;
  type: string;
  startDate: string;
  subcities: { id: number; name: string; type: string; startDate: string }[];
};

export function ExportTripButton({
  tripId,
  cities,
}: {
  tripId: number;
  cities: CityOption[];
}) {
  const [open, setOpen] = useState(false);

  // All city IDs (including subcities) — selected by default
  const allIds = cities.flatMap((c) => [c.id, ...c.subcities.map((s) => s.id)]);
  const [selected, setSelected] = useState<Set<number>>(new Set(allIds));

  function handleOpen() {
    // Reset selection to all cities each time the modal opens
    setSelected(new Set(allIds));
    setOpen(true);
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleParent(city: CityOption) {
    const childIds = city.subcities.map((s) => s.id);
    const allChildSelected = [city.id, ...childIds].every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChildSelected) {
        // Deselect parent + all children
        next.delete(city.id);
        childIds.forEach((id) => next.delete(id));
      } else {
        // Select parent + all children
        next.add(city.id);
        childIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(allIds));
  }

  function selectNone() {
    setSelected(new Set());
  }

  function handleExport() {
    const params = new URLSearchParams();
    for (const id of selected) {
      params.append("cities", String(id));
    }
    window.open(`/api/trips/${tripId}/export?${params.toString()}`, "_blank");
    setOpen(false);
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={handleOpen}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
        Save as PDF
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xl space-y-4 max-h-[80vh] flex flex-col">
            <div>
              <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">
                Save as PDF
              </h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                Select which destinations and travel stops to include.
              </p>
            </div>

            {/* Select all / none */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={selectAll}
                className="text-xs text-[hsl(var(--primary))] hover:underline"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={selectNone}
                className="text-xs text-[hsl(var(--muted-foreground))] hover:underline"
              >
                Deselect all
              </button>
            </div>

            {/* City list — sorted by start date to match timeline */}
            <div className="space-y-1 overflow-y-auto flex-1 min-h-0 -mx-1 px-1">
              {[...cities].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()).map((city) => {
                const childIds = city.subcities.map((s) => s.id);
                const allChecked = [city.id, ...childIds].every((id) =>
                  selected.has(id),
                );
                const someChecked =
                  !allChecked &&
                  [city.id, ...childIds].some((id) => selected.has(id));
                return (
                  <div key={city.id}>
                    <label className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-[hsl(var(--muted))]/50 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(el) => {
                          if (el) el.indeterminate = someChecked;
                        }}
                        onChange={() => toggleParent(city)}
                        className="h-4 w-4 rounded accent-[hsl(var(--primary))] cursor-pointer"
                      />
                      <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                        {city.type === "stop" ? "🚗 " : ""}
                        {city.name}
                      </span>
                      {city.type === "stop" && (
                        <span className="text-[10px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded px-1.5 py-0.5">
                          stop
                        </span>
                      )}
                    </label>
                    {city.subcities.length > 0 && (
                      <div className="ml-6 border-l border-[hsl(var(--border))] pl-3">
                        {[...city.subcities].sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()).map((sub) => (
                          <label
                            key={sub.id}
                            className="flex items-center gap-2.5 py-1 px-2 rounded-md hover:bg-[hsl(var(--muted))]/50 cursor-pointer select-none"
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(sub.id)}
                              onChange={() => toggle(sub.id)}
                              className="h-4 w-4 rounded accent-[hsl(var(--primary))] cursor-pointer"
                            />
                            <span className="text-sm text-[hsl(var(--foreground))]">
                              {sub.type === "stop" ? "🚗 " : ""}
                              {sub.name}
                            </span>
                            {sub.type === "stop" && (
                              <span className="text-[10px] text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded px-1.5 py-0.5">
                                stop
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1 border-t border-[hsl(var(--border))]">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleExport}
                disabled={selected.size === 0}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5 mr-1"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Save as PDF ({selected.size})
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
