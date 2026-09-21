import { haversineKm } from "@/lib/geo";

const POI_MAX_DISTANCE_KM = 75;

export type LocationValidation = {
  valid: boolean;
  nearCity: boolean;
  distanceKm?: number;
  warning?: string;
};

export function validatePoiLocation(
  poiLat: number | null | undefined,
  poiLng: number | null | undefined,
  cityLat: number | null | undefined,
  cityLng: number | null | undefined,
  options?: { maxDistanceKm?: number },
): LocationValidation {
  if (poiLat == null || poiLng == null) {
    return { valid: false, nearCity: false };
  }
  if (poiLat < -90 || poiLat > 90 || poiLng < -180 || poiLng > 180) {
    return { valid: false, nearCity: false, warning: "Coordinates out of range" };
  }
  if (poiLat === 0 && poiLng === 0) {
    return { valid: false, nearCity: false, warning: "Null island (0, 0)" };
  }
  if (cityLat == null || cityLng == null) {
    return { valid: true, nearCity: true };
  }

  const distanceKm = haversineKm(poiLat, poiLng, cityLat, cityLng);
  const maxKm = options?.maxDistanceKm ?? POI_MAX_DISTANCE_KM;

  if (distanceKm > maxKm) {
    return {
      valid: true,
      nearCity: false,
      distanceKm: Math.round(distanceKm),
      warning: `~${Math.round(distanceKm)}km from city centre`,
    };
  }

  return { valid: true, nearCity: true, distanceKm: Math.round(distanceKm) };
}
