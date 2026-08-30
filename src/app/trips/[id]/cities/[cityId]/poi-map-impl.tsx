"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, {
  Marker,
  Popup,
  NavigationControl,
  ScaleControl,
  Source,
  Layer,
  type MapRef,
} from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { CATEGORIES, CATEGORY_STYLES, CATEGORY_LABELS, CATEGORY_ICONS, isCategory, type Category } from "@/lib/categories";
import { TIME_SLOTS, type TimeSlot } from "@/lib/slots";
import { ACCOMMODATION_SUBCATEGORIES } from "@/lib/favourite-fields";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { FavouriteItemDTO } from "@/components/favourites/favourites-provider";

// ─── Types ────────────────────────────────────────────────────────────────────

type LocatedPoi = {
  id: number;
  name: string;
  category: Category;
  subcategory?: string | null;
  description: string | null;
  latitude: number;
  longitude: number;
  rating?: number | null;
  photoUrl?: string | null;
  userRatingCount?: number | null;
};

export type DayPlanOption = { id: number; label: string };

export type PoiMapProps = {
  pois: { id: number; name: string; category: Category; subcategory?: string | null; description: string | null; latitude: number | null; longitude: number | null; rating?: number | null; photoUrl?: string | null; userRatingCount?: number | null; placeId?: string | null }[];
  cityId?: number;
  cityLat?: number;
  cityLon?: number;
  radiusKm?: number;
  nearbyRadiusKm?: number;
  dayPlans?: DayPlanOption[];
  focusPoiId?: number | null;
  onAddAtLocation?: (lat: number, lng: number) => void;
  onViewInList?: (poiId: number) => void;
  routeGeoJson?: GeoJSON.FeatureCollection | null;
  userRatings?: Record<number, number>;
  notInterested?: Set<number>;
  onRatePoi?: (poiId: number, rating: number | null) => void;
  onToggleNotInterested?: (poiId: number) => void;
  /** Called once after flyTo completes so the parent can clear focusPoiId */
  onFocusConsumed?: () => void;
  /** Favourite items to display on the map with heart-ring markers */
  favouriteItems?: FavouriteItemDTO[];
  /** Add a POI to favourites */
  onFavourite?: (poi: { id: number; name: string; category: Category; subcategory?: string | null; description: string | null; latitude: number; longitude: number; photoUrl?: string | null; placeId?: string | null; website?: string | null }) => void;
  /** Check if a POI is already favourited */
  isPoiFavourited?: (poi: { id: number; name: string; placeId?: string | null; favouriteItemId?: number | null }) => boolean;
  /** Optional numbered labels for POIs (poiId → display number). When set, markers show the number instead of the category emoji. */
  poiNumbers?: Record<number, number>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** Resolve the emoji for a marker based on category + optional subcategory */
function getMarkerEmoji(category: Category, subcategory?: string | null): string {
  if (category === "ACCOMMODATION" && subcategory) {
    const sub = ACCOMMODATION_SUBCATEGORIES.find((s) => s.id === subcategory);
    if (sub) return sub.emoji;
  }
  return CATEGORY_ICONS[category];
}

const MAP_STYLES = {
  streets: "mapbox://styles/mapbox/light-v11",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
} as const;
type MapStyleKey = keyof typeof MAP_STYLES;

// ─── Cluster helpers ──────────────────────────────────────────────────────────

type ClusterCell = { pois: LocatedPoi[]; lat: number; lng: number };

function clusterPois(pois: LocatedPoi[], zoom: number): ClusterCell[] {
  // Smaller divisor → each cell is larger → less aggressive clustering
  const cellDeg = 10 / Math.pow(2, zoom);
  const grid = new Map<string, LocatedPoi[]>();
  for (const p of pois) {
    const key = `${Math.floor(p.latitude / cellDeg)},${Math.floor(p.longitude / cellDeg)}`;
    const cell = grid.get(key) ?? [];
    cell.push(p);
    grid.set(key, cell);
  }
  return Array.from(grid.values()).map((cell) => ({
    pois: cell,
    lat: cell.reduce((s, p) => s + p.latitude, 0) / cell.length,
    lng: cell.reduce((s, p) => s + p.longitude, 0) / cell.length,
  }));
}

/** Approximate a circle as a GeoJSON polygon (equirectangular projection — fine for ≤50 km). */
function makeRadiusCircle(lat: number, lon: number, radiusKm: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const STEPS = 72;
  const pts: [number, number][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const angle = (i / STEPS) * 2 * Math.PI;
    const dLat = (radiusKm * Math.sin(angle)) / 111.32;
    const dLon = (radiusKm * Math.cos(angle)) / (111.32 * Math.cos((lat * Math.PI) / 180));
    pts.push([lon + dLon, lat + dLat]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } };
}

function ClusterPie({ pois }: { pois: LocatedPoi[] }) {
  const size = Math.min(28 + pois.length * 2, 48);
  const r = size / 2;
  const ir = r * 0.55; // inner radius for the count circle

  // Count per category
  const counts = new Map<Category, number>();
  for (const p of pois) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const total = pois.length;

  // Build pie slices
  const slices: { color: string; startAngle: number; endAngle: number }[] = [];
  let angle = -Math.PI / 2;
  for (const [cat, count] of counts) {
    const sweep = (count / total) * 2 * Math.PI;
    slices.push({ color: CATEGORY_STYLES[cat].dot, startAngle: angle, endAngle: angle + sweep });
    angle += sweep;
  }

  return (
    <svg width={size} height={size} style={{ display: "block", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.25))" }}>
      {slices.length === 1 ? (
        <circle cx={r} cy={r} r={r} fill={slices[0].color} stroke="white" strokeWidth={1} />
      ) : (
        slices.map((s, i) => {
          const x1 = r + r * Math.cos(s.startAngle);
          const y1 = r + r * Math.sin(s.startAngle);
          const x2 = r + r * Math.cos(s.endAngle);
          const y2 = r + r * Math.sin(s.endAngle);
          const large = s.endAngle - s.startAngle > Math.PI ? 1 : 0;
          return (
            <path
              key={i}
              d={`M${r},${r} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`}
              fill={s.color}
              stroke="white"
              strokeWidth={1}
            />
          );
        })
      )}
      <circle cx={r} cy={r} r={ir} fill="white" />
      <text x={r} y={r} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.3} fontWeight="bold" fill="#334155">
        {total}
      </text>
    </svg>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryLegend({ showFavourites }: { showFavourites?: boolean }) {
  return (
    <div className="pointer-events-none absolute bottom-8 left-2 z-10 rounded-lg border border-[hsl(var(--border))] bg-white/90 p-2 shadow text-xs space-y-1 backdrop-blur-sm">
      {CATEGORIES.map((c) => (
        <div key={c} className="flex items-center gap-1.5">
          <span
            className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2"
            style={{ borderColor: CATEGORY_STYLES[c].dot, backgroundColor: "white" }}
          >
            <span style={{ fontSize: 9 }}>{CATEGORY_ICONS[c]}</span>
          </span>
          <span className="text-gray-700">{c}</span>
        </div>
      ))}
      {showFavourites && (
        <div className="flex items-center gap-1.5 border-t border-gray-200 pt-1 mt-1">
          <span className="relative inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 border-gray-400 bg-white">
            <span style={{ fontSize: 7 }}>🏛️</span>
            <span className="absolute -bottom-0.5 -right-1 flex h-2 w-2 items-center justify-center rounded-full bg-pink-500">
              <svg width="5" height="5" viewBox="0 0 24 24" fill="white" stroke="none">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
              </svg>
            </span>
          </span>
          <span className="text-gray-700">Favourite</span>
        </div>
      )}
    </div>
  );
}

function PopupContent({
  poi,
  cityId,
  dayPlans,
  onClose,
  onViewInList,
  userRatings,
  notInterested,
  onRatePoi,
  onToggleNotInterested,
  onFavourite,
  isFavourited,
}: {
  poi: LocatedPoi;
  cityId: number;
  dayPlans: DayPlanOption[];
  onClose: () => void;
  onViewInList?: (poiId: number) => void;
  userRatings?: Record<number, number>;
  notInterested?: Set<number>;
  onRatePoi?: (poiId: number, rating: number | null) => void;
  onToggleNotInterested?: (poiId: number) => void;
  onFavourite?: (poi: LocatedPoi) => void;
  isFavourited?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot>("MORNING");
  const [assigning, setAssigning] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [hoverStar, setHoverStar] = useState<number | null>(null);
  // Multi-day mode for accommodation
  const [selectedDays, setSelectedDays] = useState<Set<number>>(() => new Set());
  const isAccommodation = poi.category === "ACCOMMODATION";

  async function assign() {
    if (!selectedDay) return;
    setAssigning(true);
    const res = await fetch(`/api/day-plans/${selectedDay}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ poiId: poi.id, timeSlot: selectedSlot }),
    });
    setAssigning(false);
    if (!res.ok) {
      toast("Failed to assign POI", { variant: "error" });
      return;
    }
    toast(`${poi.name} added to plan!`);
    router.refresh();
    onClose();
  }

  async function assignMultiDay() {
    if (selectedDays.size === 0) return;
    setAssigning(true);
    const res = await fetch("/api/day-plans/batch-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poiId: poi.id,
        dayPlanIds: [...selectedDays],
        timeSlot: "EVENING",
      }),
    });
    setAssigning(false);
    if (res.ok) {
      const data = await res.json();
      toast(`${poi.name} assigned to ${data.created} day${data.created !== 1 ? "s" : ""}!`);
      router.refresh();
      onClose();
    } else {
      toast("Failed to assign", { variant: "error" });
    }
  }

  const currentRating = userRatings?.[poi.id];
  const displayStars = hoverStar ?? currentRating ?? 0;

  function formatCount(n: number) {
    if (n >= 10000) return `${Math.round(n / 1000)}K`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return `${n}`;
  }

  return (
    <div className="min-w-[200px] max-w-[260px] space-y-2 text-sm">
      {poi.photoUrl && !imgError && (
        <img
          src={`/api/pois/${poi.id}/photo`}
          alt={poi.name}
          onError={() => setImgError(true)}
          className="w-full h-24 object-cover rounded-md"
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold leading-tight">{poi.name}</span>
        <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_STYLES[poi.category].badge}`}>
          {CATEGORY_ICONS[poi.category]} {poi.category}
        </span>
      </div>
      {/* Drag handle for timeline — only shown when day plans exist */}
      {dayPlans.length > 0 && (
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "copy";
            e.dataTransfer.setData("application/x-poi-id", String(poi.id));
          }}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-[hsl(var(--border))] px-2 py-1.5 cursor-grab active:cursor-grabbing hover:bg-[hsl(var(--muted))] transition-colors"
          title="Drag to timeline"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <rect x="7" y="5" width="3" height="3" rx="1"/><rect x="14" y="5" width="3" height="3" rx="1"/>
            <rect x="7" y="11" width="3" height="3" rx="1"/><rect x="14" y="11" width="3" height="3" rx="1"/>
            <rect x="7" y="17" width="3" height="3" rx="1"/><rect x="14" y="17" width="3" height="3" rx="1"/>
          </svg>
          <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Drag to timeline</span>
        </div>
      )}
      {poi.description && (
        <p className="text-xs text-gray-600 leading-snug">
          {expanded || poi.description.length <= 100
            ? poi.description
            : poi.description.slice(0, 100) + "…"}
          {poi.description.length > 100 && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="ml-1 text-blue-600 hover:underline">
              {expanded ? "less" : "more"}
            </button>
          )}
        </p>
      )}
      {(poi.rating != null || poi.userRatingCount != null) && (
        <p className="flex items-center gap-1 text-xs text-gray-500">
          {poi.rating != null && (
            <span className="text-amber-500 font-medium">⭐ {poi.rating.toFixed(1)}</span>
          )}
          {poi.userRatingCount != null && (
            <span>({formatCount(poi.userRatingCount)} reviews)</span>
          )}
        </p>
      )}
      {onRatePoi && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">My rating:</span>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onMouseEnter={() => setHoverStar(star)}
                onMouseLeave={() => setHoverStar(null)}
                onClick={(e) => { e.stopPropagation(); onRatePoi(poi.id, currentRating === star ? null : star); }}
                className={`text-base leading-none transition-colors ${star <= displayStars ? "text-amber-400" : "text-gray-300"}`}
              >★</button>
            ))}
          </div>
          {onToggleNotInterested && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleNotInterested(poi.id); }}
              className={`rounded px-1 py-0.5 text-[10px] ${notInterested?.has(poi.id) ? "text-red-500" : "text-gray-400 hover:text-red-400"}`}
              title={notInterested?.has(poi.id) ? "Remove not interested" : "Not interested"}
            >✕</button>
          )}
        </div>
      )}
      {/* Favourite button — large and tap-friendly for mobile */}
      {onFavourite && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onFavourite(poi); }}
          className={`flex w-full items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
            isFavourited
              ? "bg-pink-50 text-pink-500 border border-pink-200"
              : "bg-gray-50 text-gray-600 border border-gray-200 hover:border-pink-300 hover:text-pink-500"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill={isFavourited ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
          {isFavourited ? "Saved to favourites" : "Add to favourites"}
        </button>
      )}
      {dayPlans.length > 0 && (
        <details className="group" onClick={(e) => e.stopPropagation()}>
          <summary className="cursor-pointer select-none text-xs font-medium text-blue-600 hover:underline list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            Add to Day Plan
          </summary>
          <div className="mt-2 space-y-1.5">
            {isAccommodation ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wider">🏠 Select days</span>
                  <button
                    type="button"
                    onClick={() => setSelectedDays(new Set(dayPlans.map((d) => d.id)))}
                    className="text-[10px] text-indigo-500 hover:text-indigo-700"
                  >Select all</button>
                </div>
                <div className="max-h-[140px] overflow-y-auto space-y-0.5">
                  {dayPlans.map((d) => (
                    <label key={d.id} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs cursor-pointer hover:bg-indigo-100/30">
                      <input
                        type="checkbox"
                        checked={selectedDays.has(d.id)}
                        onChange={() => setSelectedDays((prev) => {
                          const next = new Set(prev);
                          if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                          return next;
                        })}
                        disabled={assigning}
                        className="rounded border-indigo-300"
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
                {selectedDays.size > 0 && (
                  <button
                    type="button"
                    onClick={assignMultiDay}
                    disabled={assigning}
                    className="w-full rounded bg-indigo-500 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
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
                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                >
                  <option value="">Pick a day…</option>
                  {dayPlans.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
                <select
                  value={selectedSlot}
                  onChange={(e) => setSelectedSlot(e.target.value as TimeSlot)}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                >
                  {TIME_SLOTS.map((s) => (
                    <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); assign(); }}
                  disabled={!selectedDay || assigning}
                  className="w-full rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40 hover:bg-blue-700"
                >
                  {assigning ? "Adding…" : `Add to ${selectedSlot.toLowerCase()}`}
                </button>
              </>
            )}
          </div>
        </details>
      )}
      {onViewInList && (
        <button
          type="button"
          onClick={() => { onViewInList(poi.id); onClose(); }}
          className="w-full rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
        >
          📋 View full details
        </button>
      )}
    </div>
  );
}

// ─── Favourite marker & popup ─────────────────────────────────────────────────

function FavouriteMarkerIcon({ category, subcategory, active }: { category: Category; subcategory?: string | null; active?: boolean }) {
  const color = CATEGORY_STYLES[category].dot;
  const size = active ? 34 : 28;
  const emoji = getMarkerEmoji(category, subcategory);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className="flex items-center justify-center rounded-full shadow-md transition-transform"
        style={{
          width: size,
          height: size,
          backgroundColor: "white",
          border: `${active ? 3 : 2.5}px solid ${color}`,
          transform: active ? "scale(1.15)" : "scale(1)",
          boxShadow: active
            ? `0 3px 8px rgba(0,0,0,0.35), 0 0 0 2px ${color}40`
            : "0 2px 6px rgba(0,0,0,0.3)",
        }}
      >
        <span style={{ fontSize: active ? 17 : 14, lineHeight: 1 }}>{emoji}</span>
      </div>
      {/* Heart badge — bottom-right */}
      <div
        className="absolute flex items-center justify-center rounded-full bg-pink-500 border border-white"
        style={{ bottom: 0, right: -3, width: 15, height: 15, boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="white" stroke="none">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
        </svg>
      </div>
    </div>
  );
}

function FavouritePopupContent({
  item,
  cityId,
  onClose,
  onImported,
}: {
  item: FavouriteItemDTO;
  cityId: number;
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const [importing, setImporting] = useState(false);
  const [imgError, setImgError] = useState(false);
  const cat = isCategory(item.category) ? item.category : "CULTURE";

  async function handleImport() {
    setImporting(true);
    try {
      const res = await fetch(`/api/cities/${cityId}/pois`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: item.name,
          category: item.category,
          subcategory: item.subcategory || undefined,
          description: item.description || undefined,
          latitude: item.latitude,
          longitude: item.longitude,
          photoUrl: item.photoUrl || undefined,
          website: item.website || undefined,
        }),
      });
      if (res.ok) {
        toast(`"${item.name}" added as POI!`);
        onImported();
        onClose();
      } else {
        toast("Failed to add POI", { variant: "error" });
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="min-w-[200px] max-w-[260px] space-y-2 text-sm">
      {item.photoUrl && !imgError && (
        <img src={item.photoUrl} alt={item.name} onError={() => setImgError(true)}
          className="w-full h-24 object-cover rounded-md" />
      )}
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold leading-tight">{item.name}</span>
        <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_STYLES[cat].badge}`}>
          {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
        </span>
      </div>
      <div className="flex items-center gap-1 text-xs text-pink-500 font-medium">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
        </svg>
        Favourite{item.list ? ` · ${item.list.name}` : ""}
      </div>
      {item.description && (
        <p className="text-xs text-gray-600 leading-snug line-clamp-3">{item.description}</p>
      )}
      {item.notes && (
        <p className="text-xs text-gray-500 italic">📝 {item.notes}</p>
      )}
      {item.address && (
        <p className="text-xs text-gray-500">📍 {item.address}</p>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); handleImport(); }}
        disabled={importing}
        className="w-full rounded bg-pink-500 px-2 py-1 text-xs font-medium text-white hover:bg-pink-600 disabled:opacity-50"
      >
        {importing ? "Adding…" : "📌 Add as POI in this city"}
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PoiMapImpl(props: PoiMapProps) {
  const { pois, cityId, cityLat, cityLon, radiusKm, nearbyRadiusKm, dayPlans = [], focusPoiId, onAddAtLocation, onViewInList, userRatings, notInterested, onRatePoi, onToggleNotInterested, onFocusConsumed, favouriteItems = [], onFavourite, isPoiFavourited, poiNumbers } = props;
  const router = useRouter();
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeId, setActiveId] = useState<number | null>(focusPoiId ?? null);
  const [activeFavId, setActiveFavId] = useState<number | null>(null);
  const [favPopupPos, setFavPopupPos] = useState<{ x: number; y: number } | null>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);

  function scheduleHoverClose() {
    if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = setTimeout(() => setHoverId(null), 400);
  }
  function cancelHoverClose() {
    if (hoverCloseTimer.current) { clearTimeout(hoverCloseTimer.current); hoverCloseTimer.current = null; }
  }
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [mapStyle, setMapStyle] = useState<MapStyleKey>("streets");
  const [zoom, setZoom] = useState(12);
  const [dropPin, setDropPin] = useState<{ lat: number; lng: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreen(!!document.fullscreenElement);
      setTimeout(() => mapRef.current?.resize(), 100);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Long-press on touch devices → drop pin (equivalent to right-click on desktop)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!onAddAtLocation) return;
    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) return;

    function clearLongPress() {
      if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
      longPressOrigin.current = null;
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) { clearLongPress(); return; }
      const touch = e.touches[0];
      longPressOrigin.current = { x: touch.clientX, y: touch.clientY };
      longPressTimer.current = setTimeout(() => {
        const map = mapRef.current;
        if (!map || !longPressOrigin.current) return;
        // Convert screen point to map coordinates
        const rect = canvas!.getBoundingClientRect();
        const x = longPressOrigin.current.x - rect.left;
        const y = longPressOrigin.current.y - rect.top;
        const lngLat = map.unproject([x, y]);
        setDropPin({ lat: lngLat.lat, lng: lngLat.lng });
        setActiveId(null);
        setActiveFavId(null);
        clearLongPress();
        // Prevent the subsequent touchend from triggering a click
        canvas!.addEventListener("touchend", (ev) => { ev.preventDefault(); }, { once: true });
      }, 500);
    }

    function onTouchMove(e: TouchEvent) {
      if (!longPressOrigin.current || e.touches.length !== 1) { clearLongPress(); return; }
      const touch = e.touches[0];
      const dx = touch.clientX - longPressOrigin.current.x;
      const dy = touch.clientY - longPressOrigin.current.y;
      // Cancel if finger moves more than 10px (user is panning)
      if (Math.sqrt(dx * dx + dy * dy) > 10) clearLongPress();
    }

    function onTouchEnd() { clearLongPress(); }

    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("touchcancel", onTouchEnd);
    return () => {
      clearLongPress();
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [onAddAtLocation, mapReady]);

  const located: LocatedPoi[] = useMemo(
    () => pois.flatMap((p) =>
      p.latitude != null && p.longitude != null
        ? [{ ...p, latitude: p.latitude, longitude: p.longitude, subcategory: p.subcategory, rating: p.rating, photoUrl: p.photoUrl, userRatingCount: p.userRatingCount }]
        : [],
    ),
    [pois],
  );

  // Favourite items that aren't already represented as POIs (by sourcePlaceId or name)
  const poiPlaceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of pois) if (p.placeId) ids.add(p.placeId);
    return ids;
  }, [pois]);

  const poiNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of pois) names.add(p.name.toLowerCase());
    return names;
  }, [pois]);

  const visibleFavourites = useMemo(
    () => favouriteItems.filter((f) =>
      f.latitude != null && f.longitude != null &&
      !(f.sourcePlaceId && poiPlaceIds.has(f.sourcePlaceId)) &&
      !poiNames.has(f.name.toLowerCase())
    ),
    [favouriteItems, poiPlaceIds, poiNames],
  );

  // Track which POIs are also favourited (for heart indicator on markers)
  // Uses the global isPoiFavourited check (from favourites provider) when available,
  // otherwise falls back to matching against the local favouriteItems prop.
  const favouritedPoiIds = useMemo(() => {
    const ids = new Set<number>();
    if (isPoiFavourited) {
      for (const poi of pois) {
        if (isPoiFavourited(poi)) ids.add(poi.id);
      }
    } else {
      const favPlaceIds = new Set<string>();
      const favNames = new Set<string>();
      for (const fav of favouriteItems) {
        if (fav.sourcePlaceId) favPlaceIds.add(fav.sourcePlaceId);
        if (fav.name) favNames.add(fav.name.toLowerCase());
      }
      for (const poi of pois) {
        if (poi.placeId && favPlaceIds.has(poi.placeId)) { ids.add(poi.id); continue; }
        if (favNames.has(poi.name.toLowerCase())) ids.add(poi.id);
      }
    }
    return ids;
  }, [pois, favouriteItems, isPoiFavourited],
  );

  // Floor to integer so sub-pixel zoom differences don't re-trigger clustering
  const clusterZoom = Math.floor(zoom);
  const clusters = useMemo(() => clusterPois(located, clusterZoom), [located, clusterZoom]);

  const visibleId = hoverId ?? activeId;
  const visiblePoi = visibleId != null ? located.find((p) => p.id === visibleId) : null;
  const activeFavItem = activeFavId != null ? visibleFavourites.find((f) => f.id === activeFavId) : null;

  // Track the screen position of the visible POI so we can render the popup
  // outside the map's overflow-hidden container.
  useEffect(() => {
    if (!visiblePoi || !mapRef.current || !mapReady) { setPopupPos(null); return; }
    function updatePos() {
      if (!mapRef.current || !visiblePoi) return;
      const pt = mapRef.current.project([visiblePoi.longitude, visiblePoi.latitude]);
      setPopupPos({ x: pt.x, y: pt.y });
    }
    updatePos();
    const mapInstance = mapRef.current.getMap();
    mapInstance.on("move", updatePos);
    mapInstance.on("zoom", updatePos);
    return () => { mapInstance.off("move", updatePos); mapInstance.off("zoom", updatePos); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePoi, mapReady]);

  // Track screen position of active favourite item popup
  useEffect(() => {
    if (!activeFavItem || !mapRef.current || !mapReady) { setFavPopupPos(null); return; }
    function updatePos() {
      if (!mapRef.current || !activeFavItem) return;
      const pt = mapRef.current.project([activeFavItem.longitude, activeFavItem.latitude]);
      setFavPopupPos({ x: pt.x, y: pt.y });
    }
    updatePos();
    const mapInstance = mapRef.current.getMap();
    mapInstance.on("move", updatePos);
    mapInstance.on("zoom", updatePos);
    return () => { mapInstance.off("move", updatePos); mapInstance.off("zoom", updatePos); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFavItem, mapReady]);

  const fitBounds = useCallback(() => {
    const map = mapRef.current;
    const allPoints = [
      ...located.map((p) => ({ lat: p.latitude, lng: p.longitude })),
      ...visibleFavourites.map((f) => ({ lat: f.latitude, lng: f.longitude })),
    ];
    if (!map || allPoints.length === 0) return;
    if (allPoints.length === 1) {
      map.flyTo({ center: [allPoints[0].lng, allPoints[0].lat], zoom: 14, duration: 800 });
      return;
    }
    const lngs = allPoints.map((p) => p.lng);
    const lats = allPoints.map((p) => p.lat);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 60, duration: 800, maxZoom: 15 },
    );
  }, [located, visibleFavourites]);

  const fitBoundsNoAccommodation = useCallback(() => {
    const map = mapRef.current;
    const nonAccom = located.filter((p) => p.category !== "ACCOMMODATION");
    const allPoints = [
      ...nonAccom.map((p) => ({ lat: p.latitude, lng: p.longitude })),
      ...visibleFavourites.filter((f) => f.category !== "ACCOMMODATION").map((f) => ({ lat: f.latitude, lng: f.longitude })),
    ];
    if (!map || allPoints.length === 0) return;
    if (allPoints.length === 1) {
      map.flyTo({ center: [allPoints[0].lng, allPoints[0].lat], zoom: 14, duration: 800 });
      return;
    }
    const lngs = allPoints.map((p) => p.lng);
    const lats = allPoints.map((p) => p.lat);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 60, duration: 800, maxZoom: 15 },
    );
  }, [located, visibleFavourites]);

  useEffect(() => {
    if (!focusPoiId) return;
    const poi = located.find((p) => p.id === focusPoiId);
    if (!poi || !mapRef.current) return;
    // Offset downward so the popup above the marker is fully visible
    mapRef.current.flyTo({ center: [poi.longitude, poi.latitude], zoom: 15, duration: 800, offset: [0, 60] });
    setActiveId(focusPoiId);
    // Tell parent to clear focusPoiId so later interactions don't snap back to this POI
    onFocusConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPoiId, located]);

  if (!token) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Set <code className="rounded bg-[hsl(var(--muted))] px-1">NEXT_PUBLIC_MAPBOX_TOKEN</code> in your <code>.env</code> to enable the map.
      </p>
    );
  }

  // Determine the initial map centre: use first POI, or favourite, or fall back to city centre
  const hasLocated = located.length > 0;
  const hasFavourites = visibleFavourites.length > 0;
  const hasCityCenter = cityLat != null && cityLon != null;

  if (!hasLocated && !hasFavourites && !hasCityCenter) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">No POIs with coordinates yet.</p>;
  }

  const centerLat = hasLocated ? located[0].latitude : hasFavourites ? visibleFavourites[0].latitude : cityLat!;
  const centerLon = hasLocated ? located[0].longitude : hasFavourites ? visibleFavourites[0].longitude : cityLon!;

  // GeoJSON circle for city radius (only when city centre + radius are known)
  const circleData: GeoJSON.Feature<GeoJSON.Polygon> | null =
    hasCityCenter && radiusKm != null && radiusKm > 0
      ? makeRadiusCircle(cityLat!, cityLon!, radiusKm)
      : null;

  // GeoJSON circle for nearby radius (orange dotted, different style)
  // Commented out — nearby attractions section is disabled
  // const nearbyCircleData: GeoJSON.Feature<GeoJSON.Polygon> | null =
  //   hasCityCenter && nearbyRadiusKm != null && nearbyRadiusKm > 0
  //     ? makeRadiusCircle(cityLat!, cityLon!, nearbyRadiusKm)
  //     : null;
  const nearbyCircleData = null;

  return (
    <div ref={containerRef} className="poi-map-outer relative rounded-xl border border-[hsl(var(--border))]">
      <div className="absolute left-2 top-2 z-10 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={fitBounds}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-[hsl(var(--background))] backdrop-blur-sm"
          title="Fit all points"
        >
          ⊡ Fit all
        </button>
        {located.some((p) => p.category === "ACCOMMODATION") && (
          <button
            type="button"
            onClick={fitBoundsNoAccommodation}
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-[hsl(var(--background))] backdrop-blur-sm"
            title="Fit all except accommodation"
          >
            ⊡ Fit (no accom.)
          </button>
        )}
        <button
          type="button"
          onClick={() => setMapStyle((s) => (s === "streets" ? "satellite" : "streets"))}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-[hsl(var(--background))] backdrop-blur-sm"
        >
          {mapStyle === "streets" ? "🛰 Satellite" : "🗺 Streets"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!document.fullscreenElement) {
              containerRef.current?.requestFullscreen();
            } else {
              document.exitFullscreen();
            }
          }}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-[hsl(var(--background))] backdrop-blur-sm"
        >
          {fullscreen ? "✕ Exit fullscreen" : "⛶ Fullscreen"}
        </button>
      </div>

      <MapGL
        ref={mapRef}
        mapboxAccessToken={token}
        initialViewState={{ longitude: centerLon, latitude: centerLat, zoom: 12 }}
        style={{ width: "100%", height: fullscreen ? "100dvh" : "clamp(500px, 75vh, 1100px)" }}
        mapStyle={MAP_STYLES[mapStyle]}
        onLoad={() => {
          setMapReady(true);
          if (hasLocated || hasFavourites) {
            fitBounds();
          } else if (hasCityCenter) {
            // Fit to a 20 km context (or nearbyRadiusKm if larger), so the
            // city radius circle sits well within view
            const fitKm = Math.max(20, nearbyRadiusKm ?? 0);
            const fitCircle = makeRadiusCircle(cityLat!, cityLon!, fitKm);
            const coords = fitCircle.geometry.coordinates[0];
            const lngs = coords.map((c) => c[0]);
            const lats = coords.map((c) => c[1]);
            mapRef.current?.fitBounds(
              [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
              { padding: 40, duration: 0 },
            );
          }
        }}
        onZoomEnd={(e) => setZoom(e.viewState.zoom)}
        onMoveEnd={(e) => setZoom(e.viewState.zoom)}
        onContextMenu={(e) => {
          if (onAddAtLocation) {
            setDropPin({ lat: e.lngLat.lat, lng: e.lngLat.lng });
            setActiveId(null);
            setActiveFavId(null);
          }
        }}
        onClick={() => {
          setActiveId(null);
          setActiveFavId(null);
          if (!onAddAtLocation) setDropPin(null);
        }}
      >
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-left" unit="metric" />
        {fullscreen && <CategoryLegend showFavourites={hasFavourites} />}

        {/* City radius circle — grey dashed */}
        {circleData && (
          <Source id="radius-circle" type="geojson" data={circleData}>
            <Layer
              id="radius-circle-line"
              type="line"
              paint={{
                "line-color": "#94a3b8",
                "line-width": 1.5,
                "line-dasharray": [4, 3],
                "line-opacity": 0.7,
              }}
            />
            <Layer
              id="radius-circle-fill"
              type="fill"
              paint={{
                "fill-color": "#94a3b8",
                "fill-opacity": 0.04,
              }}
            />
          </Source>
        )}

        {/* Nearby attractions radius circle — orange dotted, wider gaps */}
        {nearbyCircleData && (
          <Source id="nearby-circle" type="geojson" data={nearbyCircleData}>
            <Layer
              id="nearby-circle-line"
              type="line"
              paint={{
                "line-color": "#f97316",
                "line-width": 1.5,
                "line-dasharray": [2, 4],
                "line-opacity": 0.65,
              }}
            />
            <Layer
              id="nearby-circle-fill"
              type="fill"
              paint={{
                "fill-color": "#f97316",
                "fill-opacity": 0.03,
              }}
            />
          </Source>
        )}

        {clusters.map((cell) => {
          const isCluster = cell.pois.length > 1;
          const poi = cell.pois[0];
          const isActive = !isCluster && visibleId === poi.id;

          if (isCluster) {
            return (
              <Marker
                key={`cluster-${cell.lat}-${cell.lng}`}
                longitude={cell.lng}
                latitude={cell.lat}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  mapRef.current?.flyTo({ center: [cell.lng, cell.lat], zoom: zoom + 2, duration: 500 });
                }}
              >
                <div className="cursor-pointer">
                  <ClusterPie pois={cell.pois} />
                </div>
              </Marker>
            );
          }

          const isHovered = hoverId === poi.id;

          return (
            <Marker
              key={poi.id}
              longitude={poi.longitude}
              latitude={poi.latitude}
              anchor="bottom"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                const newId = activeId === poi.id ? null : poi.id;
                setActiveId(newId);
                if (newId != null && mapRef.current) {
                  const map = mapRef.current;
                  const point = map.project([poi.longitude, poi.latitude]);
                  const mapHeight = map.getContainer().clientHeight;
                  if (point.y < mapHeight * 0.4) {
                    map.easeTo({ center: [poi.longitude, poi.latitude], offset: [0, 100], duration: 300 });
                  }
                }
              }}
            >
              <div
                onMouseEnter={() => { cancelHoverClose(); setHoverId(poi.id); if (activeId !== null && activeId !== poi.id) setActiveId(null); }}
                onMouseLeave={() => scheduleHoverClose()}
                className="relative flex flex-col items-center cursor-pointer"
              >
                {isHovered && (
                  <div className="absolute bottom-full mb-1.5 whitespace-nowrap rounded-md bg-gray-900/90 px-2 py-0.5 text-xs font-medium text-white shadow pointer-events-none">
                    {poi.name}
                  </div>
                )}
                <div
                  className={`flex items-center justify-center rounded-full shadow-md transition-transform ${mapReady ? "marker-enter" : ""}`}
                  style={{
                    backgroundColor: poiNumbers?.[poi.id] != null ? CATEGORY_STYLES[poi.category].dot : "white",
                    border: `${isActive ? 3 : 2.5}px solid ${CATEGORY_STYLES[poi.category].dot}`,
                    width: isActive ? 34 : 28,
                    height: isActive ? 34 : 28,
                    transform: isActive ? "scale(1.15)" : "scale(1)",
                    boxShadow: isActive
                      ? `0 3px 8px rgba(0,0,0,0.35), 0 0 0 2px ${CATEGORY_STYLES[poi.category].dot}40`
                      : "0 2px 6px rgba(0,0,0,0.3)",
                  }}
                >
                  {poiNumbers?.[poi.id] != null ? (
                    <span className="font-bold text-white" style={{ fontSize: isActive ? 15 : 12, lineHeight: 1 }}>
                      {poiNumbers[poi.id]}
                    </span>
                  ) : (
                    <span style={{ fontSize: isActive ? 17 : 14, lineHeight: 1 }}>
                      {getMarkerEmoji(poi.category, poi.subcategory)}
                    </span>
                  )}
                </div>
                {/* Favourite heart badge — bottom-right of the icon */}
                {favouritedPoiIds.has(poi.id) && (
                  <div
                    className="absolute flex items-center justify-center rounded-full bg-pink-500 border border-white"
                    style={{ bottom: 0, right: -3, width: 15, height: 15, boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="white" stroke="none">
                      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                    </svg>
                  </div>
                )}
              </div>
            </Marker>
          );
        })}

        {/* Popup is rendered outside MapGL — see below */}

        {/* Favourite item markers — category emoji + heart badge */}
        {visibleFavourites.map((fav) => {
          const favCat = isCategory(fav.category) ? fav.category : "CULTURE" as Category;
          return (
            <Marker
              key={`fav-${fav.id}`}
              longitude={fav.longitude}
              latitude={fav.latitude}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setActiveFavId((prev) => prev === fav.id ? null : fav.id);
                setActiveId(null);
              }}
            >
              <div className="cursor-pointer">
                <FavouriteMarkerIcon category={favCat} subcategory={fav.subcategory} active={activeFavId === fav.id} />
              </div>
            </Marker>
          );
        })}

        {props.routeGeoJson && (
          <Source id="walking-route" type="geojson" data={props.routeGeoJson}>
            <Layer
              id="walking-route-line"
              type="line"
              paint={{
                "line-color": "#3b82f6",
                "line-width": 4,
                "line-opacity": 0.8,
              }}
              layout={{
                "line-join": "round",
                "line-cap": "round",
              }}
            />
          </Source>
        )}

        {dropPin && onAddAtLocation && (
          <>
            <Marker longitude={dropPin.lng} latitude={dropPin.lat} anchor="bottom">
              <div className="flex flex-col items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-500 drop-shadow-lg" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
              </div>
            </Marker>
            <Popup
              longitude={dropPin.lng}
              latitude={dropPin.lat}
              anchor="bottom"
              onClose={() => setDropPin(null)}
              closeButton
              closeOnClick={false}
              offset={40}
            >
              <div className="min-w-[180px] space-y-2 text-sm" onClick={(e) => e.stopPropagation()}>
                <p className="font-medium text-gray-700">Add POI here</p>
                <p className="text-xs text-gray-500">
                  {dropPin.lat.toFixed(5)}, {dropPin.lng.toFixed(5)}
                </p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddAtLocation(dropPin.lat, dropPin.lng);
                    setDropPin(null);
                  }}
                  className="w-full rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                >
                  + Add POI at this location
                </button>
              </div>
            </Popup>
          </>
        )}
      </MapGL>

      {/* Empty-state overlay when no POIs yet but city centre is known */}
      {!hasLocated && !hasFavourites && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 px-4 py-2.5 text-center shadow backdrop-blur-sm">
            <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">No POIs yet</p>
            {circleData && (
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                <span className="text-slate-400">●</span> {radiusKm} km city radius
                {nearbyCircleData && (
                  <> · <span className="text-orange-400">●</span> {nearbyRadiusKm} km nearby</>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Custom popup rendered OUTSIDE MapGL so it can overflow the map's overflow:hidden */}
      {visiblePoi && popupPos && (
        <div
          className="absolute z-30 pointer-events-auto"
          style={{ left: popupPos.x, top: popupPos.y, transform: "translate(-50%, calc(-100% - 18px))" }}
          onMouseEnter={() => cancelHoverClose()}
          onMouseLeave={() => { if (activeId !== visiblePoi.id) setHoverId(null); }}
        >
          <div className="relative rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-xl p-3">
            {activeId === visiblePoi.id && (
              <button
                type="button"
                onClick={() => { setActiveId(null); setHoverId(null); cancelHoverClose(); }}
                className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] text-xs"
                aria-label="Close"
              >✕</button>
            )}
            <PopupContent
              poi={visiblePoi}
              cityId={cityId ?? 0}
              dayPlans={dayPlans}
              onClose={() => { setActiveId(null); setHoverId(null); }}
              onViewInList={onViewInList}
              userRatings={userRatings}
              notInterested={notInterested}
              onRatePoi={onRatePoi}
              onToggleNotInterested={onToggleNotInterested}
              onFavourite={onFavourite ? (p) => onFavourite({ ...p, placeId: pois.find((x) => x.id === p.id)?.placeId }) : undefined}
              isFavourited={isPoiFavourited ? isPoiFavourited(visiblePoi) : false}
            />
          </div>
          {/* Arrow tip pointing down at the marker */}
          <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: -8 }}>
            <div className="w-0 h-0" style={{ borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderTop: "8px solid hsl(var(--border))" }} />
          </div>
          <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: -6 }}>
            <div className="w-0 h-0" style={{ borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderTop: "7px solid hsl(var(--background))" }} />
          </div>
        </div>
      )}

      {/* Favourite item popup — rendered outside MapGL */}
      {activeFavItem && favPopupPos && (
        <div
          className="absolute z-30 pointer-events-auto"
          style={{ left: favPopupPos.x, top: favPopupPos.y, transform: "translate(-50%, calc(-100% - 16px))" }}
        >
          <div className="relative rounded-lg border border-pink-200 bg-[hsl(var(--background))] shadow-xl p-3">
            <button
              type="button"
              onClick={() => setActiveFavId(null)}
              className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] text-xs"
              aria-label="Close"
            >✕</button>
            <FavouritePopupContent
              item={activeFavItem}
              cityId={cityId ?? 0}
              onClose={() => setActiveFavId(null)}
              onImported={() => { setActiveFavId(null); router.refresh(); }}
            />
          </div>
          {/* Arrow tip */}
          <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: -8 }}>
            <div className="w-0 h-0" style={{ borderLeft: "8px solid transparent", borderRight: "8px solid transparent", borderTop: "8px solid rgb(251, 207, 232)" }} />
          </div>
          <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: -6 }}>
            <div className="w-0 h-0" style={{ borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderTop: "7px solid hsl(var(--background))" }} />
          </div>
        </div>
      )}
    </div>
  );
}
