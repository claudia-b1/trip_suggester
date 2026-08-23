"use client";

import { SUBCATEGORIES } from "@/lib/recommendations/subcategories";
import { ACCOMMODATION_SUBCATEGORIES } from "@/lib/favourite-fields";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORIES, CATEGORY_STYLES, CATEGORY_LABELS, CATEGORY_ICONS, type Category } from "@/lib/categories";
import { TIME_SLOTS, type TimeSlot } from "@/lib/slots";
import { PoiMap, type DayPlanOption } from "./poi-map";
import { DailyPlan, type DayPlanDTO } from "./daily-plan";
import { TimelineSidebar } from "./timeline-sidebar";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { useFavourites } from "@/components/favourites/favourites-provider";
import type { FavouriteItemDTO } from "@/components/favourites/favourites-provider";

export type PoiDTO = {
  id: number;
  name: string;
  category: Category;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  bestTimeToVisit: string | null;
  estimatedDurationMinutes: number | null;
  tips: string | null;
  // Enrichment fields
  placeId: string | null;
  priceLevel: number | null;
  website: string | null;
  phoneNumber: string | null;
  openingHours: string | null;
  photoUrl: string | null;
  isUnescoSite: boolean | null;
  inceptionYear: number | null;
  wikidataId: string | null;
  fee: string | null;
  userRatingCount: number | null;
  subcategory: string | null;
};

type View = "list" | "map" | "plan";
type ListLayout = "grid" | "compact";

/** Build a Google Maps URL that resolves to the actual place if found, otherwise falls back to coordinates */
function googleMapsUrl(name: string, lat: number, lng: number) {
  return `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lng},17z`;
}

function formatReviewCount(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

// ─── Delete icon SVG ──────────────────────────────────────────────────────────

function TrashIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

// ─── DayPlanAssigner ──────────────────────────────────────────────────────────

function DayPlanAssigner({ poiId, poiName, dayPlans }: { poiId: number; poiName: string; dayPlans: DayPlanOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot>("MORNING");
  const [assigning, setAssigning] = useState(false);

  if (dayPlans.length === 0) return null;

  async function assign() {
    if (!selectedDay) return;
    setAssigning(true);
    const res = await fetch(`/api/day-plans/${selectedDay}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ poiId, timeSlot: selectedSlot }),
    });
    setAssigning(false);
    if (!res.ok) {
      toast("Failed to assign POI", { variant: "error" });
      return;
    }
    toast(`${poiName} added to plan!`);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
      >
        <span className={`text-[9px] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        📅 Add to day plan
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          <select
            value={selectedDay ?? ""}
            onChange={(e) => setSelectedDay(Number(e.target.value) || null)}
            className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs"
          >
            <option value="">Pick a day…</option>
            {dayPlans.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
          <select
            value={selectedSlot}
            onChange={(e) => setSelectedSlot(e.target.value as TimeSlot)}
            className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs"
          >
            {TIME_SLOTS.map((s) => (
              <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={assign}
            disabled={!selectedDay || assigning}
            className="w-full rounded bg-[hsl(var(--primary))] px-2 py-1 text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40 hover:opacity-90"
          >
            {assigning ? "Adding…" : `Add to ${selectedSlot.toLowerCase()}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── StarRating ───────────────────────────────────────────────────────────────

function StarRating({
  poiId,
  rating,
  notInterested: isNotInterested,
  onRate,
  onToggleNotInterested,
  onDelete,
  isDeleting,
}: {
  poiId: number;
  rating?: number;
  notInterested?: boolean;
  onRate: (id: number, r: number | null) => void;
  onToggleNotInterested: (id: number) => void;
  onDelete?: () => void;
  isDeleting?: boolean;
}) {
  const [hoverStar, setHoverStar] = useState<number | null>(null);
  const displayRating = hoverStar ?? rating ?? 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            title={`Rate ${star} star${star > 1 ? "s" : ""}`}
            onMouseEnter={() => setHoverStar(star)}
            onMouseLeave={() => setHoverStar(null)}
            onClick={(e) => { e.stopPropagation(); onRate(poiId, rating === star ? null : star); }}
            className={`text-base leading-none transition-colors ${
              star <= displayRating ? "text-amber-400" : "text-gray-300"
            }`}
          >
            ★
          </button>
        ))}
      </div>
      <button
        type="button"
        title={isNotInterested ? "Remove 'not interested'" : "Mark as not interested"}
        onClick={(e) => { e.stopPropagation(); onToggleNotInterested(poiId); }}
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
          isNotInterested
            ? "bg-red-100 text-red-600 border border-red-200"
            : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border border-[hsl(var(--border))] hover:border-red-300 hover:text-red-500"
        }`}
      >
        {isNotInterested ? "✕ Not interested" : "✕"}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          disabled={isDeleting}
          aria-label="Delete POI"
          className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-red-50 hover:text-red-600 disabled:opacity-30 transition-colors"
        >
          {isDeleting ? <span className="text-xs">…</span> : <TrashIcon />}
        </button>
      )}
    </div>
  );
}

// ─── PoiCard (grid view) ──────────────────────────────────────────────────────

function HeartIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className ?? "h-3.5 w-3.5"} viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
    </svg>
  );
}

function PoiCard({
  poi,
  onDelete,
  onViewOnMap,
  onOpenLightbox,
  deletingId,
  isAssigned,
  isVisited,
  onToggleVisited,
  userRating,
  isNotInterested,
  onRate,
  onToggleNotInterested,
  onFavourite,
  isFavourited,
  dayPlans,
}: {
  poi: PoiDTO;
  onDelete: (poi: PoiDTO) => void;
  onViewOnMap: (poiId: number) => void;
  onOpenLightbox: (src: string, alt: string) => void;
  deletingId: number | null;
  isAssigned: boolean;
  isVisited: boolean;
  onToggleVisited: (poiId: number) => void;
  userRating?: number;
  isNotInterested?: boolean;
  onRate: (id: number, r: number | null) => void;
  onToggleNotInterested: (id: number) => void;
  onFavourite: (poi: PoiDTO) => void;
  isFavourited: boolean;
  dayPlans: DayPlanOption[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [hoverStar, setHoverStar] = useState<number | null>(null);

  const hasCoords = poi.latitude != null && poi.longitude != null;
  const isDeleting = deletingId === poi.id;
  const longDesc = (poi.description?.length ?? 0) > 110;
  const PRICE_LABELS: Record<number, string> = { 0: "Free", 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };
  const hasDetails = poi.openingHours || poi.phoneNumber || poi.inceptionYear || poi.fee;
  const showPhoto = poi.photoUrl && !imgError;
  const displayRating = hoverStar ?? userRating ?? 0;

  return (
    <div
      data-poi-id={poi.id}
      className={`group relative flex flex-col rounded-xl border shadow-sm transition-all duration-200 hover:scale-[1.01] hover:shadow-md overflow-hidden h-full ${
        isAssigned ? "bg-[hsl(var(--card))]/80 ring-1 ring-green-300" : "bg-[hsl(var(--card))]"
      } ${isNotInterested ? "opacity-50" : ""} ${
        userRating != null ? "border-[hsl(var(--primary))]" : "border-[hsl(var(--border))]"
      }`}
    >
      {/* ── Header: left category strip + photo ──────────────── */}
      <div className="flex h-28 w-full flex-shrink-0">

        {/* Left strip: category icon + Google rating */}
        <div className="flex w-12 flex-shrink-0 flex-col items-center justify-start gap-1.5 bg-[hsl(var(--muted))] px-1 py-2.5">
          <span className="text-xl leading-none">{CATEGORY_ICONS[poi.category]}</span>
          {poi.rating != null && (
            <div className="flex flex-col items-center text-center gap-0.5">
              <span className="text-[10px] font-semibold text-amber-600 leading-none">⭐ {poi.rating.toFixed(1)}</span>
              {poi.userRatingCount != null && (
                <span className="text-[9px] leading-none text-slate-400">({formatReviewCount(poi.userRatingCount)})</span>
              )}
            </div>
          )}
        </div>

        {/* Photo area */}
        <div
          className={`relative flex-1 overflow-hidden ${showPhoto ? "cursor-zoom-in" : "bg-[hsl(var(--muted))]/60"}`}
          onClick={() => showPhoto && onOpenLightbox(poi.photoUrl!, poi.name)}
        >
          {showPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={poi.photoUrl!}
              alt={poi.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-3xl opacity-10">{CATEGORY_ICONS[poi.category]}</span>
            </div>
          )}

          {/* UNESCO badge */}
          {poi.isUnescoSite && (
            <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-blue-700 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">🏛 UNESCO</span>
          )}

          {/* Bottom overlay: visited/assigned · user stars · ✕ · delete */}
          <div
            className="absolute bottom-0 left-0 right-0 flex items-center gap-1 px-1.5 py-1.5 bg-gradient-to-t from-black/55 to-transparent"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Visited dot */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleVisited(poi.id); }}
              title={isVisited ? "Visited — click to unmark" : "Mark as visited"}
              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[8px] transition-colors ${
                isVisited ? "bg-blue-500 text-white" : "bg-white/30 text-white/70 hover:bg-blue-400 hover:text-white"
              }`}
            >
              {isVisited ? "👁" : "○"}
            </button>
            {/* Assigned dot */}
            {isAssigned && (
              <span title="In day plan" className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-green-500 text-white text-[8px]">✓</span>
            )}
            {/* User stars */}
            <div className="flex items-center gap-0.5 flex-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  title={`Rate ${star} star${star > 1 ? "s" : ""}`}
                  onMouseEnter={() => setHoverStar(star)}
                  onMouseLeave={() => setHoverStar(null)}
                  onClick={(e) => { e.stopPropagation(); onRate(poi.id, userRating === star ? null : star); }}
                  className={`text-sm leading-none transition-colors ${star <= displayRating ? "text-amber-400" : "text-white/40 hover:text-white/70"}`}
                >
                  ★
                </button>
              ))}
            </div>
            {/* Favourite + Not interested + delete */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                title={isFavourited ? "Already in favourites" : "Add to favourites"}
                onClick={(e) => { e.stopPropagation(); onFavourite(poi); }}
                className={`transition-colors ${isFavourited ? "text-red-500" : "text-white/70 hover:text-red-400"}`}
              >
                <HeartIcon filled={isFavourited} className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title={isNotInterested ? "Remove 'not interested'" : "Mark as not interested"}
                onClick={(e) => { e.stopPropagation(); onToggleNotInterested(poi.id); }}
                className={`rounded px-1 py-0.5 text-[10px] font-medium transition-colors ${
                  isNotInterested ? "bg-red-500/80 text-white" : "text-white/70 hover:text-red-300"
                }`}
              >
                {isNotInterested ? "✕ N/A" : "✕"}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(poi); }}
                disabled={isDeleting}
                aria-label="Delete POI"
                className="text-white/60 hover:text-red-300 disabled:opacity-30 transition-colors"
              >
                {isDeleting ? <span className="text-[10px]">…</span> : <TrashIcon />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content area ──────────────────────────────────────── */}
      <div className="flex flex-1 flex-col p-3 min-h-0">
        {/* Name */}
        <h3 className="font-semibold text-sm leading-snug mb-1.5 line-clamp-2">{poi.name}</h3>

        {/* Price level (Google rating moved to left strip) */}
        {poi.priceLevel != null && (
          <div className="mb-2">
            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {PRICE_LABELS[poi.priceLevel] ?? ""}
            </span>
          </div>
        )}

        {/* Description */}
        {poi.description && (
          <div className="mb-2 flex-1 text-xs text-[hsl(var(--muted-foreground))]">
            <p className={expanded ? "" : "line-clamp-2"}>{poi.description}</p>
            {longDesc && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-0.5 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
              >
                {expanded ? "Show less" : "Read more"}
              </button>
            )}
          </div>
        )}

        {/* Tips + Details side by side */}
        {(poi.tips || hasDetails) && (
          <div className="mb-1.5 flex flex-wrap items-center gap-3">
            {poi.tips && (
              <button
                type="button"
                onClick={() => setTipsOpen((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
              >
                <span className={`text-[9px] transition-transform ${tipsOpen ? "rotate-90" : ""}`}>▶</span>
                💡 Tip
              </button>
            )}
            {hasDetails && (
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
              >
                <span className={`text-[9px] transition-transform ${detailsOpen ? "rotate-90" : ""}`}>▶</span>
                ℹ Details
              </button>
            )}
          </div>
        )}

        {/* Expanded tip */}
        {tipsOpen && poi.tips && (
          <div className="mb-2 rounded-md bg-amber-50 border border-amber-100 px-2.5 py-1.5 text-xs text-amber-800">
            💡 {poi.tips}
          </div>
        )}

        {/* Expanded details */}
        {detailsOpen && (
          <div className="mb-2 rounded-md bg-slate-50 border border-slate-100 px-2.5 py-1.5 text-xs text-slate-700 space-y-0.5">
            {poi.fee && <p>🎫 {poi.fee === "yes" ? "Admission fee" : poi.fee === "no" ? "Free" : poi.fee}</p>}
            {poi.openingHours && <p>🕐 {poi.openingHours}</p>}
            {poi.phoneNumber && <p>📞 {poi.phoneNumber}</p>}
            {poi.inceptionYear && <p>📅 Est. {poi.inceptionYear}</p>}
          </div>
        )}

        {/* Add to Day Plan */}
        <DayPlanAssigner poiId={poi.id} poiName={poi.name} dayPlans={dayPlans} />

        {/* Footer links */}
        <div className="mt-auto flex items-center gap-3 flex-wrap border-t border-[hsl(var(--border))] pt-2">
          {/* Favourite button — always visible, especially important on mobile */}
          <button
            type="button"
            onClick={() => onFavourite(poi)}
            title={isFavourited ? "Already in favourites" : "Add to favourites"}
            className={`flex items-center gap-1 text-xs font-medium transition-colors ${
              isFavourited
                ? "text-pink-500"
                : "text-[hsl(var(--muted-foreground))] hover:text-pink-500"
            }`}
          >
            <HeartIcon filled={isFavourited} className="h-3.5 w-3.5" />
            <span className="sm:hidden">{isFavourited ? "Saved" : "Save"}</span>
          </button>
          {hasCoords && (
            <button
              type="button"
              onClick={() => onViewOnMap(poi.id)}
              className="text-xs font-medium text-[hsl(var(--primary))] hover:underline"
            >
              🗺️ View on map
            </button>
          )}
          {hasCoords && (
            <a
              href={googleMapsUrl(poi.name, poi.latitude!, poi.longitude!)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-[hsl(var(--primary))] hover:underline"
            >
              📍 Google Maps
            </a>
          )}
          {poi.website && (
            <a
              href={poi.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-[hsl(var(--primary))] hover:underline"
            >
              🔗 Website
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CompactPoiCard ───────────────────────────────────────────────────────────

function CompactPoiCard({
  poi,
  onDelete,
  onViewOnMap,
  deletingId,
  isAssigned,
  isVisited,
  onToggleVisited,
  userRating,
  isNotInterested,
  onRate,
  onToggleNotInterested,
  onFavourite,
  isFavourited,
  dayPlans,
}: {
  poi: PoiDTO;
  onDelete: (poi: PoiDTO) => void;
  onViewOnMap: (poiId: number) => void;
  deletingId: number | null;
  isAssigned: boolean;
  isVisited: boolean;
  onToggleVisited: (poiId: number) => void;
  userRating?: number;
  isNotInterested?: boolean;
  onRate: (id: number, r: number | null) => void;
  onToggleNotInterested: (id: number) => void;
  onFavourite: (poi: PoiDTO) => void;
  isFavourited: boolean;
  dayPlans: DayPlanOption[];
}) {
  const [open, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const hasCoords = poi.latitude != null && poi.longitude != null;
  const isDeleting = deletingId === poi.id;
  const PRICE_LABELS: Record<number, string> = { 0: "Free", 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };
  const hasDetails = poi.openingHours || poi.phoneNumber || poi.inceptionYear || poi.fee;

  return (
    <div className={`group relative rounded-lg border transition-shadow hover:shadow-md ${isAssigned ? "bg-[hsl(var(--card))]/80 ring-1 ring-green-300" : "bg-[hsl(var(--card))]"} ${userRating != null ? "border-[hsl(var(--primary))]" : "border-[hsl(var(--border))]"}`}>
      {/* Status indicators — left side */}
      <div className="absolute left-2 top-2.5 z-10 flex items-center gap-1">
        {isAssigned && (
          <span title="Assigned to daily plan" className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white shadow-sm text-[9px]">✓</span>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleVisited(poi.id); }}
          title={isVisited ? "Visited — click to unmark" : "Mark as visited"}
          className={`flex h-4 w-4 items-center justify-center rounded-full shadow-sm text-[9px] transition-colors ${
            isVisited ? "bg-blue-500 text-white" : "bg-white/80 text-gray-400 border border-gray-200 hover:border-blue-300 hover:text-blue-500"
          }`}
        >
          {isVisited ? "👁" : "○"}
        </button>
      </div>

      {/* Compact header — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-2.5 pl-12 text-left"
      >
        {/* Thumbnail */}
        {poi.photoUrl && !imgError ? (
          <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={poi.photoUrl} alt="" className="h-full w-full object-cover" onError={() => setImgError(true)} />
          </div>
        ) : (
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-[hsl(var(--muted))] text-lg">
            {CATEGORY_ICONS[poi.category]}
          </span>
        )}

        {/* Name + inline badges */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-medium text-sm">{poi.name}</span>
          {poi.rating != null && (
            <span className="flex items-center gap-1 flex-shrink-0">
              <span className="text-xs text-amber-600">⭐ {poi.rating.toFixed(1)}</span>
              {poi.userRatingCount != null && (
                <span className="text-xs text-slate-400">({formatReviewCount(poi.userRatingCount)})</span>
              )}
            </span>
          )}
          {poi.priceLevel != null && (
            <span className="flex-shrink-0 text-xs text-emerald-600">{PRICE_LABELS[poi.priceLevel]}</span>
          )}
          {poi.isUnescoSite && (
            <span className="flex-shrink-0 text-[10px] font-bold text-blue-600">UNESCO</span>
          )}
        </div>

        {/* Category badge */}
        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${CATEGORY_STYLES[poi.category].badge}`}>
          {CATEGORY_LABELS[poi.category]}
        </span>

        {/* Favourite heart — always visible, tap-friendly for mobile */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onFavourite(poi); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onFavourite(poi); } }}
          title={isFavourited ? "Already in favourites" : "Add to favourites"}
          className={`flex-shrink-0 p-1 transition-colors ${isFavourited ? "text-pink-500" : "text-gray-300 hover:text-pink-400"}`}
        >
          <HeartIcon filled={isFavourited} className="h-4 w-4" />
        </span>

        {/* Expand chevron */}
        <span className={`flex-shrink-0 text-xs text-[hsl(var(--muted-foreground))] transition-transform ${open ? "rotate-180" : ""}`}>
          ▼
        </span>
      </button>

      {/* Expanded details */}
      {open && (
        <div className="border-t border-[hsl(var(--border))] px-3 py-2.5 space-y-2 text-sm">
          {poi.description && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">{poi.description}</p>
          )}

          {poi.tips && (
            <p className="rounded-md bg-amber-50 border border-amber-100 px-2.5 py-1.5 text-xs text-amber-800">
              💡 {poi.tips}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              title={isFavourited ? "Already in favourites" : "Add to favourites"}
              onClick={(e) => { e.stopPropagation(); onFavourite(poi); }}
              className={`rounded-full p-1 transition-colors ${isFavourited ? "text-red-500" : "text-[hsl(var(--muted-foreground))] hover:text-red-400"}`}
            >
              <HeartIcon filled={isFavourited} className="h-4 w-4" />
            </button>
            <StarRating
              poiId={poi.id}
              rating={userRating}
              notInterested={isNotInterested}
              onRate={onRate}
              onToggleNotInterested={onToggleNotInterested}
              onDelete={() => onDelete(poi)}
              isDeleting={isDeleting}
            />
          </div>

          {hasDetails && (
            <div className="rounded-md bg-slate-50 border border-slate-100 px-2.5 py-1.5 text-xs text-slate-700 space-y-0.5">
              {poi.fee && <p>🎫 {poi.fee === "yes" ? "Admission fee required" : poi.fee === "no" ? "Free admission" : poi.fee}</p>}
              {poi.openingHours && <p>🕐 {poi.openingHours}</p>}
              {poi.phoneNumber && <p>📞 {poi.phoneNumber}</p>}
              {poi.inceptionYear && <p>📅 Est. {poi.inceptionYear}</p>}
            </div>
          )}

          <DayPlanAssigner poiId={poi.id} poiName={poi.name} dayPlans={dayPlans} />

          <div className="flex items-center gap-3 flex-wrap pt-1">
            {/* Favourite button — visible on mobile without needing to find it in overlays */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onFavourite(poi); }}
              title={isFavourited ? "Already in favourites" : "Add to favourites"}
              className={`flex items-center gap-1 text-xs font-medium transition-colors ${
                isFavourited
                  ? "text-pink-500"
                  : "text-[hsl(var(--muted-foreground))] hover:text-pink-500"
              }`}
            >
              <HeartIcon filled={isFavourited} className="h-3.5 w-3.5" />
              {isFavourited ? "Saved" : "Save"}
            </button>
            {hasCoords && (
              <button type="button" onClick={() => onViewOnMap(poi.id)} className="text-xs font-medium text-[hsl(var(--primary))] hover:underline">
                🗺️ View on map
              </button>
            )}
            {hasCoords && (
              <a
                href={googleMapsUrl(poi.name, poi.latitude!, poi.longitude!)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-[hsl(var(--primary))] hover:underline"
              >
                📍 Google Maps
              </a>
            )}
            {poi.website && (
              <a href={poi.website} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-[hsl(var(--primary))] hover:underline">
                🔗 Website
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sort / Status types & options (module-level so dropdowns can use them) ───

type SortKey = "name" | "category" | "rating" | "price" | "my_rating" | "reviews";
type StatusFilter = "assigned" | "unassigned" | "visited" | "unvisited" | "not_interested" | "hide_not_interested";

const SORT_OPTIONS: { key: SortKey; label: string; emoji: string }[] = [
  { key: "rating",             label: "Rating ↓",    emoji: "⭐" },
  { key: "my_rating",          label: "My rating ↓", emoji: "🌟" },
  { key: "reviews",            label: "Reviews ↓",   emoji: "💬" },
  { key: "price",              label: "Price ↑",     emoji: "💰" },
  { key: "category",           label: "Category",    emoji: "🏷" },
  { key: "name",               label: "Name A→Z",    emoji: "🔤" },
];

const STATUS_OPTIONS: { key: StatusFilter; label: string; emoji: string }[] = [
  { key: "assigned",           label: "Assigned",       emoji: "✓" },
  { key: "unassigned",         label: "Unassigned",     emoji: "○" },
  { key: "visited",            label: "Visited",        emoji: "👁" },
  { key: "unvisited",          label: "Unvisited",      emoji: "○" },
  { key: "not_interested",     label: "Not interested", emoji: "🚫" },
  { key: "hide_not_interested",label: "Hide N/A",       emoji: "🙈" },
];

// ─── SortDropdown ─────────────────────────────────────────────────────────────

function SortDropdown({ sortBy, onToggle }: { sortBy: SortKey[]; onToggle: (k: SortKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const activeLabels = SORT_OPTIONS
    .filter((o) => sortBy.includes(o.key))
    .map((o) => `${o.emoji} ${o.label}`);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1.5 text-xs font-medium hover:bg-[hsl(var(--muted))]"
        style={{ minWidth: 120, maxWidth: 220 }}
      >
        <span className="shrink-0 text-[hsl(var(--muted-foreground))]">Sort:</span>
        <span className="flex-1 truncate text-left">{activeLabels.join(", ")}</span>
        <span className="shrink-0 text-[hsl(var(--muted-foreground))]">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg py-1">
          {SORT_OPTIONS.map(({ key, label, emoji }) => {
            const idx = sortBy.indexOf(key);
            const active = idx !== -1;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onToggle(key)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[hsl(var(--muted))] text-left"
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold ${
                  active
                    ? "bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "border-[hsl(var(--border))]"
                }`}>
                  {active ? (sortBy.length > 1 ? String(idx + 1) : "✓") : ""}
                </span>
                {emoji} {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── StatusDropdown ───────────────────────────────────────────────────────────

function StatusDropdown({ active, onToggle }: { active: Set<StatusFilter>; onToggle: (f: StatusFilter) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const label =
    active.size === 0
      ? "All"
      : STATUS_OPTIONS.filter((o) => active.has(o.key)).map((o) => o.label).join(", ");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1.5 text-xs font-medium hover:bg-[hsl(var(--muted))]"
        style={{ minWidth: 120, maxWidth: 240 }}
      >
        <span className="shrink-0 text-[hsl(var(--muted-foreground))]">Status:</span>
        <span className="flex-1 truncate text-left">{label}</span>
        {active.size > 0 && (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-[9px] font-bold">
            {active.size}
          </span>
        )}
        <span className="shrink-0 text-[hsl(var(--muted-foreground))]">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg py-1">
          {STATUS_OPTIONS.map(({ key, label: optLabel, emoji }) => {
            const isActive = active.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onToggle(key)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-[hsl(var(--muted))] text-left"
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold ${
                  isActive
                    ? "bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "border-[hsl(var(--border))]"
                }`}>
                  {isActive ? "✓" : ""}
                </span>
                {emoji} {optLabel}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── PoisSection ──────────────────────────────────────────────────────────────

export function PoisSection({
  cityId,
  pois,
  dayPlans,
  cityLat,
  cityLon,
  radiusKm,
  nearbyRadiusKm,
  cityName,
  country,
  favouriteItems,
  initialUserRatings,
  initialNotInterested,
  initialVisitedPoiIds,
  dayNotes,
}: {
  cityId: number;
  pois: PoiDTO[];
  dayPlans: DayPlanDTO[];
  cityLat?: number;
  cityLon?: number;
  radiusKm?: number;
  nearbyRadiusKm?: number;
  cityName?: string;
  country?: string;
  favouriteItems?: FavouriteItemDTO[];
  initialUserRatings?: Record<number, number>;
  initialNotInterested?: number[];
  initialVisitedPoiIds?: number[];
  dayNotes?: Record<number, { id: number; content: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<View>("map");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("CULTURE");
  const [addSubcategory, setAddSubcategory] = useState("");
  const [description, setDescription] = useState("");
  const [addLat, setAddLat] = useState("");
  const [addLng, setAddLng] = useState("");
  const [coordsInput, setCoordsInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { showAddModal, favouritedPlaceIds, favouritedNameCityKeys, setCurrentCity, refreshLists } = useFavourites();

  const isPoiFavourited = useCallback((poi: PoiDTO) => {
    if (poi.placeId && favouritedPlaceIds.has(poi.placeId)) return true;
    if (poi.name && cityName) {
      return favouritedNameCityKeys.has(`${poi.name.toLowerCase()}|${cityName.toLowerCase()}`);
    }
    return false;
  }, [favouritedPlaceIds, favouritedNameCityKeys, cityName]);

  const handleFavourite = useCallback((poi: PoiDTO) => {
    showAddModal({
      name: poi.name,
      category: poi.category,
      subcategory: poi.subcategory ?? undefined,
      country: country ?? "",
      city: cityName ?? "",
      latitude: poi.latitude ?? undefined,
      longitude: poi.longitude ?? undefined,
      description: poi.description ?? undefined,
      photoUrl: poi.photoUrl ?? undefined,
      website: poi.website ?? undefined,
      sourcePlaceId: poi.placeId ?? undefined,
    });
  }, [showAddModal, country, cityName]);

  // Mapbox place/address search for "add POI manually"
  const [mapboxQuery, setMapboxQuery] = useState("");
  const [mapboxSuggestions, setMapboxSuggestions] = useState<Array<{ id: string; place_name: string; text: string; center: [number, number] }>>([]);
  const [mapboxOpen, setMapboxOpen] = useState(false);
  const mapboxDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [focusPoiId, setFocusPoiId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [listLayout, setListLayout] = useState<ListLayout>("grid");
  const [scrollToActivity, setScrollToActivity] = useState<{ date: string; activityId: number } | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    if (view !== "list" || focusPoiId == null) return;
    const el = document.querySelector(`[data-poi-id="${focusPoiId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [view, focusPoiId]);

  // Listen for "focus-poi-on-map" events from ActivityRecommendations
  useEffect(() => {
    function handleFocusPoi(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.poiId) {
        setView("map");
        setFocusPoiId(detail.poiId);
        // Scroll the POIs section into view
        document.getElementById("pois-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    window.addEventListener("focus-poi-on-map", handleFocusPoi);
    return () => window.removeEventListener("focus-poi-on-map", handleFocusPoi);
  }, []);

  // Live day plans — single source of truth, shared with DailyPlan and TimelineSidebar
  const [liveDayPlans, setLiveDayPlans] = useState(dayPlans);
  useEffect(() => { setLiveDayPlans(dayPlans); }, [dayPlans]);

  // DayPlanOption list for cards and map
  const dayPlanOptions = useMemo<DayPlanOption[]>(
    () => liveDayPlans.map((dp) => ({
      id: dp.id,
      label: new Date(dp.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    })),
    [liveDayPlans],
  );

  // Set current city context for favourites panel "Add to Day Plan"
  useEffect(() => {
    if (cityName) {
      setCurrentCity({
        id: cityId,
        name: cityName,
        country,
        dayPlans: dayPlanOptions,
      });
    }
    return () => setCurrentCity(null);
  }, [cityId, cityName, country, dayPlanOptions, setCurrentCity]);

  // Called by PoiMap after focusPoiId flyTo so parent clears it
  const handleFocusConsumed = useCallback(() => setFocusPoiId(null), []);

  // Assigned POI IDs (derived from day plans)
  const assignedPoiIds = useMemo(() => {
    const ids = new Set<number>();
    for (const dp of liveDayPlans) {
      for (const a of dp.activities) ids.add(a.poiId);
    }
    return ids;
  }, [liveDayPlans]);

  // Visited POI IDs (persisted in database via PoiRating)
  const [visitedIds, setVisitedIds] = useState<Set<number>>(
    () => new Set(initialVisitedPoiIds ?? []),
  );

  // One-time migration: move localStorage visited to database
  useEffect(() => {
    const migKey = `visited-migrated-${cityId}`;
    if (typeof window === "undefined" || localStorage.getItem(migKey)) return;
    const stored = localStorage.getItem(`visited-pois-${cityId}`);
    if (!stored) { localStorage.setItem(migKey, "1"); return; }
    try {
      const ids: number[] = JSON.parse(stored);
      if (ids.length === 0) { localStorage.setItem(migKey, "1"); return; }
      // Migrate each visited POI to the database
      Promise.all(
        ids.map((id) =>
          fetch(`/api/pois/${id}/rating`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ visited: true }),
          }).catch(() => {})
        )
      ).then(() => {
        localStorage.setItem(migKey, "1");
        localStorage.removeItem(`visited-pois-${cityId}`);
        setVisitedIds((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.add(id);
          return next;
        });
      });
    } catch { localStorage.setItem(migKey, "1"); }
  }, [cityId]);

  const toggleVisited = useCallback((poiId: number) => {
    setVisitedIds((prev) => {
      const next = new Set(prev);
      const newVal = !next.has(poiId);
      if (newVal) next.add(poiId); else next.delete(poiId);
      // Persist to database (also syncs to matching FavouriteItems)
      fetch(`/api/pois/${poiId}/rating`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visited: newVal }),
      }).then(() => refreshLists()).catch(() => {});
      return next;
    });
  }, [refreshLists]);

  type UserRating = 1 | 2 | 3 | 4 | 5;
  const [userRatings, setUserRatingsState] = useState<Record<number, UserRating>>(
    () => (initialUserRatings ?? {}) as Record<number, UserRating>,
  );
  const [notInterested, setNotInterestedState] = useState<Set<number>>(
    () => new Set(initialNotInterested ?? []),
  );

  // One-time migration from localStorage to database
  useEffect(() => {
    const migrationKey = `ratings-migrated-${cityId}`;
    if (localStorage.getItem(migrationKey)) return;

    const storedRatings = localStorage.getItem(`user-ratings-${cityId}`);
    const storedNI = localStorage.getItem(`not-interested-${cityId}`);
    if (!storedRatings && !storedNI) {
      localStorage.setItem(migrationKey, "1");
      return;
    }

    const ratings = storedRatings ? JSON.parse(storedRatings) : {};
    const ni = storedNI ? JSON.parse(storedNI) : [];

    fetch(`/api/cities/${cityId}/ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ratings, notInterested: ni }),
    }).then((res) => {
      if (res.ok) {
        localStorage.setItem(migrationKey, "1");
        localStorage.removeItem(`user-ratings-${cityId}`);
        localStorage.removeItem(`not-interested-${cityId}`);
        // Merge migrated data into current state
        const parsed = ratings as Record<string, number>;
        setUserRatingsState((prev) => {
          const next = { ...prev };
          for (const [k, v] of Object.entries(parsed)) {
            if (!(Number(k) in next)) next[Number(k)] = v as UserRating;
          }
          return next;
        });
        setNotInterestedState((prev) => {
          const next = new Set(prev);
          for (const id of ni) next.add(id);
          return next;
        });
      }
    }).catch(() => { /* silent */ });
  }, [cityId]);

  const setUserRating = useCallback((poiId: number, rating: number | null) => {
    setUserRatingsState((prev) => {
      const next = { ...prev };
      if (rating === null) delete next[poiId]; else next[poiId] = rating as UserRating;
      return next;
    });
    // Persist to database (also syncs to matching FavouriteItems)
    fetch(`/api/pois/${poiId}/rating`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    }).then(() => refreshLists()).catch(() => {});
  }, [refreshLists]);

  const toggleNotInterested = useCallback((poiId: number) => {
    setNotInterestedState((prev) => {
      const next = new Set(prev);
      const newVal = !next.has(poiId);
      if (newVal) next.add(poiId); else next.delete(poiId);
      // Persist to database
      fetch(`/api/pois/${poiId}/rating`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notInterested: newVal }),
      }).catch(() => { /* silent */ });
      return next;
    });
  }, []);

  // Listen for rating/visited/category changes from the favourites panel
  useEffect(() => {
    function handleFavSync(e: Event) {
      const detail = (e as CustomEvent).detail ?? {};

      // New favourite added → auto-POI was created server-side, refresh to pick it up
      if (detail.newFavourite) {
        router.refresh();
        return;
      }

      const { name, city, sourcePlaceId, rating, visited, category, subcategory } = detail;
      // Find matching POI(s) by sourcePlaceId or name+city
      for (const poi of pois) {
        const matches =
          (sourcePlaceId && poi.placeId === sourcePlaceId) ||
          (name && city && poi.name.toLowerCase() === name.toLowerCase() && cityName?.toLowerCase() === city.toLowerCase());
        if (!matches) continue;
        if (rating !== undefined) {
          setUserRatingsState((prev) => {
            const next = { ...prev };
            if (rating === null) delete next[poi.id];
            else next[poi.id] = rating as UserRating;
            return next;
          });
        }
        if (visited !== undefined) {
          setVisitedIds((prev) => {
            const next = new Set(prev);
            if (visited) next.add(poi.id); else next.delete(poi.id);
            return next;
          });
        }
        // Category/subcategory changes need a page refresh (POIs come from server props)
        if (category !== undefined || subcategory !== undefined) {
          router.refresh();
          return; // refresh will reload all data
        }
      }
    }
    window.addEventListener("favourite-sync", handleFavSync);
    return () => window.removeEventListener("favourite-sync", handleFavSync);
  }, [pois, cityName, router]);

  const [sortBy, setSortBy] = useState<SortKey[]>(["rating"]);

  function toggleSort(key: SortKey) {
    setSortBy((prev) => {
      if (prev.includes(key)) {
        const next = prev.filter((k) => k !== key);
        return next.length > 0 ? next : prev; // keep at least one active
      }
      return [...prev, key];
    });
  }

  // Filter state — applies to list + map views only.
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    () => new Set(CATEGORIES),
  );
  const [search, setSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<Set<StatusFilter>>(new Set());

  function toggleStatusFilter(f: StatusFilter) {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  }

  function toggleCategory(c: Category) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }
  // Tracks subcategories the user has explicitly deselected (opt-out model).
  // Empty = show all; non-empty = hide those subcategories.
  const [excludedSubcategories, setExcludedSubcategories] = useState<Set<string>>(() => new Set());

  function toggleSubcategory(id: string) {
    setExcludedSubcategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setActiveCategories(new Set(CATEGORIES));
    setSearch("");
    setStatusFilters(new Set());
    setExcludedSubcategories(new Set());
  }
  const allCategoriesSelected = activeCategories.size === CATEGORIES.length;
  const hasFilters = !allCategoriesSelected || search.trim().length > 0 || statusFilters.size > 0 || excludedSubcategories.size > 0;
  const searchLower = search.trim().toLowerCase();
  const filteredPois = pois.filter((p) => {
    if (!activeCategories.has(p.category)) return false;
    if (searchLower !== "" && !p.name.toLowerCase().includes(searchLower)) return false;
    if (excludedSubcategories.size > 0 && excludedSubcategories.has(p.subcategory ?? "__none__")) return false;
    // Every active status filter must be satisfied (AND logic across filters)
    for (const f of statusFilters) {
      if (f === "assigned"            && !assignedPoiIds.has(p.id))  return false;
      if (f === "unassigned"          &&  assignedPoiIds.has(p.id))  return false;
      if (f === "visited"             && !visitedIds.has(p.id))      return false;
      if (f === "unvisited"           &&  visitedIds.has(p.id))      return false;
      if (f === "not_interested"      && !notInterested.has(p.id))   return false;
      if (f === "hide_not_interested" &&  notInterested.has(p.id))   return false;
    }
    return true;
  });

  const sortedPois = [...filteredPois].sort((a, b) => {
    // Not interested always last
    const aNI = notInterested.has(a.id);
    const bNI = notInterested.has(b.id);
    if (aNI !== bNI) return aNI ? 1 : -1;

    // Apply selected sort keys in order; first non-zero result wins
    for (const key of sortBy) {
      let cmp = 0;
      if (key === "my_rating") {
        const aR = userRatings[a.id];
        const bR = userRatings[b.id];
        // Rated POIs float before unrated
        if ((aR != null) !== (bR != null)) cmp = aR != null ? -1 : 1;
        else if (aR != null && bR != null) cmp = bR - aR;
        // Both unrated → cmp stays 0, fall through to next key
      } else {
        switch (key) {
          case "rating":   cmp = (b.rating ?? 0) - (a.rating ?? 0); break;
          case "reviews":  cmp = (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0); break;
          case "price":    cmp = (a.priceLevel ?? 99) - (b.priceLevel ?? 99); break;
          case "category": cmp = a.category.localeCompare(b.category); break;
          case "name":     cmp = a.name.localeCompare(b.name); break;
        }
      }
      if (cmp !== 0) return cmp;
    }
    return 0;
  });

  function handleMapboxSearch(query: string) {
    setMapboxQuery(query);
    if (mapboxDebounceRef.current) clearTimeout(mapboxDebounceRef.current);
    if (query.trim().length < 2) {
      setMapboxSuggestions([]);
      setMapboxOpen(false);
      return;
    }
    mapboxDebounceRef.current = setTimeout(async () => {
      try {
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        if (!token) return;
        const proximity =
          cityLat != null && cityLon != null
            ? `&proximity=${cityLon},${cityLat}`
            : "";
        const url =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query.trim())}.json` +
          `?types=poi,address,place&limit=5${proximity}&access_token=${token}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json() as { features?: Array<{ id: string; place_name: string; text: string; center: [number, number] }> };
        const features = data.features ?? [];
        setMapboxSuggestions(features);
        setMapboxOpen(features.length > 0);
      } catch { /* ignore */ }
    }, 300);
  }

  function selectMapboxSuggestion(feature: { id: string; place_name: string; text: string; center: [number, number] }) {
    const [lon, lat] = feature.center;
    setName(feature.text);
    setAddLat(lat.toFixed(6));
    setAddLng(lon.toFixed(6));
    setCoordsInput(`${lat.toFixed(6)}, ${lon.toFixed(6)}`);
    setMapboxQuery(feature.place_name);
    setMapboxSuggestions([]);
    setMapboxOpen(false);
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const lat = addLat.trim() ? parseFloat(addLat) : undefined;
    const lng = addLng.trim() ? parseFloat(addLng) : undefined;
    const res = await fetch(`/api/cities/${cityId}/pois`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        category,
        subcategory: addSubcategory || undefined,
        description,
        latitude: lat && !isNaN(lat) ? lat : undefined,
        longitude: lng && !isNaN(lng) ? lng : undefined,
      }),
    });
    if (!res.ok) {
      setError("Failed to add POI");
      setSubmitting(false);
      return;
    }
    setName("");
    setCategory("CULTURE");
    setAddSubcategory("");
    setDescription("");
    setAddLat("");
    setAddLng("");
    setCoordsInput("");
    setMapboxQuery("");
    setMapboxSuggestions([]);
    setSubmitting(false);
    setAddOpen(false);
    router.refresh();
  }

  function handleAddAtLocation(lat: number, lng: number) {
    const latStr = lat.toFixed(6);
    const lngStr = lng.toFixed(6);
    setAddLat(latStr);
    setAddLng(lngStr);
    setCoordsInput(`${latStr}, ${lngStr}`);
    setAddOpen(true);
  }

  async function onDelete(poi: PoiDTO) {
    const ok = await confirm({
      title: "Delete POI?",
      message: `Remove "${poi.name}" from this city?`,
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(poi.id);
    const res = await fetch(`/api/pois/${poi.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) {
      toast("Failed to delete POI", { variant: "error" });
      return;
    }
    router.refresh();
  }

  async function onClearAll() {
    const ok = await confirm({
      title: "Clear all POIs?",
      message: `Remove all ${pois.length} POIs from this city? Cached discovery data will be kept so you can re-discover quickly.`,
      confirmText: "Clear all",
      variant: "destructive",
    });
    if (!ok) return;
    setClearingAll(true);
    const res = await fetch(`/api/cities/${cityId}/pois`, { method: "DELETE" });
    setClearingAll(false);
    if (!res.ok) {
      toast("Failed to clear POIs", { variant: "error" });
      return;
    }
    router.refresh();
  }

  const hasActivities = liveDayPlans.some((dp) => dp.activities.length > 0);

  return (
    <div className={hasActivities ? "grid gap-6 lg:grid-cols-[19fr_4fr]" : ""}>
      <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-3">
          <CardTitle>Points of interest</CardTitle>
          {pois.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={clearingAll}
              onClick={onClearAll}
              className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              {clearingAll ? <span className="spinner mr-1" /> : null}
              {clearingAll ? "Clearing…" : "Clear all"}
            </Button>
          )}
        </div>
        <div
          role="tablist"
          className="inline-flex rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-1 gap-0.5"
        >
          {(
            [
              ["map", "🗺️", "Map"],
              ["list", "📋", "List"],
              ["plan", "📅", "Plan"],
            ] as const
          ).map(([key, icon, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                view === key
                  ? "bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm"
                  : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              }`}
            >
              <span className="text-xs">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {view !== "plan" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search POIs by name…"
                className="max-w-xs"
              />
              {hasFilters && (
                <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
              {hasFilters && (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {filteredPois.length} of {pois.length}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (allCategoriesSelected) {
                    setActiveCategories(new Set());
                  } else {
                    setActiveCategories(new Set(CATEGORIES));
                  }
                }}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                  allCategoriesSelected
                    ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                All ({pois.length})
              </button>
              {CATEGORIES.map((c) => {
                const active = activeCategories.has(c);
                const count = pois.filter((p) => p.category === c).length;
                if (count === 0) return null;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleCategory(c)}
                    aria-pressed={active}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition ${
                      active
                        ? `${CATEGORY_STYLES[c].badge} ring-2 ring-offset-1 ring-[hsl(var(--ring))]`
                        : `${CATEGORY_STYLES[c].badge} opacity-50 hover:opacity-100`
                    }`}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_STYLES[c].dot }} />
                    {CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]} ({count})
                  </button>
                );
              })}
            </div>
            {/* Subcategory chips — only shown when there are subcategories to show */}
            {(() => {
              // Collect subcategory defs for active categories that have POIs
              const subDefs: { id: string; label: string; emoji: string; cat: Category }[] = [];
              for (const cat of CATEGORIES) {
                if (!activeCategories.has(cat)) continue;
                const catPois = pois.filter(p => p.category === cat && p.subcategory);
                if (catPois.length === 0) continue;
                const presentSubs = new Set(catPois.map(p => p.subcategory!));
                for (const def of SUBCATEGORIES[cat as keyof typeof SUBCATEGORIES] ?? []) {
                  if (presentSubs.has(def.id)) subDefs.push({ ...def, cat });
                }
              }
              if (subDefs.length === 0) return null;
              const allActive = excludedSubcategories.size === 0;
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">Subcategory:</span>
                  {/* "All" pill — active when nothing is excluded */}
                  <button
                    type="button"
                    onClick={() => setExcludedSubcategories(new Set())}
                    aria-pressed={allActive}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition border ${
                      allActive
                        ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))]"
                        : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                    }`}
                  >
                    All
                  </button>
                  {subDefs.map(({ id, label, emoji }) => {
                    // Active (coloured) = not excluded; clicking excludes it
                    const active = !excludedSubcategories.has(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleSubcategory(id)}
                        aria-pressed={active}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition border ${
                          active
                            ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))]"
                            : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                        }`}
                      >
                        {emoji} {label}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {view === "map" ? (
          <div className="space-y-2">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              💡 Right-click anywhere on the map to drop a pin and add a POI at that location.
            </p>
            <div className="relative min-h-[500px] lg:min-h-[600px]">
              <PoiMap
                pois={filteredPois}
                cityId={cityId}
                cityLat={cityLat}
                cityLon={cityLon}
                radiusKm={radiusKm}
                nearbyRadiusKm={nearbyRadiusKm}
                dayPlans={dayPlanOptions}
                focusPoiId={focusPoiId}
                onFocusConsumed={handleFocusConsumed}
                onAddAtLocation={handleAddAtLocation}
                onViewInList={(poiId) => { setFocusPoiId(poiId); setView("list"); }}
                userRatings={userRatings}
                notInterested={notInterested}
                onRatePoi={setUserRating}
                onToggleNotInterested={toggleNotInterested}
                favouriteItems={favouriteItems}
                onFavourite={(poi) => handleFavourite(poi as PoiDTO)}
                isPoiFavourited={(poi) => isPoiFavourited(poi as PoiDTO)}
              />
            </div>
          </div>
        ) : view === "plan" ? (
          <DailyPlan cityId={cityId} pois={pois} dayPlans={liveDayPlans} setDayPlans={setLiveDayPlans} scrollToActivity={scrollToActivity} onScrollComplete={() => setScrollToActivity(null)} dayNotes={dayNotes} />
        ) : pois.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">No POIs yet.</p>
        ) : (
          <div className="space-y-3">
            {/* Controls — always visible even when filters yield no results */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <SortDropdown sortBy={sortBy} onToggle={toggleSort} />
                <StatusDropdown active={statusFilters} onToggle={toggleStatusFilter} />
              </div>
              <div className="inline-flex rounded-md border border-[hsl(var(--border))] p-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setListLayout("grid")}
                  aria-label="Grid view"
                  className={`rounded px-2 py-1 text-xs ${
                    listLayout === "grid"
                      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                      : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                </button>
                <button
                  type="button"
                  onClick={() => setListLayout("compact")}
                  aria-label="Compact view"
                  className={`rounded px-2 py-1 text-xs ${
                    listLayout === "compact"
                      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                      : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
              </div>
            </div>

            {filteredPois.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">No POIs match the current filters.</p>
            ) : listLayout === "compact" ? (
              <div className="space-y-1.5">
                {sortedPois.map((poi) => (
                  <CompactPoiCard
                    key={poi.id}
                    poi={poi}
                    onDelete={onDelete}
                    onViewOnMap={(id) => { setFocusPoiId(id); setView("map"); }}
                    deletingId={deletingId}
                    isAssigned={assignedPoiIds.has(poi.id)}
                    isVisited={visitedIds.has(poi.id)}
                    onToggleVisited={toggleVisited}
                    userRating={userRatings[poi.id]}
                    isNotInterested={notInterested.has(poi.id)}
                    onRate={setUserRating}
                    onToggleNotInterested={toggleNotInterested}
                    onFavourite={handleFavourite}
                    isFavourited={isPoiFavourited(poi)}
                    dayPlans={dayPlanOptions}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {sortedPois.map((poi) => (
                  <PoiCard
                    key={poi.id}
                    poi={poi}
                    onDelete={onDelete}
                    onViewOnMap={(id) => { setFocusPoiId(id); setView("map"); }}
                    onOpenLightbox={(src, alt) => setLightbox({ src, alt })}
                    deletingId={deletingId}
                    isAssigned={assignedPoiIds.has(poi.id)}
                    isVisited={visitedIds.has(poi.id)}
                    onToggleVisited={toggleVisited}
                    userRating={userRatings[poi.id]}
                    isNotInterested={notInterested.has(poi.id)}
                    onRate={setUserRating}
                    onToggleNotInterested={toggleNotInterested}
                    onFavourite={handleFavourite}
                    isFavourited={isPoiFavourited(poi)}
                    dayPlans={dayPlanOptions}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Add POI Modal — triggered by right-click on map → "Add POI at this location" */}
        {addOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={() => { setName(""); setCategory("CULTURE"); setAddSubcategory(""); setDescription(""); setAddLat(""); setAddLng(""); setCoordsInput(""); setMapboxQuery(""); setMapboxSuggestions([]); setError(null); setAddOpen(false); }} />
            <div className="relative z-10 mx-4 w-full max-w-lg rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">Add POI</h3>
                <button
                  onClick={() => { setName(""); setCategory("CULTURE"); setAddSubcategory(""); setDescription(""); setAddLat(""); setAddLng(""); setCoordsInput(""); setMapboxQuery(""); setMapboxSuggestions([]); setError(null); setAddOpen(false); }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={onAdd} className="space-y-4">
                {/* Mapbox place/address search */}
                <div className="space-y-2">
                  <Label htmlFor="poi-place-search">Search by name or address</Label>
                  <div className="relative">
                    <Input
                      id="poi-place-search"
                      type="text"
                      value={mapboxQuery}
                      onChange={(e) => handleMapboxSearch(e.target.value)}
                      onFocus={() => mapboxSuggestions.length > 0 && setMapboxOpen(true)}
                      onBlur={() => setTimeout(() => setMapboxOpen(false), 150)}
                      placeholder="e.g. Colosseum, Piazza Navona, Via Roma 10…"
                      autoComplete="off"
                    />
                    {mapboxOpen && mapboxSuggestions.length > 0 && (
                      <ul className="absolute z-50 mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg overflow-hidden max-h-60 overflow-y-auto">
                        {mapboxSuggestions.map((f) => (
                          <li key={f.id}>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-sm hover:bg-[hsl(var(--muted))] transition-colors"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => selectMapboxSuggestion(f)}
                            >
                              <span className="font-medium">{f.text}</span>
                              <br />
                              <span className="text-xs text-[hsl(var(--muted-foreground))] line-clamp-1">{f.place_name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="poi-name">Name <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">(auto-filled or type manually)</span></Label>
                  <Input
                    id="poi-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Place name"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="poi-category">Category</Label>
                    <select
                      id="poi-category"
                      value={category}
                      onChange={(e) => { setCategory(e.target.value as Category); setAddSubcategory(""); }}
                      className="flex h-10 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="poi-subcategory">Subcategory <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">(optional)</span></Label>
                    <select
                      id="poi-subcategory"
                      value={addSubcategory}
                      onChange={(e) => setAddSubcategory(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    >
                      <option value="">— None —</option>
                      {(category === "ACCOMMODATION"
                        ? ACCOMMODATION_SUBCATEGORIES
                        : (SUBCATEGORIES as Record<string, { id: string; label: string; emoji: string }[]>)[category] ?? []
                      ).map((s) => (
                        <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="poi-description">Description</Label>
                  <textarea
                    id="poi-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="flex w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="poi-coords">
                    Coordinates <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">(auto-filled from map click or search)</span>
                  </Label>
                  <Input
                    id="poi-coords"
                    type="text"
                    inputMode="decimal"
                    value={coordsInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCoordsInput(val);
                      const parts = val.split(",").map((s) => s.trim());
                      setAddLat(parts[0] ?? "");
                      setAddLng(parts[1] ?? "");
                    }}
                    placeholder="e.g. 48.8566, 2.3522"
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => { setName(""); setCategory("CULTURE"); setAddSubcategory(""); setDescription(""); setAddLat(""); setAddLng(""); setCoordsInput(""); setMapboxQuery(""); setMapboxSuggestions([]); setError(null); setAddOpen(false); }} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? <><span className="spinner mr-1.5" /> Adding…</> : "Add POI"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    {hasActivities && (
      <aside className="hidden lg:block">
        <TimelineSidebar
          dayPlans={liveDayPlans}
          onActivityClick={(dayDate, activityId) => {
            setScrollToActivity({ date: dayDate, activityId });
            setView("plan");
          }}
        />
      </aside>
    )}
    {lightbox && (
      <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
    )}
    </div>
  );
}
