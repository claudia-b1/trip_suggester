"use client";

import { useState } from "react";
import { RecommendationsPanel } from "./recommendations-panel";
import { PoisSection, type PoiDTO } from "./pois-section";
import type { DayPlanDTO } from "./daily-plan";
import type { FavouriteItemDTO } from "@/components/favourites/favourites-provider";

const DEFAULT_RADIUS_KM = 5;
const DEFAULT_NEARBY_RADIUS_KM = 30;

/** Haversine distance in km (client-side copy). */
function distKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Detect whether a previous discover run used nearby search by checking if any
 * stored POI is more than 15 km from the city centre. Returns the max distance
 * rounded up to the nearest 5 km, or null if no nearby POIs are detected.
 */
function deriveNearbyRadius(
  pois: PoiDTO[],
  cityLat?: number,
  cityLon?: number,
): number | null {
  if (!cityLat || !cityLon) return null;
  let maxKm = 0;
  for (const p of pois) {
    if (p.latitude != null && p.longitude != null) {
      const d = distKm(cityLat, cityLon, p.latitude, p.longitude);
      if (d > maxKm) maxKm = d;
    }
  }
  if (maxKm < 15) return null;
  return Math.max(DEFAULT_NEARBY_RADIUS_KM, Math.ceil(maxKm / 5) * 5);
}

export function CityPlanningSection({
  cityId,
  pois,
  dayPlans,
  cityLat,
  cityLon,
  cityName,
  country,
  favouriteItems,
  initialUserRatings,
  initialNotInterested,
  initialVisitedPoiIds,
  dayNotes,
}: {
  cityId: number;
  pois: PoiDTO[];
  dayPlans: DayPlanDTO[];
  cityLat?: number;
  cityLon?: number;
  cityName?: string;
  country?: string;
  favouriteItems?: FavouriteItemDTO[];
  initialUserRatings?: Record<number, number>;
  initialNotInterested?: number[];
  initialVisitedPoiIds?: number[];
  dayNotes?: Record<number, { id: number; content: string }>;
}) {
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [nearbyEnabled, setNearbyEnabled] = useState(false);
  const [nearbyRadiusKm, setNearbyRadiusKm] = useState(DEFAULT_NEARBY_RADIUS_KM);

  // Tracks the radius that was actually used in the last nearby run.
  // Initialised from existing POIs so the circle re-appears after page reload.
  const [ranNearbyKm, setRanNearbyKm] = useState<number | null>(
    () => deriveNearbyRadius(pois, cityLat, cityLon),
  );

  // Show the nearby circle if the toggle is currently on OR if a previous run
  // used nearby (so the circle persists even after the toggle is unchecked).
  const visibleNearbyKm = nearbyEnabled ? nearbyRadiusKm : (ranNearbyKm ?? undefined);

  return (
    <>
      <div id="discover-section">
        <RecommendationsPanel
          cityId={cityId}
          poisCount={pois.length}
          radiusKm={radiusKm}
          onRadiusChange={setRadiusKm}
          nearbyEnabled={nearbyEnabled}
          onNearbyEnabledChange={setNearbyEnabled}
          nearbyRadiusKm={nearbyRadiusKm}
          onNearbyRadiusChange={setNearbyRadiusKm}
          onNearbyRan={setRanNearbyKm}
        />
      </div>
      <div id="pois-section">
        <PoisSection
          cityId={cityId}
          pois={pois}
          dayPlans={dayPlans}
          cityLat={cityLat}
          cityLon={cityLon}
          radiusKm={radiusKm}
          nearbyRadiusKm={visibleNearbyKm}
          cityName={cityName}
          country={country}
          favouriteItems={favouriteItems}
          initialUserRatings={initialUserRatings}
          initialNotInterested={initialNotInterested}
          initialVisitedPoiIds={initialVisitedPoiIds}
          dayNotes={dayNotes}
        />
      </div>
    </>
  );
}
