/**
 * Favourite ↔ POI auto-sync utilities.
 *
 * When a favourite is created/updated, matching POIs in trip cities are
 * created/updated. When a city is added to a trip, matching favourites
 * are auto-added as POIs.
 *
 * "Matching" means: same country AND within the city's discover radius
 * (or default 10 km if no radius is set).
 */

import { prisma } from "@/lib/prisma";

const DEFAULT_RADIUS_KM = 10;

/** Haversine distance in km. */
function haversineKm(
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

type FavouriteData = {
  id: number;
  name: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  latitude: number;
  longitude: number;
  photoUrl: string | null;
  website: string | null;
  sourcePlaceId: string | null;
  country: string;
};

/**
 * After a favourite is created, find trip cities in the same country
 * that are within radius and create POIs in them.
 */
export async function syncFavouriteToTrips(
  fav: FavouriteData,
  userId: number,
): Promise<number> {
  // Find cities belonging to this user's trips, in the same country
  const cities = await prisma.city.findMany({
    where: {
      country: { equals: fav.country, mode: "insensitive" },
      trip: { userId },
      latitude: { not: null },
      longitude: { not: null },
    },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      discoverRadiusKm: true,
    },
  });

  let created = 0;

  for (const city of cities) {
    if (city.latitude == null || city.longitude == null) continue;

    const radiusKm = city.discoverRadiusKm ?? DEFAULT_RADIUS_KM;
    const dist = haversineKm(
      city.latitude,
      city.longitude,
      fav.latitude,
      fav.longitude,
    );

    if (dist > radiusKm) continue;

    // Check for existing POI (by favouriteItemId, sourcePlaceId, or name)
    const existing = await prisma.poi.findFirst({
      where: {
        cityId: city.id,
        OR: [
          { favouriteItemId: fav.id },
          ...(fav.sourcePlaceId ? [{ placeId: fav.sourcePlaceId }] : []),
          { name: { equals: fav.name, mode: "insensitive" as const } },
        ],
      },
      select: { id: true },
    });

    if (!existing) {
      await prisma.poi.create({
        data: {
          name: fav.name,
          category: fav.category,
          subcategory: fav.subcategory,
          description: fav.description,
          latitude: fav.latitude,
          longitude: fav.longitude,
          photoUrl: fav.photoUrl,
          website: fav.website,
          placeId: fav.sourcePlaceId,
          favouriteItemId: fav.id,
          cityId: city.id,
        },
      });
      created++;
    }
  }

  return created;
}

/**
 * After a city is added to a trip, find favourites in the same country
 * that are within the city's discover radius and create POIs.
 */
export async function syncFavouritesToCity(
  cityId: number,
  cityLat: number,
  cityLon: number,
  country: string | null,
  radiusKm: number | null,
  userId: number,
): Promise<number> {
  const radius = radiusKm ?? DEFAULT_RADIUS_KM;

  // Find favourites for this user — filter by country when available, otherwise check all
  const favourites = await prisma.favouriteItem.findMany({
    where: {
      ...(country ? { country: { equals: country, mode: "insensitive" } } : {}),
      list: { userId },
    },
    select: {
      id: true,
      name: true,
      category: true,
      subcategory: true,
      description: true,
      latitude: true,
      longitude: true,
      photoUrl: true,
      website: true,
      sourcePlaceId: true,
    },
  });

  let created = 0;

  for (const fav of favourites) {
    const dist = haversineKm(cityLat, cityLon, fav.latitude, fav.longitude);
    if (dist > radius) continue;

    // Check for existing POI
    const existing = await prisma.poi.findFirst({
      where: {
        cityId,
        OR: [
          { favouriteItemId: fav.id },
          ...(fav.sourcePlaceId ? [{ placeId: fav.sourcePlaceId }] : []),
          { name: { equals: fav.name, mode: "insensitive" as const } },
        ],
      },
      select: { id: true },
    });

    if (!existing) {
      await prisma.poi.create({
        data: {
          name: fav.name,
          category: fav.category,
          subcategory: fav.subcategory,
          description: fav.description,
          latitude: fav.latitude,
          longitude: fav.longitude,
          photoUrl: fav.photoUrl,
          website: fav.website,
          placeId: fav.sourcePlaceId,
          favouriteItemId: fav.id,
          cityId,
        },
      });
      created++;
    }
  }

  return created;
}

/**
 * When a favourite is updated, propagate changes to all linked POIs.
 */
export async function syncFavouriteUpdateToPois(
  favouriteItemId: number,
  updates: {
    name?: string;
    category?: string;
    subcategory?: string | null;
    description?: string | null;
    latitude?: number;
    longitude?: number;
    photoUrl?: string | null;
    website?: string | null;
  },
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.category !== undefined) data.category = updates.category;
  if (updates.subcategory !== undefined) data.subcategory = updates.subcategory;
  if (updates.description !== undefined) data.description = updates.description;
  if (updates.latitude !== undefined) data.latitude = updates.latitude;
  if (updates.longitude !== undefined) data.longitude = updates.longitude;
  if (updates.photoUrl !== undefined) data.photoUrl = updates.photoUrl;
  if (updates.website !== undefined) data.website = updates.website;

  if (Object.keys(data).length === 0) return;

  await prisma.poi.updateMany({
    where: { favouriteItemId },
    data,
  });
}
