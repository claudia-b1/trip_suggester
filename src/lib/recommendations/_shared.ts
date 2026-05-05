import type { Category } from "@/lib/categories";

export type GenerateInput = {
  cityName: string;
  /** Selected subcategory IDs for this generator's category (empty = all). */
  subcategories?: string[];
  /** Optional cuisine keyword to filter food results (e.g. "italian"). */
  cuisineFilter?: string;
};

export type RecommendedPoi = {
  name: string;
  category: Category;
  description: string;
  latitude: number;
  longitude: number;
  /** 1–5 star rating (normalized from source) */
  rating?: number;
  /** Best time slot to visit */
  bestTimeToVisit?: "morning" | "afternoon" | "evening";
  /** Typical visit duration in minutes */
  estimatedDurationMinutes?: number;
  /** One practical visitor tip */
  tips?: string;
  // ── Enrichment fields (populated for top-ranked POIs only) ────────────────
  /** Discovery place ID — used as enrichment cache key */
  placeId?: string;
  /** 0 = free, 1 = $, 2 = $$, 3 = $$$, 4 = $$$$ */
  priceLevel?: number;
  website?: string;
  phoneNumber?: string;
  /** Human-readable opening hours */
  openingHours?: string;
  /** Primary photo URL */
  photoUrl?: string;
  /** Whether the place is a UNESCO World Heritage Site */
  isUnescoSite?: boolean;
  /** Founding/opening year from Wikidata */
  inceptionYear?: number;
  /** Wikidata Q-identifier */
  wikidataId?: string;
  /** Google user rating count — used for re-ranking, not persisted */
  userRatingCount?: number;
};

export type CityCoords = { lat: number; lon: number };

/**
 * Geocode a city name → {lat, lon} using the Geoapify Geocoding API.
 * Always available because GEOAPIFY_API_KEY is required for FOOD/NIGHTLIFE anyway.
 */
export async function geocodeCity(cityName: string): Promise<CityCoords> {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) throw new Error("GEOAPIFY_API_KEY is not set");

  const url =
    `https://api.geoapify.com/v1/geocode/search` +
    `?text=${encodeURIComponent(cityName)}&type=city&limit=1&apiKey=${key}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geoapify geocode error: ${res.status}`);

  const data = (await res.json()) as {
    features: Array<{ geometry: { coordinates: [number, number] } }>;
  };

  if (!data.features.length) throw new Error(`City not found: ${cityName}`);

  const [lon, lat] = data.features[0].geometry.coordinates;
  return { lat, lon };
}

/** Haversine distance in km between two lat/lon points. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
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
