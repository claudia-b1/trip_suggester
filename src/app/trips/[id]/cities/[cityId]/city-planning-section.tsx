"use client";

import { useState } from "react";
import { RecommendationsPanel } from "./recommendations-panel";
import { PoisSection, type PoiDTO } from "./pois-section";
import type { DayPlanDTO, SubcityDayPlanDTO } from "./daily-plan";
import type { FavouriteItemDTO } from "@/components/favourites/favourites-provider";
import { haversineKm } from "@/lib/geo";
import { DEFAULT_DISCOVER_RADIUS_KM, DEFAULT_NEARBY_RADIUS_KM, NEARBY_THRESHOLD_KM } from "@/lib/constants";

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
      const d = haversineKm(cityLat, cityLon, p.latitude, p.longitude);
      if (d > maxKm) maxKm = d;
    }
  }
  if (maxKm < NEARBY_THRESHOLD_KM) return null;
  return Math.max(DEFAULT_NEARBY_RADIUS_KM, Math.ceil(maxKm / 5) * 5);
}

export function CityPlanningSection({
  tripId,
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
  subcityDayPlans,
  initialRadiusKm,
}: {
  tripId: number;
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
  subcityDayPlans?: SubcityDayPlanDTO[];
  initialRadiusKm?: number;
}) {
  const [radiusKm, setRadiusKm] = useState(initialRadiusKm ?? DEFAULT_DISCOVER_RADIUS_KM);
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
          tripId={tripId}
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
          subcityDayPlans={subcityDayPlans}
        />
      </div>
    </>
  );
}
