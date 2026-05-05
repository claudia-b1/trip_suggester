"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORIES, CATEGORY_STYLES, type Category } from "@/lib/categories";
import { PoiMap, type DayPlanOption } from "./poi-map";
import { DailyPlan, type DayPlanDTO } from "./daily-plan";
import { TimelineSidebar } from "./timeline-sidebar";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { PoiAutocomplete, type PoiSuggestion } from "@/components/ui/poi-autocomplete";

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
};

type View = "list" | "map" | "plan";
type ListLayout = "grid" | "compact";

function CategoryBadge({ category }: { category: Category }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[category].badge}`}
    >
      {category}
    </span>
  );
}

const CATEGORY_ICONS: Record<Category, string> = {
  CULTURE: "🏛️",
  FOOD: "🍽️",
  NATURE: "🌿",
  NIGHTLIFE: "🌙",
  SHOPPING: "🛍️",
  OUTDOORS: "🏔️",
};

const BEST_TIME_LABELS: Record<string, { label: string; emoji: string }> = {
  morning: { label: "Morning", emoji: "🌅" },
  afternoon: { label: "Afternoon", emoji: "☀️" },
  evening: { label: "Evening", emoji: "🌙" },
};

/** Build a Google Maps URL that resolves to the actual place if found, otherwise falls back to coordinates */
function googleMapsUrl(name: string, lat: number, lng: number) {
  return `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lng},17z`;
}

function PoiCard({
  poi,
  onDelete,
  onViewOnMap,
  deletingId,
  isAssigned,
  isVisited,
  onToggleVisited,
}: {
  poi: PoiDTO;
  onDelete: (poi: PoiDTO) => void;
  onViewOnMap: (poiId: number) => void;
  deletingId: number | null;
  isAssigned: boolean;
  isVisited: boolean;
  onToggleVisited: (poiId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const hasCoords = poi.latitude != null && poi.longitude != null;
  const isDeleting = deletingId === poi.id;
  const longDesc = (poi.description?.length ?? 0) > 110;

  const timeInfo = poi.bestTimeToVisit ? BEST_TIME_LABELS[poi.bestTimeToVisit] : null;
  const PRICE_LABELS: Record<number, string> = { 0: "Free", 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };
  const hasDetails = poi.openingHours || poi.phoneNumber || poi.inceptionYear;

  return (
    <div className={`group relative flex flex-col rounded-xl border border-[hsl(var(--border))] shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md overflow-hidden h-full ${isAssigned ? "bg-[hsl(var(--card))]/80 ring-1 ring-green-300" : "bg-[hsl(var(--card))]"}`}>
      {/* Status indicators — top left absolute */}
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1">
        {isAssigned && (
          <span title="Assigned to daily plan" className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white shadow-sm text-[10px]">
            ✓
          </span>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleVisited(poi.id); }}
          title={isVisited ? "Visited — click to unmark" : "Mark as visited"}
          className={`flex h-5 w-5 items-center justify-center rounded-full shadow-sm text-[10px] transition-colors ${
            isVisited
              ? "bg-blue-500 text-white"
              : "bg-white/80 text-gray-400 border border-gray-200 hover:border-blue-300 hover:text-blue-500"
          }`}
        >
          {isVisited ? "👁" : "○"}
        </button>
      </div>

      {/* Photo header */}
      {poi.photoUrl && !imgError && (
        <div
          className="relative h-36 w-full overflow-hidden cursor-zoom-in"
          onClick={() => setLightboxOpen(true)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={poi.photoUrl}
            alt={poi.name}
            className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
            onError={() => setImgError(true)}
          />
          {poi.isUnescoSite && (
            <span className="absolute bottom-2 left-2 rounded-full bg-blue-700 px-2 py-0.5 text-[10px] font-bold text-white shadow">
              🏛 UNESCO
            </span>
          )}
        </div>
      )}

      {/* Image lightbox */}
      {lightboxOpen && poi.photoUrl && (
        <ImageLightbox src={poi.photoUrl} alt={poi.name} onClose={() => setLightboxOpen(false)} />
      )}

      <div className="flex flex-1 flex-col p-4">
      {/* Category badge — top right */}
      <div className="absolute right-3 top-3">
        <span
          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
            CATEGORY_STYLES[poi.category].badge
          }`}
        >
          {poi.category}
        </span>
      </div>

      {/* Icon + Name */}
      <div className="mb-2 flex items-center gap-2 pr-20">
        <span className="text-lg" aria-hidden>
          {CATEGORY_ICONS[poi.category]}
        </span>
        <h3 className="font-semibold leading-snug">{poi.name}</h3>
      </div>

      {/* Meta badges */}
      {(poi.rating != null || poi.estimatedDurationMinutes != null || timeInfo || poi.priceLevel != null || poi.isUnescoSite) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {poi.rating != null && (
            <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-700">
              {"⭐".repeat(Math.round(poi.rating))}&nbsp;{poi.rating.toFixed(1)}
            </span>
          )}
          {poi.priceLevel != null && (
            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {PRICE_LABELS[poi.priceLevel] ?? ""}
            </span>
          )}
          {poi.estimatedDurationMinutes != null && (
            <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-xs text-slate-600">
              ⏱ ~{poi.estimatedDurationMinutes} min
            </span>
          )}
          {timeInfo && (
            <span className="rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-xs text-sky-700">
              {timeInfo.emoji} {timeInfo.label}
            </span>
          )}
          {poi.isUnescoSite && (
            <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-semibold text-blue-700">
              🏛 UNESCO
            </span>
          )}
        </div>
      )}

      {/* Description with 2-line clamp + expand */}
      {poi.description && (
        <div className="mb-3 flex-1 text-sm text-[hsl(var(--muted-foreground))]">
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

      {/* Tips collapsible */}
      {poi.tips && (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setTipsOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
          >
            <span className={`transition-transform ${tipsOpen ? "rotate-90" : ""}`}>▶</span>
            Visitor tip
          </button>
          {tipsOpen && (
            <p className="mt-1 rounded-md bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
              💡 {poi.tips}
            </p>
          )}
        </div>
      )}

      {/* Details collapsible (hours, phone, year, website) */}
      {hasDetails && (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
          >
            <span className={`transition-transform ${detailsOpen ? "rotate-90" : ""}`}>▶</span>
            Details
          </button>
          {detailsOpen && (
            <div className="mt-1 rounded-md bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-700 space-y-1">
              {poi.openingHours && <p>🕐 {poi.openingHours}</p>}
              {poi.phoneNumber && <p>📞 {poi.phoneNumber}</p>}
              {poi.inceptionYear && <p>📅 Est. {poi.inceptionYear}</p>}
            </div>
          )}
        </div>
      )}

      {/* Footer: always pinned at bottom */}
      <div className="mt-auto flex items-center justify-between border-t border-[hsl(var(--border))] pt-2">
        <div className="flex items-center gap-3 flex-wrap">
          {hasCoords ? (
            <button
              type="button"
              onClick={onViewOnMap.bind(null, poi.id)}
              className="text-xs font-medium text-[hsl(var(--primary))] hover:underline"
            >
              🗺️ View on map
            </button>
          ) : (
            <span />
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

        <button
          type="button"
          onClick={() => onDelete(poi)}
          disabled={isDeleting}
          aria-label="Delete POI"
          className="rounded p-1 text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:opacity-30"
        >
          {isDeleting ? (
            <span className="text-xs">…</span>
          ) : (
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
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
          )}
        </button>
      </div>
      </div>
    </div>
  );
}

function CompactPoiCard({
  poi,
  onDelete,
  onViewOnMap,
  deletingId,
  isAssigned,
  isVisited,
  onToggleVisited,
}: {
  poi: PoiDTO;
  onDelete: (poi: PoiDTO) => void;
  onViewOnMap: (poiId: number) => void;
  deletingId: number | null;
  isAssigned: boolean;
  isVisited: boolean;
  onToggleVisited: (poiId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const hasCoords = poi.latitude != null && poi.longitude != null;
  const isDeleting = deletingId === poi.id;
  const PRICE_LABELS: Record<number, string> = { 0: "Free", 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };
  const hasDetails = poi.openingHours || poi.phoneNumber || poi.inceptionYear;

  return (
    <div className={`group relative rounded-lg border border-[hsl(var(--border))] transition-shadow hover:shadow-md ${isAssigned ? "bg-[hsl(var(--card))]/80 ring-1 ring-green-300" : "bg-[hsl(var(--card))]"}`}>
      {/* Status indicators — left side */}
      <div className="absolute left-2 top-2.5 z-10 flex items-center gap-1">
        {isAssigned && (
          <span title="Assigned to daily plan" className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white shadow-sm text-[9px]">
            ✓
          </span>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleVisited(poi.id); }}
          title={isVisited ? "Visited — click to unmark" : "Mark as visited"}
          className={`flex h-4 w-4 items-center justify-center rounded-full shadow-sm text-[9px] transition-colors ${
            isVisited
              ? "bg-blue-500 text-white"
              : "bg-white/80 text-gray-400 border border-gray-200 hover:border-blue-300 hover:text-blue-500"
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
            <span className="flex-shrink-0 text-xs text-amber-600">⭐ {poi.rating.toFixed(1)}</span>
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
          {poi.category}
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

          {hasDetails && (
            <div className="rounded-md bg-slate-50 border border-slate-100 px-2.5 py-1.5 text-xs text-slate-700 space-y-0.5">
              {poi.openingHours && <p>🕐 {poi.openingHours}</p>}
              {poi.phoneNumber && <p>📞 {poi.phoneNumber}</p>}
              {poi.inceptionYear && <p>📅 Est. {poi.inceptionYear}</p>}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-3 flex-wrap">
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
            <button
              type="button"
              onClick={() => onDelete(poi)}
              disabled={isDeleting}
              aria-label="Delete POI"
              className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
            >
              {isDeleting ? <span className="text-xs">…</span> : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PoisSection({
  cityId,
  pois,
  dayPlans,
  cityLat,
  cityLon,
}: {
  cityId: number;
  pois: PoiDTO[];
  dayPlans: DayPlanDTO[];
  cityLat?: number;
  cityLon?: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<View>("map");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("CULTURE");
  const [description, setDescription] = useState("");
  const [addLat, setAddLat] = useState("");
  const [addLng, setAddLng] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [focusPoiId, setFocusPoiId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [listLayout, setListLayout] = useState<ListLayout>("grid");
  const [mapPopupPoi, setMapPopupPoi] = useState<PoiDTO | null>(null);
  const [scrollToActivity, setScrollToActivity] = useState<{ date: string; activityId: number } | null>(null);

  // Live day plans — single source of truth, shared with DailyPlan and TimelineSidebar
  const [liveDayPlans, setLiveDayPlans] = useState(dayPlans);
  useEffect(() => { setLiveDayPlans(dayPlans); }, [dayPlans]);

  // Assigned POI IDs (derived from day plans)
  const assignedPoiIds = useMemo(() => {
    const ids = new Set<number>();
    for (const dp of liveDayPlans) {
      for (const a of dp.activities) ids.add(a.poiId);
    }
    return ids;
  }, [liveDayPlans]);

  // Visited POI IDs (persisted in localStorage)
  const [visitedIds, setVisitedIds] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`visited-pois-${cityId}`);
      if (stored) setVisitedIds(new Set(JSON.parse(stored)));
    } catch { /* ignore */ }
  }, [cityId]);

  const toggleVisited = useCallback((poiId: number) => {
    setVisitedIds((prev) => {
      const next = new Set(prev);
      if (next.has(poiId)) next.delete(poiId);
      else next.add(poiId);
      try { localStorage.setItem(`visited-pois-${cityId}`, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, [cityId]);

  type SortKey = "name" | "category" | "rating" | "price";
  const [sortBy, setSortBy] = useState<SortKey>("name");

  // Filter state — applies to list + map views only.
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    () => new Set(CATEGORIES),
  );
  const [search, setSearch] = useState("");
  type StatusFilter = "all" | "assigned" | "unassigned" | "visited" | "unvisited";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  function toggleCategory(c: Category) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }
  function clearFilters() {
    setActiveCategories(new Set(CATEGORIES));
    setSearch("");
    setStatusFilter("all");
  }
  const allCategoriesSelected = activeCategories.size === CATEGORIES.length;
  const hasFilters = !allCategoriesSelected || search.trim().length > 0 || statusFilter !== "all";
  const searchLower = search.trim().toLowerCase();
  const filteredPois = pois.filter(
    (p) =>
      activeCategories.has(p.category) &&
      (searchLower === "" || p.name.toLowerCase().includes(searchLower)) &&
      (statusFilter === "all" ||
        (statusFilter === "assigned" && assignedPoiIds.has(p.id)) ||
        (statusFilter === "unassigned" && !assignedPoiIds.has(p.id)) ||
        (statusFilter === "visited" && visitedIds.has(p.id)) ||
        (statusFilter === "unvisited" && !visitedIds.has(p.id))),
  );

  const sortedPois = [...filteredPois].sort((a, b) => {
    switch (sortBy) {
      case "category":
        return a.category.localeCompare(b.category);
      case "rating":
        return (b.rating ?? 0) - (a.rating ?? 0);
      case "price":
        return (a.priceLevel ?? 99) - (b.priceLevel ?? 99);
      case "name":
      default:
        return a.name.localeCompare(b.name);
    }
  });

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
    setDescription("");
    setAddLat("");
    setAddLng("");
    setSubmitting(false);
    setAddOpen(false);
    router.refresh();
  }

  function handleAddAtLocation(lat: number, lng: number) {
    setAddLat(lat.toFixed(6));
    setAddLng(lng.toFixed(6));
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
                    {CATEGORY_ICONS[c]} {c} ({count})
                  </button>
                );
              })}
            </div>
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
                dayPlans={dayPlans.map((dp) => ({ id: dp.id, label: new Date(dp.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) } satisfies DayPlanOption))}
                focusPoiId={focusPoiId}
                onAddAtLocation={handleAddAtLocation}
              />
            </div>
          </div>
        ) : view === "plan" ? (
          <DailyPlan cityId={cityId} pois={pois} dayPlans={liveDayPlans} setDayPlans={setLiveDayPlans} scrollToActivity={scrollToActivity} onScrollComplete={() => setScrollToActivity(null)} />
        ) : filteredPois.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {pois.length === 0 ? "No POIs yet." : "No POIs match the current filters."}
          </p>
        ) : (
          <div className="space-y-3">
            {/* Map popup modal for isolated view */}
            {mapPopupPoi && mapPopupPoi.latitude != null && mapPopupPoi.longitude != null && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setMapPopupPoi(null)}>
                <div className="relative w-full max-w-lg rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-semibold">{mapPopupPoi.name}</h3>
                    <button type="button" onClick={() => setMapPopupPoi(null)} className="rounded p-1 hover:bg-gray-100 text-gray-500">✕</button>
                  </div>
                  <div className="rounded-md overflow-hidden border border-[hsl(var(--border))]">
                    <PoiMap
                      pois={[mapPopupPoi]}
                      cityId={cityId}
                      dayPlans={[]}
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    {mapPopupPoi.latitude != null && mapPopupPoi.longitude != null && (
                      <a
                        href={googleMapsUrl(mapPopupPoi.name, mapPopupPoi.latitude, mapPopupPoi.longitude)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-[hsl(var(--primary))] hover:underline"
                      >
                        📍 Open in Google Maps
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}
            {/* Sort + Status filter + Layout toggle */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <label className="text-xs text-[hsl(var(--muted-foreground))]">Sort:</label>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortKey)}
                    className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs"
                  >
                    <option value="name">Name A→Z</option>
                    <option value="category">Category</option>
                    <option value="rating">Rating ↓</option>
                    <option value="price">Price ↑</option>
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <label className="text-xs text-[hsl(var(--muted-foreground))]">Status:</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                    className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs"
                  >
                    <option value="all">All</option>
                    <option value="assigned">✓ Assigned</option>
                    <option value="unassigned">○ Unassigned</option>
                    <option value="visited">👁 Visited</option>
                    <option value="unvisited">○ Not visited</option>
                  </select>
                </div>
              </div>
              <div className="inline-flex rounded-md border border-[hsl(var(--border))] p-0.5">
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

            {listLayout === "compact" ? (
              <div className="space-y-1.5">
                {sortedPois.map((poi) => (
                  <CompactPoiCard
                    key={poi.id}
                    poi={poi}
                    onDelete={onDelete}
                    onViewOnMap={() => setMapPopupPoi(poi)}
                    deletingId={deletingId}
                    isAssigned={assignedPoiIds.has(poi.id)}
                    isVisited={visitedIds.has(poi.id)}
                    onToggleVisited={toggleVisited}
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
                    onViewOnMap={() => setMapPopupPoi(poi)}
                    deletingId={deletingId}
                    isAssigned={assignedPoiIds.has(poi.id)}
                    isVisited={visitedIds.has(poi.id)}
                    onToggleVisited={toggleVisited}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="border-t border-[hsl(var(--border))] pt-4">
          {!addOpen ? (
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              + Add POI manually
            </Button>
          ) : (
            <form onSubmit={onAdd} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="poi-name">Name</Label>
            <PoiAutocomplete
              id="poi-name"
              value={name}
              onChange={setName}
              onSelect={(s: PoiSuggestion) => {
                setName(s.name);
                setAddLat(s.latitude.toFixed(6));
                setAddLng(s.longitude.toFixed(6));
                if (s.description) setDescription(s.description);
              }}
              cityLat={cityLat}
              cityLon={cityLon}
              placeholder="Search places or type a name…"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="poi-category">Category</Label>
            <select
              id="poi-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="flex h-10 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="poi-lat">Latitude</Label>
              <Input
                id="poi-lat"
                type="text"
                inputMode="decimal"
                value={addLat}
                onChange={(e) => setAddLat(e.target.value)}
                placeholder="e.g. 48.8566"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="poi-lng">Longitude</Label>
              <Input
                id="poi-lng"
                type="text"
                inputMode="decimal"
                value={addLng}
                onChange={(e) => setAddLng(e.target.value)}
                placeholder="e.g. 2.3522"
              />
            </div>
          </div>
          {addLat && addLng && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              📍 Location: {addLat}, {addLng}
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? <><span className="spinner mr-1.5" /> Adding…</> : "Add POI"}
            </Button>
            <Button type="button" variant="outline" onClick={() => { setName(""); setCategory("CULTURE"); setDescription(""); setAddLat(""); setAddLng(""); setError(null); setAddOpen(false); }} disabled={submitting}>
              Cancel
            </Button>
          </div>
            </form>
          )}
        </div>
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
    </div>
  );
}
