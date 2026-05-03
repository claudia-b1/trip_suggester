"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, {
  Marker,
  Popup,
  NavigationControl,
  Source,
  Layer,
  type MapRef,
} from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { CATEGORIES, CATEGORY_STYLES, type Category } from "@/lib/categories";
import { TIME_SLOTS, type TimeSlot } from "@/lib/slots";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type LocatedPoi = {
  id: number;
  name: string;
  category: Category;
  description: string | null;
  latitude: number;
  longitude: number;
  photoUrl?: string | null;
};

export type DayPlanOption = { id: number; label: string };

export type PoiMapProps = {
  pois: { id: number; name: string; category: Category; description: string | null; latitude: number | null; longitude: number | null; photoUrl?: string | null }[];
  cityId?: number;
  dayPlans?: DayPlanOption[];
  focusPoiId?: number | null;
  onAddAtLocation?: (lat: number, lng: number) => void;
  routeGeoJson?: GeoJSON.FeatureCollection | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<Category, string> = {
  CULTURE: "🏛️",
  FOOD: "🍽️",
  NATURE: "🌿",
  NIGHTLIFE: "🌙",
  SHOPPING: "🛍️",
  OUTDOORS: "🏔️",
};

const MAP_STYLES = {
  streets: "mapbox://styles/mapbox/streets-v12",
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

function CategoryLegend() {
  return (
    <div className="pointer-events-none absolute bottom-8 left-2 z-10 rounded-lg border border-[hsl(var(--border))] bg-white/90 p-2 shadow text-xs space-y-1 backdrop-blur-sm">
      {CATEGORIES.map((c) => (
        <div key={c} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full border border-white shadow-sm"
            style={{ backgroundColor: CATEGORY_STYLES[c].dot }}
          />
          <span className="text-gray-700">{CATEGORY_ICONS[c]} {c}</span>
        </div>
      ))}
    </div>
  );
}

function PopupContent({
  poi,
  cityId,
  dayPlans,
  onClose,
}: {
  poi: LocatedPoi;
  cityId: number;
  dayPlans: DayPlanOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot>("MORNING");
  const [assigning, setAssigning] = useState(false);
  const [imgError, setImgError] = useState(false);

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

  return (
    <div className="min-w-[200px] max-w-[260px] max-h-[300px] overflow-y-auto space-y-2 text-sm">
      {poi.photoUrl && !imgError && (
        <img
          src={poi.photoUrl}
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
      {dayPlans.length > 0 && (
        <details className="group" onClick={(e) => e.stopPropagation()}>
          <summary className="cursor-pointer select-none text-xs font-medium text-blue-600 hover:underline list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            Add to Day Plan
          </summary>
          <div className="mt-2 space-y-1.5">
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
          </div>
        </details>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PoiMapImpl(props: PoiMapProps) {
  const { pois, cityId, dayPlans = [], focusPoiId, onAddAtLocation } = props;
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapRef = useRef<MapRef>(null);
  const [activeId, setActiveId] = useState<number | null>(focusPoiId ?? null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [mapStyle, setMapStyle] = useState<MapStyleKey>("streets");
  const [zoom, setZoom] = useState(12);
  const [dropPin, setDropPin] = useState<{ lat: number; lng: number } | null>(null);

  const located: LocatedPoi[] = useMemo(
    () => pois.flatMap((p) =>
      p.latitude != null && p.longitude != null
        ? [{ ...p, latitude: p.latitude, longitude: p.longitude, photoUrl: p.photoUrl }]
        : [],
    ),
    [pois],
  );

  const fitBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map || located.length === 0) return;
    if (located.length === 1) {
      map.flyTo({ center: [located[0].longitude, located[0].latitude], zoom: 14, duration: 800 });
      return;
    }
    const lngs = located.map((p) => p.longitude);
    const lats = located.map((p) => p.latitude);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 60, duration: 800, maxZoom: 15 },
    );
  }, [located]);

  useEffect(() => {
    if (!focusPoiId) return;
    const poi = located.find((p) => p.id === focusPoiId);
    if (!poi || !mapRef.current) return;
    // Offset downward so the popup above the marker is fully visible
    mapRef.current.flyTo({ center: [poi.longitude, poi.latitude], zoom: 15, duration: 800, offset: [0, 60] });
    setActiveId(focusPoiId);
  }, [focusPoiId, located]);

  // Floor to integer so sub-pixel zoom differences don't re-trigger clustering
  const clusterZoom = Math.floor(zoom);
  const clusters = useMemo(() => clusterPois(located, clusterZoom), [located, clusterZoom]);

  const visibleId = hoverId ?? activeId;
  const visiblePoi = visibleId != null ? located.find((p) => p.id === visibleId) : null;

  if (!token) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Set <code className="rounded bg-[hsl(var(--muted))] px-1">NEXT_PUBLIC_MAPBOX_TOKEN</code> in your <code>.env</code> to enable the map.
      </p>
    );
  }

  if (located.length === 0) {
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">No POIs with coordinates yet.</p>;
  }

  const first = located[0];

  return (
    <div className="relative overflow-hidden rounded-md border border-[hsl(var(--border))]">
      <button
        type="button"
        onClick={() => setMapStyle((s) => (s === "streets" ? "satellite" : "streets"))}
        className="absolute right-2 top-2 z-10 rounded-md border border-gray-300 bg-white/90 px-2 py-1 text-xs font-medium shadow hover:bg-white backdrop-blur-sm"
      >
        {mapStyle === "streets" ? "🛰 Satellite" : "🗺 Streets"}
      </button>

      <CategoryLegend />

      <MapGL
        ref={mapRef}
        mapboxAccessToken={token}
        initialViewState={{ longitude: first.longitude, latitude: first.latitude, zoom: 12 }}
        style={{ width: "100%", height: "clamp(360px, 50vh, 600px)" }}
        mapStyle={MAP_STYLES[mapStyle]}
        onLoad={fitBounds}
        onZoomEnd={(e) => setZoom(e.viewState.zoom)}
        onMoveEnd={(e) => setZoom(e.viewState.zoom)}
        onClick={(e) => {
          if (onAddAtLocation) {
            setDropPin({ lat: e.lngLat.lat, lng: e.lngLat.lng });
            setActiveId(null);
          } else {
            setActiveId(null);
            setDropPin(null);
          }
        }}
      >
        <NavigationControl position="top-right" />

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
                  // Pan map so popup (above marker) is fully visible
                  const map = mapRef.current;
                  const point = map.project([poi.longitude, poi.latitude]);
                  const mapHeight = map.getContainer().clientHeight;
                  // If the marker is in the top 40% of the viewport, pan down
                  if (point.y < mapHeight * 0.4) {
                    map.easeTo({ center: [poi.longitude, poi.latitude], offset: [0, 100], duration: 300 });
                  }
                }
              }}
            >
              <div
                onMouseEnter={() => setHoverId(poi.id)}
                onMouseLeave={() => setHoverId(null)}
                className="cursor-pointer rounded-full border-2 border-white shadow transition-transform"
                style={{
                  backgroundColor: CATEGORY_STYLES[poi.category].dot,
                  width: isActive ? 22 : 16,
                  height: isActive ? 22 : 16,
                  transform: isActive ? "scale(1.3)" : "scale(1)",
                }}
                aria-label={poi.name}
              />
            </Marker>
          );
        })}

        {visiblePoi && (
          <Popup
            longitude={visiblePoi.longitude}
            latitude={visiblePoi.latitude}
            anchor="bottom"
            onClose={() => { setActiveId(null); setHoverId(null); }}
            closeButton={hoverId == null}
            closeOnClick={false}
            offset={16}
          >
            <PopupContent
              poi={visiblePoi}
              cityId={cityId ?? 0}
              dayPlans={dayPlans}
              onClose={() => setActiveId(null)}
            />
          </Popup>
        )}

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
    </div>
  );
}
