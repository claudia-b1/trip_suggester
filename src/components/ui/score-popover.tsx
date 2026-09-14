"use client";

/**
 * ScorePopover — subtle info icon that shows why a POI was selected.
 *
 * Displays the score breakdown from the recommendation engine as
 * human-readable lines. Shows on hover (desktop) or tap (mobile).
 */

import { useState, useRef, useEffect, useCallback } from "react";
import type { ScoreBreakdownDTO } from "@/app/trips/[id]/cities/[cityId]/pois-section";

type ScorePopoverProps = {
  breakdown: ScoreBreakdownDTO | null | undefined;
  className?: string;
};

type Factor = {
  emoji: string;
  label: string;
  points: number;
};

function getFactors(b: ScoreBreakdownDTO): Factor[] {
  const factors: Factor[] = [];

  if (b.rating > 0) {
    const stars = Math.round((b.rating / 30) * 5 * 10) / 10;
    factors.push({ emoji: "⭐", label: `High rating (~${stars.toFixed(1)}/5)`, points: b.rating });
  }
  if (b.notability > 0) {
    factors.push({ emoji: "📸", label: "Popular / notable", points: b.notability });
  }
  if (b.proximity > 0) {
    const km = Math.round((15 - b.proximity) * 10) / 10;
    factors.push({ emoji: "📍", label: km > 0 ? `${km} km from centre` : "Very close", points: b.proximity });
  }
  if (b.unesco > 0) {
    factors.push({ emoji: "🏛️", label: "UNESCO World Heritage", points: b.unesco });
  }
  if (b.hiddenGem > 0) {
    factors.push({ emoji: "💎", label: "Hidden gem", points: b.hiddenGem });
  }
  if (b.categoryMatch > 0) {
    factors.push({ emoji: "🎯", label: "Great category match", points: b.categoryMatch });
  }
  if (b.photo > 0) {
    factors.push({ emoji: "🖼️", label: "Has photos", points: b.photo });
  }
  if (b.preferences > 0) {
    factors.push({ emoji: "❤️", label: "Matches your preferences", points: b.preferences });
  }
  if (b.googleCoord < 0) {
    factors.push({ emoji: "⚠️", label: "Location uncertainty", points: b.googleCoord });
  }

  // Sort by absolute points descending
  return factors.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

export function ScorePopover({ breakdown, className = "" }: ScorePopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleMouseEnter = useCallback(() => {
    hoverTimeout.current = setTimeout(() => setOpen(true), 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    hoverTimeout.current = setTimeout(() => setOpen(false), 200);
  }, []);

  if (!breakdown || breakdown.total === 0) return null;

  const factors = getFactors(breakdown);
  if (factors.length === 0) return null;

  return (
    <div
      ref={ref}
      className={`relative inline-flex ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-[hsl(var(--border))] text-[9px] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        title="Why this place?"
        aria-label="Score breakdown"
      >
        i
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 shadow-lg">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Why this place?
          </p>
          <div className="space-y-1">
            {factors.map((f) => (
              <div
                key={f.label}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="text-[hsl(var(--foreground))]">
                  {f.emoji} {f.label}
                </span>
                <span className={`flex-shrink-0 font-mono text-[10px] ${f.points >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                  {f.points >= 0 ? "+" : ""}{Math.round(f.points)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 border-t border-[hsl(var(--border))] pt-1.5 flex items-center justify-between text-[10px]">
            <span className="font-medium text-[hsl(var(--muted-foreground))]">Score</span>
            <span className="font-semibold text-[hsl(var(--foreground))]">{Math.round(breakdown.total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
