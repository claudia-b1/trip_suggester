"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Marker, NavigationControl, Popup, Source, Layer, type MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";

export type TripCity = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  /** Display order (1-based, sorted by start date) */
  order: number;
  /** If this is a subcity, the parent city id */
  parentCityId?: number | null;
  /** "destination" or "stop" */
  type?: string;
};

export type TripMapProps = {
  cities: TripCity[];
};

const MARKER_COLORS = [
  "#4f46e5", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // rose
  "#8b5cf6", // purple
  "#06b6d4", // cyan
];

const PADDING = 64;

export function TripMapImpl({ cities }: TripMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const bounds = useMemo(() => {
    if (cities.length === 0) return null;
    const lngs = cities.map((c) => c.longitude);
    const lats = cities.map((c) => c.latitude);
    return {
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
    };
  }, [cities]);

  const fitAll = useCallback((animated = true) => {
    if (!bounds || !mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;
    map.fitBounds(
      [[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]],
      { padding: PADDING, maxZoom: 13, duration: animated ? 500 : 0 },
    );
  }, [bounds]);

  // Fit whenever the map finishes loading or the cities list changes
  useEffect(() => {
    if (!mapLoaded) return;
    fitAll(false);
  }, [mapLoaded, fitAll]);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;

  return (
    <div
      className="poi-map-outer absolute inset-0 rounded-xl overflow-hidden border border-[hsl(var(--border))]"
    >
      <MapGL
        ref={mapRef}
        mapboxAccessToken={token}
        initialViewState={{ latitude: 48, longitude: 10, zoom: 4 }}
        mapStyle="mapbox://styles/mapbox/light-v11"
        style={{ width: "100%", height: "100%" }}
        reuseMaps
        onLoad={() => setMapLoaded(true)}
      >
        <NavigationControl position="top-right" showCompass={false} />

        {/* Route line connecting top-level cities in order */}
        {(() => {
          const topLevel = cities.filter((c) => !c.parentCityId);
          const subcities = cities.filter((c) => !!c.parentCityId);

          // Build subcity connector lines (parent → subcity)
          const subcityLines = subcities
            .map((sub) => {
              const parent = cities.find((c) => c.id === sub.parentCityId);
              if (!parent) return null;
              return {
                type: "Feature" as const,
                properties: {},
                geometry: {
                  type: "LineString" as const,
                  coordinates: [
                    [parent.longitude, parent.latitude],
                    [sub.longitude, sub.latitude],
                  ],
                },
              };
            })
            .filter((f): f is NonNullable<typeof f> => f != null);

          return (
            <>
              {topLevel.length > 1 && (
                <Source
                  id="route"
                  type="geojson"
                  data={{
                    type: "FeatureCollection",
                    features: [
                      {
                        type: "Feature",
                        properties: {},
                        geometry: {
                          type: "LineString",
                          coordinates: [...topLevel]
                            .sort((a, b) => a.order - b.order)
                            .map((c) => [c.longitude, c.latitude]),
                        },
                      },
                    ],
                  }}
                >
                  <Layer
                    id="route-line"
                    type="line"
                    paint={{ "line-color": "#94a3b8", "line-width": 2, "line-dasharray": [2, 2] }}
                  />
                </Source>
              )}
              {subcityLines.length > 0 && (
                <Source
                  id="subcity-routes"
                  type="geojson"
                  data={{
                    type: "FeatureCollection",
                    features: subcityLines,
                  }}
                >
                  <Layer
                    id="subcity-route-line"
                    type="line"
                    paint={{ "line-color": "#a78bfa", "line-width": 1.5, "line-dasharray": [4, 3] }}
                  />
                </Source>
              )}
            </>
          );
        })()}

        {/* Build a destIndex map: for each top-level destination, count only non-stop cities before it */}
        {(() => {
          const topLevel = cities.filter((c) => !c.parentCityId);
          const destIndexMap = new Map<number, number>();
          let destCount = 0;
          for (const c of topLevel.sort((a, b) => a.order - b.order)) {
            if (c.type !== "stop") {
              destIndexMap.set(c.id, destCount);
              destCount++;
            }
          }

          return cities.map((city) => {
            const isSub = !!city.parentCityId;
            const isStop = city.type === "stop";
            const parent = isSub ? cities.find((c) => c.id === city.parentCityId) : null;

            // Color: destinations use destIndex, stops use gray, subcities inherit parent color
            let color: string;
            if (isStop) {
              color = "#6b7280"; // gray-500
            } else if (isSub && parent) {
              const parentDestIndex = destIndexMap.get(parent.id) ?? 0;
              color = MARKER_COLORS[parentDestIndex % MARKER_COLORS.length];
            } else {
              const destIndex = destIndexMap.get(city.id) ?? 0;
              color = MARKER_COLORS[destIndex % MARKER_COLORS.length];
            }

            const isHovered = hoveredId === city.id;
            // Display number: destinations show destIndex+1, stops show overall order
            const displayNumber = isStop ? city.order : (destIndexMap.get(city.id) ?? 0) + 1;

            return (
              <Marker
                key={city.id}
                latitude={city.latitude}
                longitude={city.longitude}
                anchor="center"
              >
                {isSub ? (
                  <button
                    type="button"
                    onMouseEnter={() => setHoveredId(city.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => setHoveredId((prev) => prev === city.id ? null : city.id)}
                    aria-label={city.name}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      backgroundColor: "white",
                      border: `2.5px solid ${color}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                      cursor: "pointer",
                      transform: isHovered ? "scale(1.2)" : "scale(1)",
                      transition: "transform 0.15s ease",
                      outline: "none",
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: color }} />
                  </button>
                ) : isStop ? (
                  /* Travel stop: car icon + order number */
                  <button
                    type="button"
                    onMouseEnter={() => setHoveredId(city.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => setHoveredId((prev) => prev === city.id ? null : city.id)}
                    aria-label={city.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      backgroundColor: "white",
                      border: "1.5px dashed #9ca3af",
                      borderRadius: "50%",
                      padding: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#6b7280",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                      cursor: "pointer",
                      transform: isHovered ? "scale(1.15)" : "scale(1)",
                      transition: "transform 0.15s ease",
                      outline: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ fontSize: 13, lineHeight: 1 }}>🚗</span>
                  </button>
                ) : (
                  /* Regular destination: colored circle with number */
                  <button
                    type="button"
                    onMouseEnter={() => setHoveredId(city.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => setHoveredId((prev) => prev === city.id ? null : city.id)}
                    aria-label={city.name}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      backgroundColor: color,
                      border: "2px solid white",
                      color: "white",
                      fontSize: 13,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                      cursor: "pointer",
                      transform: isHovered ? "scale(1.15)" : "scale(1)",
                      transition: "transform 0.15s ease",
                      outline: "none",
                    }}
                  >
                    {displayNumber}
                  </button>
                )}
              </Marker>
            );
          });
        })()}

        {hoveredId != null && (() => {
          const city = cities.find((c) => c.id === hoveredId);
          if (!city) return null;
          const parentName = city.parentCityId
            ? cities.find((c) => c.id === city.parentCityId)?.name
            : null;
          return (
            <Popup
              latitude={city.latitude}
              longitude={city.longitude}
              closeButton={false}
              closeOnClick
              onClose={() => setHoveredId(null)}
              anchor="bottom"
              offset={city.parentCityId ? 14 : 20}
            >
              <div className="px-1">
                <p className="text-sm font-semibold">{city.name}</p>
                {parentName && (
                  <p className="text-[10px] text-gray-500">↳ {parentName}</p>
                )}
              </div>
            </Popup>
          );
        })()}
      </MapGL>

      {/* Fit-all button */}
      <button
        type="button"
        onClick={() => fitAll(true)}
        title="Fit all destinations"
        className="absolute bottom-2 left-2 z-10 flex items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 px-2 py-1 text-xs font-medium text-[hsl(var(--foreground))] shadow-sm backdrop-blur-sm hover:bg-[hsl(var(--muted))] transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
        Fit all
      </button>
    </div>
  );
}
