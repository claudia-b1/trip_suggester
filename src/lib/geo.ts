/** Shared geographic utility functions. */

export const EARTH_RADIUS_KM = 6371;
export const EARTH_RADIUS_M = 6371000;

/**
 * Offset a lat/lon point by a given distance and compass bearing.
 * bearingDeg: 0 = North, 90 = East, 180 = South, 270 = West.
 */
export function offsetLatLon(
  lat: number,
  lon: number,
  distanceKm: number,
  bearingDeg: number,
): { lat: number; lon: number } {
  const R = EARTH_RADIUS_KM;
  const d = distanceKm / R;
  const b = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

/** Haversine distance in km between two lat/lon points. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = EARTH_RADIUS_KM;
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
 * Compute initial compass bearing (in degrees, 0–360) from point 1 to point 2.
 * 0 = North, 90 = East, 180 = South, 270 = West.
 */
export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Convert a bearing (0–360) to a compass label like "N", "NE", "E", etc. */
export function compassLabel(deg: number): string {
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
  const index = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return labels[index];
}

/** Haversine distance in metres between two lat/lon points. */
export function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = EARTH_RADIUS_M;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
