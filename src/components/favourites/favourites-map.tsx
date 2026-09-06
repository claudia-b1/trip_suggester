"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Marker, NavigationControl, type MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  CATEGORIES,
  CATEGORY_STYLES,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  isCategory,
  type Category,
} from "@/lib/categories";
import {
  getExtraFieldDefs,
  matchesExtraFieldFilters,
  ACCOMMODATION_SUBCATEGORIES,
  PROXIMITY_OPTIONS,
  type ExtraFieldFilter,
  type ExtraFieldDef,
} from "@/lib/favourite-fields";
import type { FavouriteItemDTO, FavouriteListDTO } from "./favourites-provider";

const MAP_STYLES = {
  streets: "mapbox://styles/mapbox/light-v11",
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
} as const;
type MapStyleKey = keyof typeof MAP_STYLES;

/* ── Main component ───────────────────────────────────────────────────── */

export function FavouritesMap({
  lists,
  onClose,
}: {
  lists: FavouriteListDTO[];
  onClose: () => void;
}) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [mapStyle, setMapStyle] = useState<MapStyleKey>("streets");
  const [mapReady, setMapReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<Category | null>(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<number | null>(null);
  const [extraFieldFilters, setExtraFieldFilters] = useState<ExtraFieldFilter[]>([]);

  // Flatten all items
  const allItems = useMemo(() => {
    const items: { item: FavouriteItemDTO; listName: string }[] = [];
    for (const list of lists) {
      for (const item of list.items) {
        items.push({ item, listName: list.name });
      }
      for (const sub of list.sublists) {
        for (const item of sub.items) {
          items.push({ item, listName: `${list.name} / ${sub.name}` });
        }
      }
    }
    return items;
  }, [lists]);

  // Apply filters
  const filteredItems = useMemo(() => {
    return allItems.filter(({ item }) => {
      if (item.latitude == null || item.longitude == null) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (subcategoryFilter && item.subcategory !== subcategoryFilter) return false;
      if (listFilter && item.listId !== listFilter) return false;
      if (extraFieldFilters.length > 0) {
        if (
          !matchesExtraFieldFilters(
            item.extraFields as Record<string, unknown> | null,
            extraFieldFilters,
          )
        )
          return false;
      }
      return true;
    });
  }, [allItems, categoryFilter, subcategoryFilter, listFilter, extraFieldFilters]);

  const activeItem = activeId != null ? filteredItems.find((f) => f.item.id === activeId) : null;

  // Extra field defs for filtering — aggregate all when no category selected
  const activeExtraFieldDefs = useMemo(() => {
    if (categoryFilter) {
      return getExtraFieldDefs(categoryFilter, subcategoryFilter);
    }
    const seen = new Set<string>();
    const allDefs: ExtraFieldDef[] = [];
    for (const { item } of allItems) {
      const defs = getExtraFieldDefs(item.category, item.subcategory);
      for (const def of defs) {
        if (!seen.has(def.key)) {
          seen.add(def.key);
          allDefs.push(def);
        }
      }
    }
    return allDefs;
  }, [categoryFilter, subcategoryFilter, allItems]);

  const dropdownDefs = useMemo(
    () => activeExtraFieldDefs.filter((d) => d.type === "select" || d.type === "proximity" || d.type === "stars"),
    [activeExtraFieldDefs],
  );
  const booleanDefs = useMemo(
    () => activeExtraFieldDefs.filter((d) => d.type === "boolean"),
    [activeExtraFieldDefs],
  );

  // Fullscreen change handler
  useEffect(() => {
    function onFullscreenChange() {
      setFullscreen(!!document.fullscreenElement);
      setTimeout(() => mapRef.current?.resize(), 100);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Track popup position
  useEffect(() => {
    if (!activeItem || !mapRef.current || !mapReady) {
      setPopupPos(null);
      return;
    }
    const item = activeItem.item;
    function updatePos() {
      if (!mapRef.current || !item) return;
      const pt = mapRef.current.project([item.longitude, item.latitude]);
      setPopupPos({ x: pt.x, y: pt.y });
    }
    updatePos();
    const mapInstance = mapRef.current.getMap();
    mapInstance.on("move", updatePos);
    mapInstance.on("zoom", updatePos);
    return () => {
      mapInstance.off("move", updatePos);
      mapInstance.off("zoom", updatePos);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem, mapReady]);

  const fitBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map || filteredItems.length === 0) return;
    if (filteredItems.length === 1) {
      const item = filteredItems[0].item;
      map.flyTo({
        center: [item.longitude, item.latitude],
        zoom: 14,
        duration: 800,
      });
      return;
    }
    const lngs = filteredItems.map((f) => f.item.longitude);
    const lats = filteredItems.map((f) => f.item.latitude);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 60, duration: 800, maxZoom: 15 },
    );
  }, [filteredItems]);

  function toggleBooleanFilter(key: string) {
    setExtraFieldFilters((prev) => {
      const exists = prev.find((f) => f.key === key);
      if (exists) return prev.filter((f) => f.key !== key);
      return [...prev, { key, value: true }];
    });
  }

  function setExtraFieldDropdown(key: string, value: string, type: string) {
    setExtraFieldFilters((prev) => {
      const without = prev.filter((f) => f.key !== key);
      if (!value) return without;
      if (type === "stars") return [...without, { key, value: Number(value) }];
      return [...without, { key, value }];
    });
  }

  function getFilterDropdownValue(key: string): string {
    const f = extraFieldFilters.find((ef) => ef.key === key);
    if (!f) return "";
    return String(f.value);
  }

  if (!token) {
    return (
      <div className="flex h-96 items-center justify-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Set <code className="rounded bg-[hsl(var(--muted))] px-1">NEXT_PUBLIC_MAPBOX_TOKEN</code> to
          enable the map.
        </p>
      </div>
    );
  }

  if (allItems.length === 0 || allItems.every((i) => i.item.latitude == null)) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <p className="text-2xl">🗺️</p>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          No favourites with coordinates to show on the map.
        </p>
        <button
          onClick={onClose}
          className="mt-2 rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
        >
          Back to list
        </button>
      </div>
    );
  }

  // Center: first item or 0,0
  const centerItem = filteredItems.length > 0 ? filteredItems[0].item : allItems.find((i) => i.item.latitude != null)?.item;
  const centerLat = centerItem?.latitude ?? 48;
  const centerLon = centerItem?.longitude ?? 10;

  // Flatten lists for filter dropdown
  const flatLists: { id: number; name: string }[] = [];
  for (const list of lists) {
    flatLists.push({ id: list.id, name: list.name });
    for (const sub of list.sublists) {
      flatLists.push({ id: sub.id, name: `${list.name} / ${sub.name}` });
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Filter bar */}
      <div className="space-y-2 border-b border-[hsl(var(--border))] px-3 py-2">
        {/* Category row */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => {
              setCategoryFilter(null);
              setSubcategoryFilter(null);
              setExtraFieldFilters([]);
            }}
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all ${
              !categoryFilter
                ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-60 hover:opacity-100"
            }`}
          >
            All
          </button>
          {CATEGORIES.map((cat) => {
            const active = categoryFilter === cat;
            const styles = CATEGORY_STYLES[cat];
            return (
              <button
                key={cat}
                onClick={() => {
                  setCategoryFilter(active ? null : cat);
                  setSubcategoryFilter(null);
                  setExtraFieldFilters([]);
                }}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all ${
                  active
                    ? `${styles.badge} border-transparent`
                    : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-60 hover:opacity-100"
                }`}
              >
                {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
              </button>
            );
          })}
        </div>

        {/* Subcategory row — ACCOMMODATION */}
        {categoryFilter === "ACCOMMODATION" && (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => {
                setSubcategoryFilter(null);
                setExtraFieldFilters([]);
              }}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all ${
                !subcategoryFilter
                  ? "border-indigo-400 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                  : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-60 hover:opacity-100"
              }`}
            >
              All
            </button>
            {ACCOMMODATION_SUBCATEGORIES.map((sub) => (
              <button
                key={sub.id}
                onClick={() => {
                  setSubcategoryFilter(subcategoryFilter === sub.id ? null : sub.id);
                  setExtraFieldFilters([]);
                }}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all ${
                  subcategoryFilter === sub.id
                    ? "border-indigo-400 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                    : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-60 hover:opacity-100"
                }`}
              >
                {sub.emoji} {sub.label}
              </button>
            ))}
          </div>
        )}

        {/* List filter + extra field filters */}
        <div className="flex items-center gap-2">
          {flatLists.length > 1 && (
            <select
              value={listFilter ?? ""}
              onChange={(e) => setListFilter(e.target.value ? Number(e.target.value) : null)}
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-0.5 text-[10px] text-[hsl(var(--foreground))]"
            >
              <option value="">All lists</option>
              {flatLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]">
            {filteredItems.length} place{filteredItems.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Extra field filters — grouped by type */}
        {activeExtraFieldDefs.length > 0 && (
          <div className="space-y-1">
            {/* Dropdown filters: proximity, stars, select */}
            {dropdownDefs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {dropdownDefs.map((def) => {
                  const isActive = !!extraFieldFilters.find((f) => f.key === def.key);
                  const cls = `rounded-md border px-2 py-0.5 text-[10px] transition-all ${
                    isActive
                      ? "border-violet-400 bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium"
                      : "border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))]"
                  }`;
                  if (def.type === "proximity") return (
                    <select key={def.key} value={getFilterDropdownValue(def.key)} onChange={(e) => setExtraFieldDropdown(def.key, e.target.value, "proximity")} className={cls}>
                      <option value="">{def.label}</option>
                      {PROXIMITY_OPTIONS.filter((o) => o.value !== "-").map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  );
                  if (def.type === "stars") return (
                    <select key={def.key} value={getFilterDropdownValue(def.key)} onChange={(e) => setExtraFieldDropdown(def.key, e.target.value, "stars")} className={cls}>
                      <option value="">{def.label}</option>
                      {[1, 2, 3, 4, 5].map((n) => (<option key={n} value={n}>{"★".repeat(n)}+</option>))}
                    </select>
                  );
                  if (def.type === "select" && "options" in def) return (
                    <select key={def.key} value={getFilterDropdownValue(def.key)} onChange={(e) => setExtraFieldDropdown(def.key, e.target.value, "select")} className={cls}>
                      <option value="">{def.label}</option>
                      {def.options.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
                    </select>
                  );
                  return null;
                })}
              </div>
            )}
            {/* Boolean toggle pills */}
            {booleanDefs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {booleanDefs.map((def) => {
                  const isActive = extraFieldFilters.some((f) => f.key === def.key);
                  return (
                    <button key={def.key} onClick={() => toggleBooleanFilter(def.key)}
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all ${
                        isActive
                          ? "border-violet-400 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                          : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-60 hover:opacity-100"
                      }`}
                    >
                      {isActive ? "✓ " : ""}{def.label}
                    </button>
                  );
                })}
              </div>
            )}
            {extraFieldFilters.length > 0 && (
              <button onClick={() => setExtraFieldFilters([])}
                className="text-[10px] font-medium text-red-400 hover:text-red-500">
                ✕ Clear {extraFieldFilters.length} filter{extraFieldFilters.length > 1 ? "s" : ""}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Map */}
      <div ref={containerRef} className="relative flex-1 min-h-0">
        <div className="absolute left-2 top-2 z-10 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={fitBounds}
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 px-2 py-1 text-[10px] font-medium shadow-sm hover:bg-[hsl(var(--background))] backdrop-blur-sm"
            title="Fit all points"
          >
            Fit all
          </button>
          <button
            type="button"
            onClick={() => setMapStyle((s) => (s === "streets" ? "satellite" : "streets"))}
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 px-2 py-1 text-[10px] font-medium shadow-sm hover:bg-[hsl(var(--background))] backdrop-blur-sm"
          >
            {mapStyle === "streets" ? "Satellite" : "Streets"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 px-2 py-1 text-[10px] font-medium shadow-sm hover:bg-[hsl(var(--background))] backdrop-blur-sm"
          >
            List view
          </button>
        </div>

        <MapGL
          ref={mapRef}
          mapboxAccessToken={token}
          initialViewState={{ longitude: centerLon, latitude: centerLat, zoom: 4 }}
          style={{ width: "100%", height: "100%" }}
          mapStyle={MAP_STYLES[mapStyle]}
          onLoad={() => {
            setMapReady(true);
            if (filteredItems.length > 0) fitBounds();
          }}
          onClick={() => setActiveId(null)}
        >
          <NavigationControl position="top-right" />

          {/* Category legend */}
          <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-lg border border-[hsl(var(--border))] bg-white/90 p-1.5 shadow text-[10px] space-y-0.5 backdrop-blur-sm dark:bg-gray-900/90">
            {CATEGORIES.map((c) => {
              // Only show categories that have items
              const count = filteredItems.filter((f) => f.item.category === c).length;
              if (count === 0) return null;
              return (
                <div key={c} className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 flex-shrink-0 rounded-full border border-white shadow-sm"
                    style={{ backgroundColor: CATEGORY_STYLES[c].dot }}
                  />
                  <span className="text-gray-700 dark:text-gray-300">
                    {CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]} ({count})
                  </span>
                </div>
              );
            })}
          </div>

          {filteredItems.map(({ item }) => {
            const cat = isCategory(item.category) ? item.category : "CULTURE";
            const isActive = activeId === item.id;
            const hasRating = item.personalRating != null && item.personalRating > 0;
            return (
              <Marker
                key={item.id}
                longitude={item.longitude}
                latitude={item.latitude}
                anchor="bottom"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setActiveId(isActive ? null : item.id);
                  if (!isActive && mapRef.current) {
                    const map = mapRef.current;
                    const point = map.project([item.longitude, item.latitude]);
                    const mapHeight = map.getContainer().clientHeight;
                    if (point.y < mapHeight * 0.4) {
                      map.easeTo({
                        center: [item.longitude, item.latitude],
                        offset: [0, 100],
                        duration: 300,
                      });
                    }
                  }
                }}
              >
                <div className="relative flex flex-col items-center cursor-pointer group">
                  {/* Hover tooltip — name + rating + category */}
                  <div className="absolute bottom-full mb-1.5 rounded-lg bg-gray-900/95 px-2.5 py-1.5 shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity max-w-[200px] z-20">
                    <p className="text-xs font-semibold text-white leading-tight whitespace-nowrap overflow-hidden text-ellipsis">{item.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-gray-300">{CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}</span>
                      {hasRating && (
                        <span className="text-[10px] text-amber-400">{"★".repeat(item.personalRating!)}</span>
                      )}
                    </div>
                    {item.city && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{item.city}, {item.country}</p>
                    )}
                  </div>
                  {/* Marker: category emoji inside colored circle */}
                  <div
                    className="flex items-center justify-center rounded-full border-2 shadow-md transition-all duration-150"
                    style={{
                      backgroundColor: CATEGORY_STYLES[cat].dot,
                      width: isActive ? 32 : 24,
                      height: isActive ? 32 : 24,
                      borderColor: hasRating ? "#fbbf24" : "white",
                      borderWidth: hasRating ? 3 : 2,
                      transform: isActive ? "scale(1.15)" : "scale(1)",
                    }}
                  >
                    <span style={{ fontSize: isActive ? 14 : 11, lineHeight: 1 }}>
                      {CATEGORY_ICONS[cat]}
                    </span>
                  </div>
                  {/* Visited checkmark */}
                  {item.visited && (
                    <div className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-white border border-white">
                      <svg className="h-2 w-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  )}
                  {/* Personal rating mini-stars badge */}
                  {hasRating && !isActive && (
                    <div className="absolute -top-1 -right-2 flex items-center rounded-full bg-amber-400 px-1 py-0 text-[7px] font-bold text-white shadow-sm border border-white">
                      {item.personalRating}★
                    </div>
                  )}
                </div>
              </Marker>
            );
          })}
        </MapGL>

        {/* Popup rendered outside MapGL for overflow */}
        {activeItem && popupPos && (
          <div
            className="absolute z-30 pointer-events-auto"
            style={{
              left: popupPos.x,
              top: popupPos.y,
              transform: "translate(-50%, calc(-100% - 18px))",
            }}
          >
            <div className="relative max-w-[300px] min-w-[220px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-xl p-3 text-sm">
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] text-xs"
              >
                ✕
              </button>

              <FavouriteMapPopup item={activeItem.item} listName={activeItem.listName} />
            </div>
            {/* Arrow */}
            <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: -8 }}>
              <div
                className="w-0 h-0"
                style={{
                  borderLeft: "8px solid transparent",
                  borderRight: "8px solid transparent",
                  borderTop: "8px solid hsl(var(--border))",
                }}
              />
            </div>
            <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: -6 }}>
              <div
                className="w-0 h-0"
                style={{
                  borderLeft: "7px solid transparent",
                  borderRight: "7px solid transparent",
                  borderTop: "7px solid hsl(var(--background))",
                }}
              />
            </div>
          </div>
        )}

        {/* Empty state when filters exclude everything */}
        {filteredItems.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 px-4 py-2.5 text-center shadow backdrop-blur-sm">
              <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
                No favourites match current filters
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Popup content ────────────────────────────────────────────────────── */

const PRICE_LABELS: Record<number, string> = { 0: "Free", 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };

/** Build a Google Maps search URL for a named place at coordinates */
function googleMapsUrl(name: string, lat: number, lng: number) {
  return `https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lng},17z`;
}

/** Render a single extra field value with its label */
function ExtraFieldValue({ label, value, type }: { label: string; value: unknown; type: string }) {
  if (value === undefined || value === null || value === "" || value === "-" || value === false) return null;
  if (type === "boolean" && value === true) {
    return <span className="rounded-full bg-violet-50 dark:bg-violet-950 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">✓ {label}</span>;
  }
  if (type === "stars" && typeof value === "number") {
    return <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{label}: {"★".repeat(value)}{"☆".repeat(5 - value)}</span>;
  }
  if (type === "proximity") {
    const proxyLabels: Record<string, string> = { "2km": "< 2 km", "500m": "< 500 m", "200m": "< 200 m", "direct": "Direct" };
    return <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{label}: {proxyLabels[String(value)] ?? String(value)}</span>;
  }
  return <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{label}: {String(value)}</span>;
}

function FavouriteMapPopup({
  item,
  listName,
}: {
  item: FavouriteItemDTO;
  listName: string;
}) {
  const cat = isCategory(item.category) ? item.category : "CULTURE";
  const [imgError, setImgError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Get extra field definitions for this item's category/subcategory
  const extraDefs = getExtraFieldDefs(item.category, item.subcategory);
  const extras = item.extraFields as Record<string, unknown> | null;
  // Filter to only fields that have values
  const activeExtras = extraDefs.filter((def) => {
    const val = extras?.[def.key];
    return val !== undefined && val !== null && val !== "" && val !== "-" && val !== false;
  });

  const hasDetails = item.openingHours || item.phoneNumber || item.fee || item.address || activeExtras.length > 0;
  const priceLevel = item.priceLevel ?? (extras?.priceLevel != null ? Number(extras.priceLevel) : null);

  return (
    <div className="space-y-1.5">
      {/* Photo */}
      {item.photoUrl && !imgError && (
        <img
          src={item.photoUrl}
          alt={item.name}
          onError={() => setImgError(true)}
          className="w-full h-24 object-cover rounded-md"
        />
      )}

      {/* Name */}
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-[hsl(var(--foreground))] leading-tight pr-4">
          {item.name}
        </span>
      </div>

      {/* Badges row: category + subcategory + visited + price */}
      <div className="flex flex-wrap items-center gap-1">
        <span
          className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_STYLES[cat].badge}`}
        >
          {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
        </span>
        {item.subcategory && (
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {item.subcategory}
          </span>
        )}
        {item.visited && (
          <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
            ✓ Visited
          </span>
        )}
        {priceLevel != null && priceLevel > 0 && (
          <span className="rounded-full bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
            {PRICE_LABELS[priceLevel] ?? ""}
          </span>
        )}
      </div>

      {/* Location */}
      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
        📍 {item.city}, {item.country}
      </p>

      {/* Address (if different from city/country) */}
      {item.address && (
        <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-snug">
          {item.address}
        </p>
      )}

      {/* Personal rating */}
      {item.personalRating != null && item.personalRating > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Your rating:</span>
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={`text-xs ${i < item.personalRating! ? "text-amber-400" : "text-gray-300 dark:text-gray-600"}`}>
              ★
            </span>
          ))}
        </div>
      )}

      {/* Description */}
      {item.description && (
        <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed line-clamp-3">
          {item.description}
        </p>
      )}

      {/* Notes */}
      {item.notes && (
        <p className="text-[11px] italic text-[hsl(var(--foreground))] bg-amber-50 dark:bg-amber-950/30 rounded px-1.5 py-1 leading-relaxed">
          💬 {item.notes}
        </p>
      )}

      {/* Expandable details: opening hours, phone, fee, extra fields */}
      {hasDetails && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
          >
            <span className={`transition-transform ${expanded ? "rotate-90" : ""}`} style={{ fontSize: 8 }}>▶</span>
            {expanded ? "Hide details" : "Show details"}
          </button>
          {expanded && (
            <div className="space-y-1 border-l-2 border-[hsl(var(--border))] pl-2 py-0.5">
              {item.openingHours && (
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">🕐 {item.openingHours}</p>
              )}
              {item.phoneNumber && (
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">📞 {item.phoneNumber}</p>
              )}
              {item.fee && (
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  🎫 {item.fee === "yes" ? "Admission fee" : item.fee === "no" ? "Free" : item.fee}
                </p>
              )}
              {/* Extra fields: camping specifics, food details, etc. */}
              {activeExtras.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {activeExtras.map((def) => (
                    <ExtraFieldValue
                      key={def.key}
                      label={def.label}
                      value={extras?.[def.key]}
                      type={def.type}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Links row: website + Google Maps */}
      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        {item.website && (
          <a
            href={item.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[hsl(var(--primary))] hover:underline"
          >
            🔗 Website
          </a>
        )}
        <a
          href={googleMapsUrl(item.name, item.latitude, item.longitude)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-[hsl(var(--primary))] hover:underline"
        >
          🗺️ Google Maps
        </a>
      </div>

      {/* Footer: list path */}
      <p className="text-[10px] text-[hsl(var(--muted-foreground))] border-t border-[hsl(var(--border))] pt-1">📁 {listName}</p>
    </div>
  );
}
