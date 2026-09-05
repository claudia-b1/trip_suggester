"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Marker, NavigationControl, Popup, ScaleControl, type MapRef, type MapMouseEvent } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
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
  /** Driving distance from user location in km (null if unavailable) */
  drivingDistanceKm: number | null;
  drivingDistanceLoading: boolean;
};

/** Fetch driving distance via Mapbox Directions API (returns km or null) */
async function fetchDrivingDistance(
  fromLng: number, fromLat: number,
  toLng: number, toLat: number,
  token: string,
): Promise<number | null> {
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as { routes?: Array<{ distance?: number }> };
    const meters = data.routes?.[0]?.distance;
    if (meters == null) return null;
    return Math.round(meters / 1000);
  } catch {
    return null;
  }
}

export function MapLocationPicker({ onSelect, onClose, existingCities }: MapLocationPickerProps) {
  const mapRef = useRef<MapRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [picked, setPicked] = useState<PickedLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const { toast } = useToast();

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

  // Fetch driving distance when picked location resolves and user location is known
  useEffect(() => {
    if (!picked?.details || !userLocation || !token) return;
    if (picked.drivingDistanceKm != null || picked.drivingDistanceLoading) return;

    setPicked((p) => p ? { ...p, drivingDistanceLoading: true } : null);

    fetchDrivingDistance(
      userLocation.lng, userLocation.lat,
      picked.details.longitude, picked.details.latitude,
      token,
    ).then((km) => {
      setPicked((p) => p ? { ...p, drivingDistanceKm: km, drivingDistanceLoading: false } : null);
    });
  }, [picked?.details, userLocation, token, picked?.drivingDistanceKm, picked?.drivingDistanceLoading]);

  // Core location resolution: reverse geocode → city search → full details
  const resolveLocation = useCallback(async (lat: number, lng: number) => {
    setPicked({ lat, lng, cityName: "Looking up…", country: "", details: null, loading: true, drivingDistanceKm: null, drivingDistanceLoading: false });

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
        drivingDistanceKm: null,
        drivingDistanceLoading: false,
      });
    } catch {
      setPicked((p) => p ? { ...p, loading: false, error: "Network error" } : null);
    }
  }, []);

  // Handle map click
  const handleMapClick = useCallback((e: MapMouseEvent) => {
    resolveLocation(e.lngLat.lat, e.lngLat.lng);
  }, [resolveLocation]);

  // Handle "Use my location" via browser Geolocation API
  const handleUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      toast("Your browser does not support geolocation.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude: lat, longitude: lng } = pos.coords;

        // Store user location for driving distance calculations
        setUserLocation({ lat, lng });

        // Fly the map to the user's location
        const map = mapRef.current?.getMap();
        if (map) {
          map.flyTo({ center: [lng, lat], zoom: 10, duration: 1000 });
        }

        // Resolve the location to a city
        resolveLocation(lat, lng);
      },
      (err) => {
        setLocating(false);
        const messages: Record<number, string> = {
          1: "Location permission was denied. Allow location access in your browser settings.",
          2: "Your location could not be determined. Please try again.",
          3: "Location request timed out. Please try again.",
        };
        toast(messages[err.code] || "Could not access your location.");
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  }, [resolveLocation, toast]);

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
            mapStyle="mapbox://styles/mapbox/navigation-day-v1"
            style={{ width: "100%", height: "100%" }}
            onClick={handleMapClick}
            onLoad={() => setMapLoaded(true)}
            cursor="crosshair"
          >
            <NavigationControl position="top-right" showCompass={false} />
            <ScaleControl position="top-right" unit="metric" />

            {/* User location marker */}
            {userLocation && (
              <Marker latitude={userLocation.lat} longitude={userLocation.lng} anchor="center">
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    backgroundColor: "#3b82f6",
                    border: "2.5px solid white",
                    boxShadow: "0 0 0 2px rgba(59,130,246,0.3), 0 1px 4px rgba(0,0,0,0.2)",
                    pointerEvents: "none",
                  }}
                />
              </Marker>
            )}

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

            {/* Popup for picked location */}
            {picked && !picked.loading && picked.details && (
              <Popup
                latitude={picked.lat}
                longitude={picked.lng}
                closeButton={false}
                closeOnClick={false}
                anchor="bottom"
                offset={40}
                className="map-picker-popup"
              >
                <div className="px-1 py-0.5 min-w-[140px]">
                  <p className="text-sm font-semibold">{picked.cityName}</p>
                  {picked.country && (
                    <p className="text-[11px] text-gray-500">{picked.country}</p>
                  )}
                  {/* Driving distance from user location */}
                  {userLocation && (
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {picked.drivingDistanceLoading ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="inline-block h-2.5 w-2.5 border-[1.5px] border-gray-400 border-t-transparent rounded-full animate-spin" />
                          Calculating distance…
                        </span>
                      ) : picked.drivingDistanceKm != null ? (
                        <span>
                          🚗 {picked.drivingDistanceKm.toLocaleString()} km from you
                        </span>
                      ) : null}
                    </p>
                  )}
                  {picked.error && (
                    <p className="text-[11px] text-red-500 mt-0.5">{picked.error}</p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="w-full mt-2 h-7 text-xs"
                    onClick={handleConfirm}
                  >
                    Select
                  </Button>
                </div>
              </Popup>
            )}

            {/* Loading popup */}
            {picked && picked.loading && (
              <Popup
                latitude={picked.lat}
                longitude={picked.lng}
                closeButton={false}
                closeOnClick={false}
                anchor="bottom"
                offset={40}
                className="map-picker-popup"
              >
                <div className="px-1 py-0.5 flex items-center gap-2">
                  <div className="h-3.5 w-3.5 border-2 border-[hsl(var(--primary))] border-t-transparent rounded-full animate-spin shrink-0" />
                  <p className="text-xs text-gray-500">{picked.cityName}</p>
                </div>
              </Popup>
            )}
          </MapGL>

          {/* My location button */}
          <button
            type="button"
            onClick={handleUseMyLocation}
            disabled={locating}
            title="Use my location"
            className="absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))]/90 px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] shadow-sm backdrop-blur-sm hover:bg-[hsl(var(--muted))] transition-colors min-h-[36px] min-w-[36px] disabled:opacity-60"
          >
            {locating ? (
              <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
              </svg>
            )}
            <span className="hidden sm:inline">My location</span>
          </button>
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
                  <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                    {picked.country}
                    {picked.drivingDistanceKm != null && ` · 🚗 ${picked.drivingDistanceKm.toLocaleString()} km`}
                  </p>
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
