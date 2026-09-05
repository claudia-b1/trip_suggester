"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Marker, NavigationControl, type MapRef, type MapMouseEvent } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { Button } from "@/components/ui/button";
import type { CityDetails } from "@/components/ui/city-autocomplete";

export type MapLocationPickerProps = {
  /** Called when the user confirms a location */
  onSelect: (details: CityDetails) => void;
  onClose: () => void;
  /** Existing cities for initial map bounds */
  existingCities?: { latitude: number; longitude: number }[];
};

type PickedLocation = {
  lat: number;
  lng: number;
  cityName: string;
  country: string;
  /** Full details once resolved */
  details: CityDetails | null;
  loading: boolean;
  error?: string;
};

export function MapLocationPicker({ onSelect, onClose, existingCities }: MapLocationPickerProps) {
  const mapRef = useRef<MapRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [picked, setPicked] = useState<PickedLocation | null>(null);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // Compute initial view from existing cities
  const initialView = useMemo(() => {
    if (existingCities && existingCities.length > 0) {
      const lats = existingCities.map((c) => c.latitude);
      const lngs = existingCities.map((c) => c.longitude);
      return {
        latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
        longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
        zoom: existingCities.length === 1 ? 8 : 4,
      };
    }
    // Default: Europe
    return { latitude: 48, longitude: 10, zoom: 4 };
  }, [existingCities]);

  // Fit to existing cities when map loads
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !existingCities || existingCities.length < 2) return;
    const map = mapRef.current.getMap();
    if (!map) return;
    const lats = existingCities.map((c) => c.latitude);
    const lngs = existingCities.map((c) => c.longitude);
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 80, maxZoom: 10, duration: 0 },
    );
  }, [mapLoaded, existingCities]);

  // Handle map click: reverse geocode → find city → get details
  const handleMapClick = useCallback(async (e: MapMouseEvent) => {
    const { lng, lat } = e.lngLat;

    setPicked({ lat, lng, cityName: "Looking up…", country: "", details: null, loading: true });

    try {
      // Step 1: Reverse geocode to get city name
      const revRes = await fetch(`/api/geocode?action=reverse&lat=${lat}&lng=${lng}`);
      if (!revRes.ok) {
        setPicked((p) => p ? { ...p, cityName: "Unknown location", loading: false, error: "Could not identify this location" } : null);
        return;
      }
      const revData = await revRes.json() as { city?: string; country?: string; address?: string };
      const cityName = revData.city || revData.address?.split(",")[0] || "Unknown";
      const country = revData.country || "";

      setPicked((p) => p ? { ...p, cityName, country, loading: true } : null);

      // Step 2: Search for that city name to get a prediction with placeId
      const searchRes = await fetch(`/api/cities/search?q=${encodeURIComponent(cityName)}`);
      if (!searchRes.ok) {
        setPicked((p) => p ? { ...p, loading: false, error: "Could not find city details" } : null);
        return;
      }
      const predictions = await searchRes.json() as Array<{ placeId: string; name: string; description: string }>;

      if (predictions.length === 0) {
        setPicked((p) => p ? { ...p, loading: false, error: "No matching city found" } : null);
        return;
      }

      // Pick the first prediction (most relevant)
      const bestMatch = predictions[0];

      // Step 3: Get full CityDetails from the placeId
      const detailsRes = await fetch(`/api/cities/search?placeId=${encodeURIComponent(bestMatch.placeId)}`);
      if (!detailsRes.ok) {
        setPicked((p) => p ? { ...p, loading: false, error: "Could not load city details" } : null);
        return;
      }
      const details = await detailsRes.json() as CityDetails;

      setPicked({
        lat: details.latitude,
        lng: details.longitude,
        cityName: details.name,
        country: details.country,
        details,
        loading: false,
      });
    } catch {
      setPicked((p) => p ? { ...p, loading: false, error: "Network error" } : null);
    }
  }, []);

  const handleConfirm = useCallback(() => {
    if (picked?.details) {
      onSelect(picked.details);
      onClose();
    }
  }, [picked, onSelect, onClose]);

  if (!token) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4">
      <div className="relative flex flex-col w-full sm:max-w-3xl h-[100dvh] sm:h-[80vh] sm:max-h-[600px] sm:rounded-xl border-0 sm:border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-sm font-semibold">Pick location on map</h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Tap or click on the map to select a city or town</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] text-xl leading-none p-2 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            &times;
          </button>
        </div>

        {/* Map */}
        <div className="relative flex-1">
          <MapGL
            ref={mapRef}
            mapboxAccessToken={token}
            initialViewState={initialView}
            mapStyle="mapbox://styles/mapbox/light-v11"
            style={{ width: "100%", height: "100%" }}
            onClick={handleMapClick}
            onLoad={() => setMapLoaded(true)}
            cursor="crosshair"
          >
            <NavigationControl position="top-right" showCompass={false} />

            {/* Existing cities as small gray dots (pointer-events: none so they don't block taps) */}
            {existingCities?.map((c, i) => (
              <Marker key={`existing-${i}`} latitude={c.latitude} longitude={c.longitude} anchor="center">
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: "#94a3b8",
                    border: "1.5px solid white",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                    pointerEvents: "none",
                  }}
                />
              </Marker>
            ))}

            {/* Picked location marker (pointer-events: none so tapping near it still triggers a new pick) */}
            {picked && (
              <Marker latitude={picked.lat} longitude={picked.lng} anchor="bottom">
                <div className="flex flex-col items-center" style={{ pointerEvents: "none" }}>
                  <svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.27 21.73 0 14 0z"
                      fill="#4f46e5"
                    />
                    <circle cx="14" cy="14" r="6" fill="white" />
                  </svg>
                </div>
              </Marker>
            )}
          </MapGL>
        </div>

        {/* Footer with picked location info */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
          {picked ? (
            <>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {picked.loading && (
                    <div className="h-4 w-4 border-2 border-[hsl(var(--primary))] border-t-transparent rounded-full animate-spin shrink-0" />
                  )}
                  <p className="text-sm font-medium truncate">{picked.cityName}</p>
                </div>
                {picked.country && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{picked.country}</p>
                )}
                {picked.error && (
                  <p className="text-xs text-red-500">{picked.error}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPicked(null)}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleConfirm}
                  disabled={!picked.details || picked.loading}
                >
                  Select
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Tap anywhere on the map to pick a location
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
