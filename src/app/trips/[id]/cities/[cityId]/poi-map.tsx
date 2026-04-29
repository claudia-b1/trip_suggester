"use client";

import { useState } from "react";
import Map, { Marker, Popup, NavigationControl } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { CATEGORY_STYLES, type Category } from "@/lib/categories";

type LocatedPoi = {
  id: number;
  name: string;
  category: Category;
  description: string | null;
  latitude: number;
  longitude: number;
};

export function PoiMap({
  pois,
}: {
  pois: { id: number; name: string; category: Category; description: string | null; latitude: number | null; longitude: number | null }[];
}) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const [activeId, setActiveId] = useState<number | null>(null);

  const located: LocatedPoi[] = pois.flatMap((p) =>
    p.latitude != null && p.longitude != null
      ? [{ ...p, latitude: p.latitude, longitude: p.longitude }]
      : [],
  );

  if (!token) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Set <code className="rounded bg-[hsl(var(--muted))] px-1">NEXT_PUBLIC_MAPBOX_TOKEN</code> in
        your <code>.env</code> to enable the map.
      </p>
    );
  }

  if (located.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        No POIs with coordinates yet.
      </p>
    );
  }

  const first = located[0];
  const active = activeId != null ? located.find((p) => p.id === activeId) : null;

  return (
    <div className="overflow-hidden rounded-md border border-[hsl(var(--border))]">
      <Map
        mapboxAccessToken={token}
        initialViewState={{
          longitude: first.longitude,
          latitude: first.latitude,
          zoom: 12,
        }}
        style={{ width: "100%", height: 400 }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
      >
        <NavigationControl position="top-right" />
        {located.map((poi) => (
          <Marker
            key={poi.id}
            longitude={poi.longitude}
            latitude={poi.latitude}
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setActiveId(poi.id);
            }}
          >
            <div
              className="h-4 w-4 cursor-pointer rounded-full border-2 border-white shadow"
              style={{ backgroundColor: CATEGORY_STYLES[poi.category].dot }}
              aria-label={poi.name}
            />
          </Marker>
        ))}
        {active && (
          <Popup
            longitude={active.longitude}
            latitude={active.latitude}
            anchor="top"
            onClose={() => setActiveId(null)}
            closeOnClick={false}
          >
            <div className="space-y-1 text-sm">
              <div className="font-semibold">{active.name}</div>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[active.category].badge}`}
              >
                {active.category}
              </span>
              {active.description && <p className="pt-1">{active.description}</p>}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}
