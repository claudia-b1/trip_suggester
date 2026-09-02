"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CATEGORY_STYLES, CATEGORY_LABELS, CATEGORY_ICONS, type Category } from "@/lib/categories";
import type { TimeSlot } from "@/lib/slots";
import type { RecommendableCategory } from "@/lib/recommendations";
import { SUBCATEGORIES } from "@/lib/recommendations/subcategories";
import { FUEL_SUBCATEGORIES } from "@/lib/favourite-fields";
import { PoiMap } from "./poi-map";
import { useFavourites } from "@/components/favourites/favourites-provider";
import type { FavouriteItemDTO } from "@/components/favourites/favourites-provider";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { EditPoiModal, type EditPoiData } from "@/components/ui/edit-poi-modal";
import { getPhotoSource, PHOTO_SOURCE_LABELS } from "@/lib/photo-source";
import type { DayPlanDTO } from "./daily-plan";
import { TimelineSidebar } from "./timeline-sidebar";

// ─── Types ───────────────────────────────────────────────────────────────────

export type StopPoiDTO = {
  id: number;
  name: string;
  category: Category;
  subcategory: string | null;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  userRatingCount: number | null;
  photoUrl: string | null;
  placeId: string | null;
  website: string | null;
  phoneNumber: string | null;
  openingHours: string | null;
  priceLevel: number | null;
  fee: string | null;
  tips: string | null;
  bestTimeToVisit: string | null;
  estimatedDurationMinutes: number | null;
  address: string | null;
  notes: string | null;
  favouriteItemId: number | null;
  extraFields?: Record<string, unknown> | null;
  hasOriginalData?: boolean;
};

type View = "map" | "list";

// Only FOOD, GROCERIES, and FUEL for travel stops
const STOP_CATEGORIES: RecommendableCategory[] = ["FOOD", "GROCERIES"];
const STOP_SUBCATEGORY_IDS: Record<string, string[]> = {
  FOOD: ["restaurant", "fine_dining", "fast_food", "cafe"],
  GROCERIES: ["supermarket", "shop_bakery"],
  FUEL: ["gas_station", "ev_charging", "lpg"],
};

// All category pills including FUEL (handled separately) — ordered by practical priority
const ALL_STOP_CATS = ["GROCERIES", "FUEL", "FOOD"] as const;

const CATEGORY_ICON_MAP: Record<string, string> = {
  FOOD: "🍽️",
  GROCERIES: "🛒",
  FUEL: "⛽",
};

const DEFAULT_STOP_RADIUS_KM = 5;
const DEFAULT_STOP_COUNTS: Record<string, number> = {
  FOOD: 10,
  GROCERIES: 10,
};

type Failure = { category: RecommendableCategory; error: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function poiPhotoSrc(poi: { id: number; photoUrl: string | null }): string | null {
  if (!poi.photoUrl) return null;
  if (poi.photoUrl.startsWith("data:")) return poi.photoUrl;
  return `/api/pois/${poi.id}/photo`;
}

function formatReviewCount(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

function googleMapsUrl(name: string, lat: number, lng: number) {
  return `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lng},17z`;
}

const PRICE_LABELS: Record<number, string> = { 0: "Free", 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };

// ─── HeartIcon ───────────────────────────────────────────────────────────────

function HeartIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className ?? "h-3.5 w-3.5"} viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
    </svg>
  );
}

// ─── StopPoiCard ─────────────────────────────────────────────────────────────

function StopPoiCard({
  poi,
  onViewOnMap,
  onFavourite,
  isFavourited,
  onOpenLightbox,
  onEdit,
}: {
  poi: StopPoiDTO;
  onViewOnMap: (poiId: number) => void;
  onFavourite: (poi: StopPoiDTO) => void;
  isFavourited: boolean;
  onOpenLightbox: (src: string, alt: string) => void;
  onEdit: (poi: StopPoiDTO) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const hasCoords = poi.latitude != null && poi.longitude != null;
  const photoSrc = poiPhotoSrc(poi);
  const showPhoto = photoSrc && !imgError;

  return (
    <div data-poi-id={poi.id} className="group relative flex flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm transition-all duration-200 hover:shadow-md overflow-hidden h-full">
      {/* Header: category strip + photo */}
      <div className="flex h-24 w-full flex-shrink-0">
        {/* Category icon + rating */}
        <div className="flex w-10 flex-shrink-0 flex-col items-center justify-start gap-1 bg-[hsl(var(--muted))] px-1 py-2">
          <span className="text-lg leading-none">{CATEGORY_ICONS[poi.category]}</span>
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
          className={`relative flex-1 overflow-hidden ${showPhoto ? "cursor-zoom-in" : "bg-[hsl(var(--muted))]/40"}`}
          onClick={() => showPhoto && onOpenLightbox(photoSrc!, poi.name)}
        >
          {showPhoto ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoSrc!}
                alt={poi.name}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                onError={() => setImgError(true)}
              />
              {/* Photo source badge */}
              {(() => {
                const source = getPhotoSource(poi.photoUrl);
                return source ? (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white/90 font-medium pointer-events-none">
                    {PHOTO_SOURCE_LABELS[source]}
                  </span>
                ) : null;
              })()}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-2xl opacity-10">{CATEGORY_ICONS[poi.category]}</span>
            </div>
          )}

          {/* Favourite button overlay */}
          <button
            type="button"
            title={isFavourited ? "Already in favourites" : "Add to favourites"}
            onClick={(e) => { e.stopPropagation(); onFavourite(poi); }}
            className={`absolute top-1.5 right-1.5 z-10 rounded-full p-1.5 transition-all ${
              isFavourited
                ? "bg-pink-500 text-white shadow-sm"
                : "bg-black/40 text-white/80 hover:bg-pink-500 hover:text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            }`}
          >
            <HeartIcon filled={isFavourited} className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start justify-between gap-1">
          <h4 className="text-sm font-semibold leading-snug line-clamp-2">{poi.name}</h4>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(poi); }}
            className="rounded-full p-1.5 sm:p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] flex-shrink-0"
            title="Edit place"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>

        {/* Subcategory + price */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {poi.subcategory && (
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_STYLES[poi.category].badge}`}>
              {poi.subcategory}
            </span>
          )}
          {poi.priceLevel != null && poi.priceLevel > 0 && (
            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{PRICE_LABELS[poi.priceLevel]}</span>
          )}
        </div>

        {poi.description && (
          <p className="text-xs text-[hsl(var(--muted-foreground))] line-clamp-2">{poi.description}</p>
        )}

        {poi.openingHours && (
          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
            🕐 {poi.openingHours.split(";")[0]}
          </p>
        )}

        {/* Action links */}
        <div className="mt-auto flex items-center gap-2 pt-1">
          {/* Drag handle */}
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-poi-id", String(poi.id));
              e.dataTransfer.effectAllowed = "copy";
            }}
            title="Drag to timeline"
            className="cursor-grab active:cursor-grabbing opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] flex-shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/>
              <circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>
              <circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>
            </svg>
          </div>
          {hasCoords && (
            <>
              <button
                type="button"
                onClick={() => onViewOnMap(poi.id)}
                className="text-[11px] text-[hsl(var(--primary))] hover:underline"
              >
                📍 Show on map
              </button>
              <a
                href={googleMapsUrl(poi.name, poi.latitude!, poi.longitude!)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[hsl(var(--muted-foreground))] hover:underline"
              >
                Google Maps ↗
              </a>
            </>
          )}
          {poi.website && (
            <a
              href={poi.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-[hsl(var(--muted-foreground))] hover:underline"
            >
              Website ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function StopPlanningSection({
  tripId,
  cityId,
  pois,
  cityLat,
  cityLon,
  cityName,
  country,
  favouriteItems,
  initialAccommodation,
  dayPlans,
  initialNote,
  initialRadiusKm,
}: {
  tripId: number;
  cityId: number;
  pois: StopPoiDTO[];
  cityLat?: number;
  cityLon?: number;
  cityName?: string;
  country?: string;
  favouriteItems?: FavouriteItemDTO[];
  /** Pre-existing ACCOMMODATION POI for this stop (persisted center) */
  initialAccommodation?: { id: number; name: string; latitude: number; longitude: number; address?: string } | null;
  dayPlans: DayPlanDTO[];
  initialNote: { id: number; content: string } | null;
  /** Persisted discover radius from last run */
  initialRadiusKm?: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { showAddModal, favouritedPlaceIds, favouritedNames, favouritedItemIds } = useFavourites();
  const [editingPoi, setEditingPoi] = useState<EditPoiData | null>(null);

  // ── Notes state ──
  const [noteId, setNoteId] = useState<number | null>(initialNote?.id ?? null);
  const [noteContent, setNoteContent] = useState(initialNote?.content ?? "");
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteLastSavedRef = useRef(initialNote?.content ?? "");

  // ── Timeline / day plans state ──
  const [liveDayPlans, setLiveDayPlans] = useState(dayPlans);
  useEffect(() => { setLiveDayPlans(dayPlans); }, [dayPlans]);

  // The effective center for discover + map radius (accommodation picker is in CityHeader)
  const centerLat = initialAccommodation?.latitude ?? cityLat;
  const centerLon = initialAccommodation?.longitude ?? cityLon;

  // ── Discover state ──
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [radiusKm, setRadiusKm] = useState(initialRadiusKm ?? DEFAULT_STOP_RADIUS_KM);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(ALL_STOP_CATS));
  const [counts, setCounts] = useState<Record<string, number>>(() => ({ ...DEFAULT_STOP_COUNTS }));
  const [subcats, setSubcats] = useState<Record<string, Set<string>>>(
    () =>
      Object.fromEntries(
        Object.entries(STOP_SUBCATEGORY_IDS).map(([c, ids]) => [c, new Set(ids)]),
      ),
  );
  const [cuisineFilter, setCuisineFilter] = useState("");
  const [generating, setGenerating] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [overwriteMode, setOverwriteMode] = useState<"pending" | null>(null);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; failures: Failure[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── View state ──
  const [view, setView] = useState<View>("map");
  const [focusPoiId, setFocusPoiId] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  // ── Focus POI highlight (scroll + pulse when clicking "View full details" from map) ──
  useEffect(() => {
    if (view !== "list" || focusPoiId == null) return;
    const el = document.querySelector(`[data-poi-id="${focusPoiId}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("poi-focus-highlight");
    const timer = setTimeout(() => {
      el.classList.remove("poi-focus-highlight");
      setFocusPoiId(null);
    }, 3200);
    return () => clearTimeout(timer);
  }, [view, focusPoiId]);

  // ── Filter state ──
  const [filterCategories, setFilterCategories] = useState<Set<string>>(() => new Set());
  const [filterIncludedSubcats, setFilterIncludedSubcats] = useState<Set<string>>(() => new Set());
  const [filterSearch, setFilterSearch] = useState("");
  const [filterSort, setFilterSort] = useState<"rating" | "name" | "reviews">("rating");
  const [filterFavouritesOnly, setFilterFavouritesOnly] = useState(false);

  // ── Favourites ──
  const isPoiFavourited = useCallback((poi: StopPoiDTO) => {
    if (poi.favouriteItemId && favouritedItemIds.has(poi.favouriteItemId)) return true;
    if (poi.placeId && favouritedPlaceIds.has(poi.placeId)) return true;
    if (poi.name && favouritedNames.has(poi.name.toLowerCase())) return true;
    return false;
  }, [favouritedPlaceIds, favouritedItemIds, favouritedNames]);

  const handleFavourite = useCallback((poi: StopPoiDTO) => {
    showAddModal({
      name: poi.name,
      category: poi.category as Category,
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

  // ── Derived filter data ──
  const FILTER_CAT_ORDER = ["GROCERIES", "FUEL", "FOOD", "ACCOMMODATION"];
  const presentCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of pois) cats.add(p.category);
    // Sort by the preferred order, then any remaining alphabetically
    return Array.from(cats).sort((a, b) => {
      const ai = FILTER_CAT_ORDER.indexOf(a);
      const bi = FILTER_CAT_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [pois]);

  // Subcategories present in POIs (for filter chips) — only from selected categories
  const presentSubcategories = useMemo(() => {
    const subs = new Map<string, number>();
    for (const p of pois) {
      if (filterCategories.size > 0 && !filterCategories.has(p.category)) continue;
      if (p.subcategory) {
        subs.set(p.subcategory, (subs.get(p.subcategory) ?? 0) + 1);
      }
    }
    return subs;
  }, [pois, filterCategories]);

  const filteredPois = useMemo(() => {
    let result = pois.filter((p) => {
      // Category filter (empty set = show all)
      if (filterCategories.size > 0 && !filterCategories.has(p.category)) return false;
      // Subcategory inclusion filter
      if (filterIncludedSubcats.size > 0 && p.subcategory && !filterIncludedSubcats.has(p.subcategory)) return false;
      // Text search
      if (filterSearch && !p.name.toLowerCase().includes(filterSearch.toLowerCase())) return false;
      // Favourites only
      if (filterFavouritesOnly && !isPoiFavourited(p)) return false;
      return true;
    });

    // Sort
    result = [...result].sort((a, b) => {
      switch (filterSort) {
        case "rating":
          return (b.rating ?? 0) - (a.rating ?? 0);
        case "name":
          return a.name.localeCompare(b.name);
        case "reviews":
          return (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0);
        default:
          return 0;
      }
    });

    return result;
  }, [pois, filterCategories, filterIncludedSubcats, filterSearch, filterSort, filterFavouritesOnly, isPoiFavourited]);

  // Group POIs by category for list view — ordered by practical priority
  const LIST_CATEGORY_ORDER = ["GROCERIES", "FUEL", "FOOD", "ACCOMMODATION"];
  const poisByCategory = useMemo(() => {
    const groups: Record<string, StopPoiDTO[]> = {};
    for (const cat of LIST_CATEGORY_ORDER) {
      const catPois = filteredPois.filter((p) => p.category === cat);
      if (catPois.length > 0) groups[cat] = catPois;
    }
    // Any remaining categories
    for (const p of filteredPois) {
      if (!LIST_CATEGORY_ORDER.includes(p.category)) {
        if (!groups[p.category]) groups[p.category] = [];
        groups[p.category].push(p);
      }
    }
    return groups;
  }, [filteredPois]);

  // (Accommodation picker moved to CityHeader)

  // ── Note handlers ──
  const saveNote = useCallback(async (text: string) => {
    if (text === noteLastSavedRef.current) return;
    setNoteSaving(true);
    try {
      if (noteId) {
        const res = await fetch(`/api/notes/${noteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        });
        if (res.ok) noteLastSavedRef.current = text;
      } else if (text.trim()) {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cityId, content: text }),
        });
        if (res.ok) {
          const note = await res.json();
          setNoteId(note.id);
          noteLastSavedRef.current = text;
        }
      }
    } finally {
      setNoteSaving(false);
    }
  }, [noteId, cityId]);

  function handleNoteChange(newContent: string) {
    setNoteContent(newContent);
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => saveNote(newContent), 1000);
  }

  function handleNoteBlur() {
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    saveNote(noteContent);
    setNoteEditing(false);
  }

  // Cleanup note debounce on unmount
  useEffect(() => {
    return () => {
      if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    };
  }, []);

  // ── Timeline drop handler ──
  const handleDropPoiOnTimeline = useCallback(async (dayPlanId: number, timeSlot: TimeSlot, poiId: number) => {
    // Optimistic update
    const dp = liveDayPlans.find((d) => d.id === dayPlanId);
    if (!dp) return;
    const tempId = -Date.now();
    const poi = pois.find((p) => p.id === poiId);
    setLiveDayPlans((prev) =>
      prev.map((d) =>
        d.id === dayPlanId
          ? { ...d, activities: [...d.activities, { id: tempId, poiId, poiName: poi?.name ?? "Place", poiCategory: (poi?.category ?? "FOOD") as Category, timeSlot: timeSlot as TimeSlot }] }
          : d
      )
    );
    // API call
    const res = await fetch(`/api/cities/${cityId}/day-plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dayPlanId, poiId, timeSlot }),
    });
    if (res.ok) {
      router.refresh();
    }
    // Toast
    toast(`Added ${poi?.name ?? "place"} to timeline`);
  }, [liveDayPlans, pois, cityId, router, toast]);

  // ── Discover handlers ──
  function toggleCat(cat: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function toggleSubcat(cat: string, id: string) {
    setSubcats((prev) => {
      const current = new Set(prev[cat]);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return { ...prev, [cat]: current };
    });
  }

  async function onGenerate() {
    if (selected.size === 0 || generating) return;
    if (pois.length > 0 && overwriteMode === null) {
      setOverwriteMode("pending");
      return;
    }
    await runGenerate(false);
  }

  async function runGenerate(overwrite: boolean) {
    setOverwriteMode(null);
    if (selected.size === 0 || generating) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    setProgressStep("🔍 Discovering places…");

    let totalCreated = 0;
    const allFailures: Failure[] = [];

    // Separate FUEL from recommendation categories
    const recoCats = Array.from(selected).filter(
      (c): c is RecommendableCategory => STOP_CATEGORIES.includes(c as RecommendableCategory),
    );
    const includeFuel = selected.has("FUEL");

    // Run recommendation categories (FOOD, GROCERIES) via recommendations API
    if (recoCats.length > 0) {
      const subcategoriesPayload: Record<string, string[]> = {};
      for (const cat of recoCats) {
        const allowedIds = STOP_SUBCATEGORY_IDS[cat];
        const selectedIds = Array.from(subcats[cat] ?? []).filter((id) => allowedIds.includes(id));
        subcategoriesPayload[cat] = selectedIds;
      }

      const res = await fetch(`/api/cities/${cityId}/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: recoCats,
          counts: Object.fromEntries(recoCats.map((c) => [c, counts[c] ?? 10])),
          subcategories: subcategoriesPayload,
          cuisineFilter: cuisineFilter.trim() || undefined,
          preferences: [],
          nearbyTrips: false,
          overwrite,
          radiusKm,
          // Pass accommodation center if set
          ...(initialAccommodation ? { centerLat: initialAccommodation.latitude, centerLon: initialAccommodation.longitude } : {}),
        }),
      });

      if (res.ok) {
        const body: { created: number; failures: Failure[] } = await res.json();
        totalCreated += body.created;
        allFailures.push(...body.failures);
      } else {
        const body: { error?: string } = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to run Discover");
      }
    }

    // Run FUEL search via fuel-stations API
    if (includeFuel) {
      setProgressStep("⛽ Finding gas stations…");
      try {
        const res = await fetch(`/api/cities/${cityId}/fuel-stations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            radiusKm,
            overwrite,
            ...(initialAccommodation
              ? { centerLat: initialAccommodation.latitude, centerLon: initialAccommodation.longitude }
              : {}),
          }),
        });
        if (res.ok) {
          const body: { created: number } = await res.json();
          totalCreated += body.created;
        }
      } catch {
        allFailures.push({ category: "FOOD" as RecommendableCategory, error: "Gas station search failed" });
      }
    }

    setGenerating(false);
    setProgressStep(null);

    if (totalCreated > 0 || allFailures.length > 0) {
      setResult({ created: totalCreated, failures: allFailures });
      toast(
        `Added ${totalCreated} place${totalCreated === 1 ? "" : "s"}${
          allFailures.length > 0 ? ` · ${allFailures.length} failed` : ""
        }`,
      );
    }
    // Persist the discover radius (and accommodation center if used) to the database (best-effort)
    const persistData: Record<string, unknown> = { discoverRadiusKm: radiusKm };
    if (initialAccommodation) {
      persistData.latitude = initialAccommodation.latitude;
      persistData.longitude = initialAccommodation.longitude;
    }
    fetch(`/api/trips/${tripId}/cities/${cityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(persistData),
    }).catch(() => {/* best-effort */});
    router.refresh();
  }

  return (
    <>
      {lightbox && (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}

      {/* ── Notes Section ── */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5">
        {noteEditing ? (
          <div className="space-y-1">
            <textarea
              value={noteContent}
              onChange={(e) => handleNoteChange(e.target.value)}
              onBlur={handleNoteBlur}
              rows={3}
              placeholder="Write your notes..."
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1.5 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))] resize-y"
              autoFocus
            />
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
              {noteSaving ? "Saving..." : "Auto-saved on blur"}
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNoteEditing(true)}
            className="w-full text-left"
          >
            {noteContent.trim() ? (
              <p className="text-sm text-[hsl(var(--foreground))] whitespace-pre-wrap">{noteContent}</p>
            ) : (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">📝 Add a note...</p>
            )}
          </button>
        )}
      </div>

      {/* ── Discover Section ── */}
      <Card id="discover-section">
        <CardHeader className="pb-3">
          <button
            type="button"
            onClick={() => setDiscoverOpen((v) => !v)}
            className="flex w-full items-center justify-between"
          >
            <CardTitle className="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`h-4 w-4 text-[hsl(var(--muted-foreground))] transition-transform ${discoverOpen ? "rotate-90" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              🧭 Discover nearby
            </CardTitle>
            <span className="group relative cursor-help text-[hsl(var(--muted-foreground))]" tabIndex={0} role="button" onClick={(e) => e.stopPropagation()}>
              ⓘ
              <span className="pointer-events-none absolute right-0 top-6 z-20 w-56 max-w-[80vw] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-xs leading-relaxed shadow-lg opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                Find restaurants, groceries and gas stations near this travel stop.
              </span>
            </span>
          </button>
        </CardHeader>
        {discoverOpen && (
          <CardContent className="space-y-4">
            {/* Categories — including FUEL */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Categories
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ALL_STOP_CATS.map((cat) => {
                  const active = selected.has(cat);
                  const styles = CATEGORY_STYLES[cat as Category];
                  // Show subcategory description for categories with subcategories
                  let subDesc = "";
                  {
                    const selectedSubs = subcats[cat] ?? new Set();
                    const allowed = STOP_SUBCATEGORY_IDS[cat];
                    if (allowed) {
                      const catSubDefs = cat === "FUEL"
                        ? FUEL_SUBCATEGORIES.filter((s) => allowed.includes(s.id))
                        : (SUBCATEGORIES[cat as RecommendableCategory]?.filter((s) => allowed.includes(s.id)) ?? []);
                      const allSelected = selectedSubs.size >= catSubDefs.length;
                      subDesc = allSelected
                        ? ""
                        : catSubDefs.filter((s) => selectedSubs.has(s.id)).map((s) => s.label).join(", ");
                    }
                  }
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => !generating && toggleCat(cat)}
                      disabled={generating}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        active
                          ? `${styles.badge} border-transparent ring-1 ring-[hsl(var(--primary))]/20`
                          : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-50 hover:opacity-80"
                      }`}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: active ? styles.dot : "#9ca3af" }} />
                      {CATEGORY_ICON_MAP[cat]} {CATEGORY_LABELS[cat as Category]}
                      {subDesc && <span className="hidden sm:inline text-[10px] opacity-70">· {subDesc}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Radius slider */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                  Search radius
                </p>
                <span className="text-xs font-semibold tabular-nums text-[hsl(var(--foreground))]">
                  {radiusKm} km
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">1</span>
                <input
                  type="range"
                  min={1}
                  max={30}
                  step={1}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                  disabled={generating}
                  className="flex-1 accent-[hsl(var(--primary))] disabled:opacity-40"
                />
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">30</span>
              </div>
              <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                {initialAccommodation
                  ? `Centered on ${initialAccommodation.name}`
                  : "Centered on city center"}
                {" · "}{radiusKm} km radius
              </p>
            </div>

            {/* Advanced filters — only for FOOD/GROCERIES (not FUEL) */}
            {(selected.has("FOOD") || selected.has("GROCERIES")) && (
              <div>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                >
                  <span className={`transition-transform ${advancedOpen ? "rotate-90" : ""}`}>▶</span>
                  Subcategories
                  {Object.entries(subcats).some(
                    ([cat, s]) => {
                      const allowed = STOP_SUBCATEGORY_IDS[cat];
                      return allowed && s.size < allowed.length;
                    },
                  ) && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">active</span>
                  )}
                </button>

                {advancedOpen && (
                  <div className="mt-2 space-y-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3">
                    {(["FOOD", "GROCERIES", "FUEL"] as const).map((cat) => {
                      const active = selected.has(cat);
                      if (!active) return null;
                      const styles = CATEGORY_STYLES[cat];
                      const allowedIds = STOP_SUBCATEGORY_IDS[cat];
                      if (!allowedIds) return null;
                      const catSubcats = cat === "FUEL"
                        ? FUEL_SUBCATEGORIES.filter((s) => allowedIds.includes(s.id))
                        : (SUBCATEGORIES[cat as RecommendableCategory]?.filter((s) => allowedIds.includes(s.id)) ?? []);
                      const selectedSubs = subcats[cat] ?? new Set();

                      return (
                        <div key={cat} className="space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm">{CATEGORY_ICON_MAP[cat]}</span>
                            <span className="text-xs font-semibold">{CATEGORY_LABELS[cat]}</span>
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">max:</span>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={counts[cat] ?? 10}
                              onChange={(e) =>
                                setCounts((prev) => ({
                                  ...prev,
                                  [cat]: Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                                }))
                              }
                              disabled={generating}
                              className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs disabled:opacity-40"
                            />
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {catSubcats.map((sub) => {
                              const subActive = selectedSubs.has(sub.id);
                              return (
                                <button
                                  key={sub.id}
                                  type="button"
                                  onClick={() => toggleSubcat(cat, sub.id)}
                                  disabled={generating}
                                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                    subActive
                                      ? `${styles.badge} border-transparent`
                                      : "border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:bg-[hsl(var(--muted))]"
                                  }`}
                                >
                                  <span className="text-[10px]">{sub.emoji}</span>
                                  {sub.label}
                                </button>
                              );
                            })}
                          </div>

                          {/* Cuisine filter for FOOD */}
                          {cat === "FOOD" && (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-[hsl(var(--muted-foreground))] shrink-0">
                                Cuisine:
                              </span>
                              <input
                                type="text"
                                placeholder="e.g. italian, thai, sushi…"
                                value={cuisineFilter}
                                onChange={(e) => setCuisineFilter(e.target.value)}
                                disabled={generating}
                                className="flex-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-0.5 text-xs disabled:opacity-40"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Action */}
            <div className="flex flex-col items-center gap-2">
              {overwriteMode === "pending" && (
                <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">
                    ⚠️ You already have {pois.length} place{pois.length === 1 ? "" : "s"}. What would you like to do?
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => runGenerate(false)}
                      className="flex-1 text-xs"
                    >
                      ➕ Add to existing
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => runGenerate(true)}
                      className="flex-1 text-xs border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      🔄 Replace all
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setOverwriteMode(null)}
                      className="text-xs"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {progressStep && (
                <p className="text-sm text-[hsl(var(--muted-foreground))] animate-pulse">{progressStep}</p>
              )}
              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
              {result && !generating && (
                <p className="text-sm text-green-600 dark:text-green-400">
                  ✅ Added {result.created} place{result.created === 1 ? "" : "s"}
                  {result.failures.length > 0 && (
                    <span className="text-amber-600"> · {result.failures.length} failed</span>
                  )}
                </p>
              )}

              {overwriteMode !== "pending" && (
                <Button
                  type="button"
                  onClick={onGenerate}
                  disabled={generating || selected.size === 0}
                  className="w-full sm:w-2/3"
                >
                  {generating ? "Discovering…" : "🔍 Discover places"}
                </Button>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Map / List Section with Timeline Sidebar ── */}
      <Card id="pois-section">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              📍 Places
              {pois.length > 0 && (
                <span className="text-sm font-normal text-[hsl(var(--muted-foreground))]">
                  ({filterCategories.size > 0 || filterIncludedSubcats.size > 0 || filterSearch || filterFavouritesOnly
                    ? `${filteredPois.length}/${pois.length}`
                    : pois.length})
                </span>
              )}
            </CardTitle>

            {/* View toggle */}
            <div className="inline-flex rounded-md border border-[hsl(var(--border))] p-0.5">
              {(["map", "list"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-selected={view === key}
                  onClick={() => setView(key)}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    view === key
                      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                      : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                  }`}
                >
                  {key === "map" ? "🗺️ Map" : "📋 List"}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            {/* Left: map/list */}
            <div className="flex-1 min-w-0">
              {pois.length > 0 && (
                <div className="space-y-2 mb-4">
                  {/* Favourites toggle + category pills */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Favourites toggle */}
                    <button
                      type="button"
                      onClick={() => setFilterFavouritesOnly((v) => !v)}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        filterFavouritesOnly
                          ? "border-pink-300 bg-pink-50 text-pink-700 dark:border-pink-700 dark:bg-pink-950/30 dark:text-pink-300"
                          : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                      }`}
                      title="Show favourites only"
                    >
                      <HeartIcon filled={filterFavouritesOnly} className="h-3 w-3" /> Favourites
                    </button>

                    {/* "All" button */}
                    <button
                      type="button"
                      onClick={() => {
                        setFilterCategories(new Set());
                        setFilterIncludedSubcats(new Set());
                      }}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        filterCategories.size === 0
                          ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] ring-1 ring-[hsl(var(--primary))]/20"
                          : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] opacity-50"
                      }`}
                    >
                      All
                    </button>

                    {presentCategories.map((cat) => {
                      const active = filterCategories.size === 0 || filterCategories.has(cat);
                      const catKey = cat as Category;
                      const count = pois.filter((p) => p.category === cat).length;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            setFilterCategories((prev) => {
                              if (prev.size === 0) {
                                return new Set([cat]);
                              }
                              const next = new Set(prev);
                              if (next.has(cat)) {
                                next.delete(cat);
                                if (next.size === 0) return new Set();
                              } else {
                                next.add(cat);
                                if (next.size === presentCategories.length) return new Set();
                              }
                              return next;
                            });
                            setFilterIncludedSubcats(new Set());
                          }}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                            active
                              ? `${CATEGORY_STYLES[catKey].badge} ring-1 ring-[hsl(var(--primary))]/20`
                              : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] opacity-50"
                          }`}
                        >
                          {CATEGORY_ICONS[catKey]} {CATEGORY_LABELS[catKey]} ({count})
                        </button>
                      );
                    })}
                  </div>

                  {/* Subcategory chips */}
                  {presentSubcategories.size > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {Array.from(presentSubcategories.entries()).map(([sub, count]) => {
                        const included = filterIncludedSubcats.has(sub);
                        const isActive = filterIncludedSubcats.size === 0 || included;
                        return (
                          <button
                            key={sub}
                            type="button"
                            onClick={() => {
                              setFilterIncludedSubcats((prev) => {
                                const next = new Set(prev);
                                if (next.has(sub)) next.delete(sub);
                                else next.add(sub);
                                return next;
                              });
                            }}
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                              isActive
                                ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
                                : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] opacity-50"
                            }`}
                          >
                            {sub.replace(/_/g, " ")} ({count})
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Search + sort row (sort only in list view) */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={filterSearch}
                        onChange={(e) => setFilterSearch(e.target.value)}
                        placeholder="Search places..."
                        className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-xs placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                      />
                      {filterSearch && (
                        <button
                          type="button"
                          onClick={() => setFilterSearch("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    {view === "list" && (
                      <select
                        value={filterSort}
                        onChange={(e) => setFilterSort(e.target.value as "rating" | "name" | "reviews")}
                        className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs"
                      >
                        <option value="rating">Rating</option>
                        <option value="name">Name</option>
                        <option value="reviews">Reviews</option>
                      </select>
                    )}
                  </div>

                  {/* Active filter count */}
                  {(filterCategories.size > 0 || filterIncludedSubcats.size > 0 || filterSearch || filterFavouritesOnly) && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                        Showing {filteredPois.length} of {pois.length} places
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setFilterCategories(new Set());
                          setFilterIncludedSubcats(new Set());
                          setFilterSearch("");
                          setFilterFavouritesOnly(false);
                        }}
                        className="text-[10px] text-[hsl(var(--primary))] hover:underline"
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
              )}
              {view === "map" ? (
                <div className="relative min-h-[400px] lg:min-h-[500px]">
                  <PoiMap
                    pois={filteredPois}
                    cityId={cityId}
                    cityLat={centerLat}
                    cityLon={centerLon}
                    radiusKm={radiusKm}
                    dayPlans={liveDayPlans.map((d) => ({ id: d.id, label: d.date }))}
                    dragOnly
                    focusPoiId={focusPoiId}
                    onFocusConsumed={() => setFocusPoiId(null)}
                    onViewInList={(poiId) => { setFocusPoiId(poiId); setView("list"); }}
                    favouriteItems={favouriteItems}
                    onFavourite={(poi) => handleFavourite(poi as StopPoiDTO)}
                    isPoiFavourited={(poi) => isPoiFavourited(poi as StopPoiDTO)}
                  />
                </div>
              ) : pois.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] py-4 text-center">
                  No places discovered yet. Use the Discover section above to find restaurants, groceries, and gas stations nearby.
                </p>
              ) : filteredPois.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))] py-4 text-center">
                  No places match the current filters.
                </p>
              ) : (
                <div className="space-y-6">
                  {Object.entries(poisByCategory).map(([cat, catPois]) => (
                    <div key={cat} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{CATEGORY_ICONS[cat as Category]}</span>
                        <h3 className="text-sm font-semibold">{CATEGORY_LABELS[cat as Category]}</h3>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">({catPois.length})</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {catPois.map((poi) => (
                          <StopPoiCard
                            key={poi.id}
                            poi={poi}
                            onViewOnMap={(id) => { setFocusPoiId(id); setView("map"); }}
                            onFavourite={handleFavourite}
                            isFavourited={isPoiFavourited(poi)}
                            onOpenLightbox={(src, alt) => setLightbox({ src, alt })}
                            onEdit={(p) => setEditingPoi({
                              id: p.id, name: p.name, category: p.category, subcategory: p.subcategory,
                              description: p.description, latitude: p.latitude, longitude: p.longitude,
                              website: p.website, phoneNumber: p.phoneNumber,
                              openingHours: p.openingHours, photoUrl: p.photoUrl, priceLevel: p.priceLevel,
                              fee: p.fee, address: p.address, notes: p.notes,
                              cityName: cityName ?? null, country: country ?? null,
                              visited: false, personalRating: null,
                              extraFields: p.extraFields,
                              hasOriginalData: p.hasOriginalData,
                            })}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Right: timeline sidebar */}
            <div className="hidden lg:block w-56 shrink-0">
              <TimelineSidebar
                dayPlans={liveDayPlans}
                onDropPoi={handleDropPoiOnTimeline}
                compact
              />
            </div>
          </div>
        </CardContent>
      </Card>
      {editingPoi && (
        <EditPoiModal poi={editingPoi} onClose={() => setEditingPoi(null)} />
      )}
    </>
  );
}
