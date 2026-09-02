"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { CATEGORY_STYLES, type Category } from "@/lib/categories";

export type HoverPoiData = {
  name: string;
  category: Category;
  description?: string | null;
  photoUrl?: string | null;
  rating?: number | null;
  estimatedDurationMinutes?: number | null;
};

export function PoiHoverCard({
  poi,
  children,
}: {
  poi: HoverPoiData | null;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function handleEnter() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), 400);
  }

  function handleLeave() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(false), 200);
  }

  // Toggle on tap for mobile (touch devices don't have hover)
  const handleClick = useCallback((e: React.MouseEvent) => {
    // Only toggle for touch-primary devices; desktop clicks should pass through
    if (window.matchMedia("(hover: none)").matches) {
      e.stopPropagation();
      setVisible((v) => !v);
    }
  }, []);

  // Close when tapping outside on mobile
  useEffect(() => {
    if (!visible) return;
    function handleOutside(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setVisible(false);
      }
    }
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [visible]);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  if (!poi) return <>{children}</>;

  return (
    <div
      ref={containerRef}
      className="relative inline-flex min-w-0"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={handleClick}
    >
      {children}
      {visible && (
        <div className="absolute left-0 bottom-full z-40 mb-2 w-56 max-w-[85vw] animate-fade-up rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg overflow-hidden pointer-events-none">
          {poi.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={poi.photoUrl}
              alt={poi.name}
              className="h-24 w-full object-cover"
            />
          )}
          <div className="p-2.5 space-y-1">
            <div className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: CATEGORY_STYLES[poi.category].dot }}
              />
              <span className="text-xs font-semibold text-[hsl(var(--foreground))] truncate">
                {poi.name}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
              {poi.rating != null && <span>⭐ {poi.rating.toFixed(1)}</span>}
              {poi.estimatedDurationMinutes != null && (
                <span>⏱ ~{poi.estimatedDurationMinutes}m</span>
              )}
              <span className={`rounded-full px-1.5 py-0.5 ${CATEGORY_STYLES[poi.category].badge}`}>
                {poi.category}
              </span>
            </div>
            {poi.description && (
              <p className="text-[10px] leading-snug text-[hsl(var(--muted-foreground))] line-clamp-2">
                {poi.description}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
