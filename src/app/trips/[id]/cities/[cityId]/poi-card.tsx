"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES, CATEGORY_STYLES, CATEGORY_LABELS, CATEGORY_ICONS, type Category } from "@/lib/categories";
import { TIME_SLOTS, type TimeSlot } from "@/lib/slots";
import { useToast } from "@/components/ui/toast";
import { resizeImageFile } from "@/lib/resize-image";
import type { DayPlanOption } from "./poi-map";
import type { PoiDTO, ScoreBreakdownDTO, AttachmentDTO } from "./pois-section";
import { AttachmentsSection } from "@/components/ui/attachments-section";

// ─── Utility functions ──────────────────────────────────────────────────────

/** Build a Google Maps URL that resolves to the actual place if found, otherwise falls back to coordinates */
export function googleMapsUrl(name: string, lat: number, lng: number) {
  return `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lng},17z`;
}

/** Photo URL — data URIs returned directly, external URLs proxied through API to handle expired Google Places URLs */
export function poiPhotoSrc(poi: { id: number; photoUrl: string | null }): string | null {
  if (!poi.photoUrl) return null;
  if (poi.photoUrl.startsWith("data:")) return poi.photoUrl;
  return `/api/pois/${poi.id}/photo`;
}

export function formatReviewCount(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

// ─── Score explainer badges ──────────────────────────────────────────────

type ScoreBadge = { emoji: string; label: string; weight: number };

/**
 * Derive the top 2–3 scoring factor badges from the score breakdown.
 * Shows users *why* a place was recommended without exposing raw numbers.
 */
export function getScoreBadges(breakdown: ScoreBreakdownDTO | null | undefined): ScoreBadge[] {
  if (!breakdown) return [];
  const badges: ScoreBadge[] = [];

  // UNESCO is already shown as a photo overlay — skip as badge
  // if (breakdown.unesco > 0) badges.push({ emoji: "🏛", label: "UNESCO", weight: breakdown.unesco });

  if (breakdown.rating >= 24) // ≥80% of max 30
    badges.push({ emoji: "⭐", label: "Highly rated", weight: breakdown.rating });

  if (breakdown.notability >= 15)
    badges.push({ emoji: "📸", label: "Popular", weight: breakdown.notability });

  if (breakdown.proximity >= 12) // within ~3 km
    badges.push({ emoji: "📍", label: "Nearby", weight: breakdown.proximity });

  if (breakdown.hiddenGem > 0)
    badges.push({ emoji: "💎", label: "Hidden gem", weight: breakdown.hiddenGem });

  if (breakdown.categoryMatch >= 10)
    badges.push({ emoji: "🎯", label: "Great match", weight: breakdown.categoryMatch });

  // Return top 3 by weight
  return badges.sort((a, b) => b.weight - a.weight).slice(0, 3);
}

/**
 * Get the "+N more nearby" cluster count from extraFields, if present.
 */
export function getClusterCount(extraFields: Record<string, unknown> | null | undefined): number {
  if (!extraFields) return 0;
  const count = extraFields.nearbyClusterCount;
  return typeof count === "number" ? count : 0;
}

// ─── Drag grip icon SVG ──────────────────────────────────────────────────────

export function DragGripIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="7" y="5" width="3" height="3" rx="1"/>
      <rect x="14" y="5" width="3" height="3" rx="1"/>
      <rect x="7" y="11" width="3" height="3" rx="1"/>
      <rect x="14" y="11" width="3" height="3" rx="1"/>
      <rect x="7" y="17" width="3" height="3" rx="1"/>
      <rect x="14" y="17" width="3" height="3" rx="1"/>
    </svg>
  );
}

// ─── Delete icon SVG ──────────────────────────────────────────────────────────

export function TrashIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
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

// ─── HeartIcon ───────────────────────────────────────────────────────────────

export function HeartIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className ?? "h-3.5 w-3.5"} viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
    </svg>
  );
}

// ─── DayPlanAssigner ──────────────────────────────────────────────────────────

export function DayPlanAssigner({ poiId, poiName, poiCategory, dayPlans }: { poiId: number; poiName: string; poiCategory: Category; dayPlans: DayPlanOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot>("MORNING");
  const [assigning, setAssigning] = useState(false);
  // Multi-day mode for accommodation
  const [selectedDays, setSelectedDays] = useState<Set<number>>(() => new Set());
  const isAccommodation = poiCategory === "ACCOMMODATION";

  if (dayPlans.length === 0) return null;

  function toggleDay(id: number) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAllDays() {
    setSelectedDays(new Set(dayPlans.map((d) => d.id)));
  }

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

  async function assignMulti() {
    if (selectedDays.size === 0) return;
    setAssigning(true);
    const res = await fetch("/api/day-plans/batch-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poiId,
        dayPlanIds: [...selectedDays],
        timeSlot: "EVENING",
      }),
    });
    setAssigning(false);
    if (res.ok) {
      const data = await res.json();
      toast(`${poiName} assigned to ${data.created} day${data.created !== 1 ? "s" : ""}!`);
      setOpen(false);
      setSelectedDays(new Set());
      router.refresh();
    } else {
      toast("Failed to assign", { variant: "error" });
    }
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
          {isAccommodation ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                  🏠 Select days
                </span>
                <button
                  type="button"
                  onClick={selectAllDays}
                  className="text-[10px] text-indigo-500 hover:text-indigo-700"
                >
                  Select all
                </button>
              </div>
              <div className="max-h-[160px] overflow-y-auto space-y-0.5">
                {dayPlans.map((d) => (
                  <label
                    key={d.id}
                    className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-indigo-100/50 dark:hover:bg-indigo-900/20 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDays.has(d.id)}
                      onChange={() => toggleDay(d.id)}
                      disabled={assigning}
                      className="rounded border-indigo-300"
                    />
                    <span>{d.label}</span>
                  </label>
                ))}
              </div>
              {selectedDays.size > 0 && (
                <button
                  type="button"
                  onClick={assignMulti}
                  disabled={assigning}
                  className="w-full rounded bg-indigo-500 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors"
                >
                  {assigning ? "Assigning…" : `Assign to ${selectedDays.size} day${selectedDays.size !== 1 ? "s" : ""}`}
                </button>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── StarRating ───────────────────────────────────────────────────────────────

export function StarRating({
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

export function PoiCard({
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
  onChangeCategory,
  onUploadPhoto,
  onEdit,
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
  onChangeCategory: (poiId: number, cat: Category) => void;
  onUploadPhoto: (poiId: number, dataUri: string) => void;
  onEdit: (poi: PoiDTO) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [hoverStar, setHoverStar] = useState<number | null>(null);
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const hasCoords = poi.latitude != null && poi.longitude != null;
  const isDeleting = deletingId === poi.id;
  const longDesc = (poi.description?.length ?? 0) > 110;
  const PRICE_LABELS: Record<number, string> = { 0: "Free", 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };
  const hasDetails = poi.openingHours || poi.phoneNumber || poi.inceptionYear || poi.fee;
  const photoSrc = poiPhotoSrc(poi);
  const showPhoto = photoSrc && !imgError;
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

        {/* Left strip: category icon (clickable to change) + Google rating */}
        <div className="flex w-12 flex-shrink-0 flex-col items-center justify-start gap-1.5 bg-[hsl(var(--muted))] px-1 py-2.5 relative">
          <button
            type="button"
            title="Change category"
            onClick={() => setCatPickerOpen((v) => !v)}
            className="text-xl leading-none hover:scale-110 transition-transform cursor-pointer"
          >
            {CATEGORY_ICONS[poi.category]}
          </button>
          {catPickerOpen && (
            <div className="absolute top-8 left-0 z-30 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg p-1.5 grid grid-cols-2 gap-1 w-max">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { if (c !== poi.category) onChangeCategory(poi.id, c); setCatPickerOpen(false); }}
                  className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] hover:bg-[hsl(var(--muted))] transition-colors whitespace-nowrap ${c === poi.category ? "bg-[hsl(var(--primary))]/10 font-semibold" : ""}`}
                >
                  <span>{CATEGORY_ICONS[c]}</span>
                  <span>{CATEGORY_LABELS[c]}</span>
                </button>
              ))}
            </div>
          )}
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
          onClick={() => showPhoto && onOpenLightbox(photoSrc!, poi.name)}
        >
          {/* Hidden file input for photo upload */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const dataUri = await resizeImageFile(file, 600);
              onUploadPhoto(poi.id, dataUri);
              if (photoInputRef.current) photoInputRef.current.value = "";
            }}
          />
          {showPhoto ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoSrc!}
                alt={poi.name}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                onError={() => setImgError(true)}
              />
              {/* Change photo button — top-right corner */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); photoInputRef.current?.click(); }}
                className="absolute top-1.5 right-1.5 z-10 rounded-full bg-black/50 p-1.5 sm:p-1 text-white/80 hover:text-white hover:bg-black/70 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                title="Change photo"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                </svg>
              </button>
            </>
          ) : (
            <div
              className="flex h-full w-full flex-col items-center justify-center gap-1 cursor-pointer hover:bg-[hsl(var(--muted))]/80 transition-colors"
              onClick={(e) => { e.stopPropagation(); photoInputRef.current?.click(); }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 opacity-20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
              <span className="text-[10px] opacity-20 font-medium">Add photo</span>
            </div>
          )}

          {/* UNESCO badge */}
          {poi.isUnescoSite && (
            <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-indigo-700 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">🏛 UNESCO</span>
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
                isVisited ? "bg-indigo-500 text-white" : "bg-white/30 text-white/70 hover:bg-indigo-400 hover:text-white"
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
        {/* Name + edit button */}
        <div className="flex items-start justify-between gap-1 mb-1.5">
          <h3 className="font-semibold text-sm leading-snug line-clamp-2">{poi.name}</h3>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(poi); }}
            className="rounded-full p-1.5 sm:p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] flex-shrink-0"
            title="Edit place"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 sm:h-3 sm:w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>

        {/* Badges row: score explainers + price level + cluster indicator */}
        {(() => {
          const badges = getScoreBadges(poi.scoreBreakdown);
          const cluster = getClusterCount(poi.extraFields);
          const hasAnything = badges.length > 0 || poi.priceLevel != null || cluster > 0;
          if (!hasAnything) return null;
          return (
            <div className="mb-2 flex flex-wrap items-center gap-1">
              {badges.map((b) => (
                <span key={b.label} className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                  {b.emoji} {b.label}
                </span>
              ))}
              {poi.priceLevel != null && (
                <span className="rounded-full bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                  {PRICE_LABELS[poi.priceLevel] ?? ""}
                </span>
              )}
              {cluster > 0 && (
                <span className="rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                  +{cluster} more nearby
                </span>
              )}
            </div>
          );
        })()}

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

        {/* Details toggle button */}
        {hasDetails && (
          <div className="mb-1.5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:underline"
            >
              <span className={`text-[9px] transition-transform ${detailsOpen ? "rotate-90" : ""}`}>▶</span>
              ℹ Details
            </button>
          </div>
        )}

        {/* Expanded details */}
        {detailsOpen && hasDetails && (
          <div className="mb-2 border-l-2 border-slate-300 pl-2.5 py-1 text-xs text-slate-600 space-y-0.5">
            {poi.fee && <p>🎫 {poi.fee === "yes" ? "Admission fee" : poi.fee === "no" ? "Free" : poi.fee}</p>}
            {poi.openingHours && <p>🕐 {poi.openingHours}</p>}
            {poi.phoneNumber && <p>📞 {poi.phoneNumber}</p>}
            {poi.inceptionYear && <p>📅 Est. {poi.inceptionYear}</p>}
          </div>
        )}

        {/* Attachments (read-only in card, edit in modal) */}
        {poi.attachments && poi.attachments.length > 0 && (
          <div className="mb-2">
            <AttachmentsSection
              entityType="poi"
              entityId={poi.id}
              attachments={poi.attachments}
              onChanged={() => {}}
              readOnly
            />
          </div>
        )}

        {/* Add to Day Plan */}
        <DayPlanAssigner poiId={poi.id} poiName={poi.name} poiCategory={poi.category} dayPlans={dayPlans} />

        {/* Footer links */}
        <div className="mt-auto flex items-center gap-3 flex-wrap border-t border-[hsl(var(--border))] pt-2">
          {/* Drag handle */}
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "copy";
              e.dataTransfer.setData("application/x-poi-id", String(poi.id));
            }}
            title="Drag to timeline"
            className="flex items-center gap-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] cursor-grab active:cursor-grabbing transition-colors"
          >
            <DragGripIcon className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium">Drag</span>
          </span>
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

export function CompactPoiCard({
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
  onChangeCategory,
  onUploadPhoto,
  onEdit,
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
  onChangeCategory: (poiId: number, cat: Category) => void;
  onUploadPhoto: (poiId: number, dataUri: string) => void;
  onEdit: (poi: PoiDTO) => void;
}) {
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const compactPhotoRef = useRef<HTMLInputElement>(null);
  const hasCoords = poi.latitude != null && poi.longitude != null;
  const isDeleting = deletingId === poi.id;
  const PRICE_LABELS: Record<number, string> = { 0: "Free", 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };
  const hasDetails = poi.openingHours || poi.phoneNumber || poi.inceptionYear || poi.fee;

  return (
    <div data-poi-id={poi.id} className={`group relative rounded-lg border transition-shadow hover:shadow-md ${isAssigned ? "bg-[hsl(var(--card))]/80 ring-1 ring-green-300" : "bg-[hsl(var(--card))]"} ${userRating != null ? "border-[hsl(var(--primary))]" : "border-[hsl(var(--border))]"}`}>
      {/* Status indicators — left side (offset to right of drag handle) */}
      <div className="absolute left-7 top-2.5 z-10 flex items-center gap-1">
        {isAssigned && (
          <span title="Assigned to daily plan" className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white shadow-sm text-[9px]">✓</span>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleVisited(poi.id); }}
          title={isVisited ? "Visited — click to unmark" : "Mark as visited"}
          className={`flex h-4 w-4 items-center justify-center rounded-full shadow-sm text-[9px] transition-colors ${
            isVisited ? "bg-indigo-500 text-white" : "bg-white/80 text-gray-400 border border-gray-200 hover:border-indigo-300 hover:text-indigo-500"
          }`}
        >
          {isVisited ? "👁" : "○"}
        </button>
      </div>

      {/* Compact header — always visible */}
      <div className="flex w-full items-center gap-0">
        {/* Drag handle */}
        <span
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = "copy";
            e.dataTransfer.setData("application/x-poi-id", String(poi.id));
          }}
          title="Drag to timeline"
          className="flex items-center px-1 py-2.5 text-[hsl(var(--muted-foreground))]/40 hover:text-[hsl(var(--muted-foreground))] cursor-grab active:cursor-grabbing transition-colors self-stretch"
        >
          <DragGripIcon className="h-4 w-4" />
        </span>
      <div
        onClick={(e) => { if ((e.target as HTMLElement).closest('button')) return; setOpen((v) => !v); }}
        className="flex flex-1 items-center gap-3 p-2.5 pl-1 text-left min-w-0 cursor-pointer"
      >
        {/* Thumbnail */}
        <input
          ref={compactPhotoRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const dataUri = await resizeImageFile(file, 600);
            onUploadPhoto(poi.id, dataUri);
            if (compactPhotoRef.current) compactPhotoRef.current.value = "";
          }}
        />
        {poiPhotoSrc(poi) && !imgError ? (
          <div
            className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-md group/thumb cursor-pointer"
            onClick={(e) => { e.stopPropagation(); compactPhotoRef.current?.click(); }}
            title="Change photo"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={poiPhotoSrc(poi)!} alt="" className="h-full w-full object-cover" onError={() => setImgError(true)} />
            <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/40 transition-colors flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
          </div>
        ) : (
          <span
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-[hsl(var(--muted))] text-lg cursor-pointer hover:bg-[hsl(var(--muted))]/80 transition-colors"
            onClick={(e) => { e.stopPropagation(); compactPhotoRef.current?.click(); }}
            title="Add photo"
          >
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
            <span className="flex-shrink-0 text-[10px] font-bold text-indigo-600">UNESCO</span>
          )}
        </div>

        {/* Category badge — clickable to change */}
        <span className="flex-shrink-0 relative">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setCatPickerOpen((v) => !v); }}
            title="Change category"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium hover:ring-1 hover:ring-[hsl(var(--primary))]/40 transition-all ${CATEGORY_STYLES[poi.category].badge}`}
          >
            {CATEGORY_LABELS[poi.category]}
          </button>
          {catPickerOpen && (
            <div className="absolute top-6 right-0 z-30 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg p-1.5 grid grid-cols-2 gap-1 w-max">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); if (c !== poi.category) onChangeCategory(poi.id, c); setCatPickerOpen(false); }}
                  className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] hover:bg-[hsl(var(--muted))] transition-colors whitespace-nowrap ${c === poi.category ? "bg-[hsl(var(--primary))]/10 font-semibold" : ""}`}
                >
                  <span>{CATEGORY_ICONS[c]}</span>
                  <span>{CATEGORY_LABELS[c]}</span>
                </button>
              ))}
            </div>
          )}
        </span>

        {/* Edit pencil */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(poi); }}
          className="flex-shrink-0 rounded-full p-1.5 sm:p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
          title="Edit place"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>

        {/* Favourite heart — always visible, tap-friendly for mobile */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onFavourite(poi); }}
          title={isFavourited ? "Already in favourites" : "Add to favourites"}
          className={`flex-shrink-0 p-1 transition-colors ${isFavourited ? "text-pink-500" : "text-gray-300 hover:text-pink-400"}`}
        >
          <HeartIcon filled={isFavourited} className="h-4 w-4" />
        </button>

        {/* Expand chevron */}
        <span className={`flex-shrink-0 text-xs text-[hsl(var(--muted-foreground))] transition-transform ${open ? "rotate-180" : ""}`}>
          ▼
        </span>
      </div>
      </div>

      {/* Expanded details */}
      {open && (
        <div className="border-t border-[hsl(var(--border))] px-3 py-2.5 space-y-2 text-sm">
          {poi.description && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">{poi.description}</p>
          )}

          {/* Score explainer badges + cluster indicator */}
          {(() => {
            const badges = getScoreBadges(poi.scoreBreakdown);
            const cluster = getClusterCount(poi.extraFields);
            if (badges.length === 0 && cluster === 0) return null;
            return (
              <div className="flex flex-wrap items-center gap-1">
                {badges.map((b) => (
                  <span key={b.label} className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                    {b.emoji} {b.label}
                  </span>
                ))}
                {cluster > 0 && (
                  <span className="rounded-full bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                    +{cluster} more nearby
                  </span>
                )}
              </div>
            );
          })()}

          {/* Details toggle button */}
          {hasDetails && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setDetailsOpen((v) => !v); }}
                className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:underline"
              >
                <span className={`text-[9px] transition-transform ${detailsOpen ? "rotate-90" : ""}`}>▶</span>
                ℹ Details
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
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

          {detailsOpen && hasDetails && (
            <div className="border-l-2 border-slate-300 pl-2.5 py-1 text-xs text-slate-600 space-y-0.5">
              {poi.fee && <p>🎫 {poi.fee === "yes" ? "Admission fee required" : poi.fee === "no" ? "Free admission" : poi.fee}</p>}
              {poi.openingHours && <p>🕐 {poi.openingHours}</p>}
              {poi.phoneNumber && <p>📞 {poi.phoneNumber}</p>}
              {poi.inceptionYear && <p>📅 Est. {poi.inceptionYear}</p>}
            </div>
          )}

          <DayPlanAssigner poiId={poi.id} poiName={poi.name} poiCategory={poi.category} dayPlans={dayPlans} />

          <div className="flex items-center gap-3 flex-wrap pt-1">
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
