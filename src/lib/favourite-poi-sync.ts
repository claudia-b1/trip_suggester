/**
 * Favourite ↔ POI auto-sync utilities.
 *
 * When a favourite is created/updated, matching POIs in trip cities are
 * created/updated. When a city page is loaded, matching favourites
 * are auto-added as POIs.
 *
 * "Matching" means: same country AND within the favourite map radius (100 km).
 * If a user deletes a favourite-linked POI, a DismissedFavouriteCity row is
 * recorded so the sync won't re-create it.
 */

import { prisma } from "@/lib/prisma";

const DEFAULT_FAV_RADIUS_KM = 50;

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
  phoneNumber?: string | null;
  openingHours?: string | null;
  priceLevel?: number | null;
  fee?: string | null;
  address?: string | null;
  notes?: string | null;
  extraFields?: unknown;
  visited?: boolean;
  personalRating?: number | null;
};

/** Build POI creation data from a favourite item */
function favToPoiData(fav: Omit<FavouriteData, "country">, cityId: number) {
  return {
    name: fav.name,
    category: fav.category,
    subcategory: fav.subcategory,
    description: fav.description,
    latitude: fav.latitude,
    longitude: fav.longitude,
    photoUrl: fav.photoUrl,
    website: fav.website,
    phoneNumber: fav.phoneNumber ?? null,
    openingHours: fav.openingHours ?? null,
    priceLevel: fav.priceLevel ?? null,
    fee: fav.fee ?? null,
    address: fav.address ?? null,
    notes: fav.notes ?? null,
    placeId: fav.sourcePlaceId,
    extraFields: fav.extraFields != null ? fav.extraFields : undefined,
    favouriteItemId: fav.id,
    cityId,
  };
}

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
    },
  });

  if (cities.length === 0) return 0;

  // Batch: get dismissed pairs for this favourite
  const dismissedCityIds = new Set(
    (await prisma.dismissedFavouriteCity.findMany({
      where: { favouriteItemId: fav.id },
      select: { cityId: true },
    })).map((d) => d.cityId),
  );

  // Batch: get existing POIs linked to this favourite (across all cities)
  const existingPois = await prisma.poi.findMany({
    where: {
      cityId: { in: cities.map((c) => c.id) },
      OR: [
        { favouriteItemId: fav.id },
        ...(fav.sourcePlaceId ? [{ placeId: fav.sourcePlaceId }] : []),
      ],
    },
    select: { cityId: true },
  });
  const citiesWithExisting = new Set(existingPois.map((p) => p.cityId));

  const toCreate: ReturnType<typeof favToPoiData>[] = [];

  for (const city of cities) {
    if (city.latitude == null || city.longitude == null) continue;
    if (dismissedCityIds.has(city.id)) continue;
    if (citiesWithExisting.has(city.id)) continue;

    const dist = haversineKm(city.latitude, city.longitude, fav.latitude, fav.longitude);
    if (dist > DEFAULT_FAV_RADIUS_KM) continue;

    toCreate.push(favToPoiData(fav, city.id));
  }

  if (toCreate.length > 0) {
    await prisma.poi.createMany({ data: toCreate });

    // Create PoiRating records if the favourite has visited/personalRating
    if (fav.visited || fav.personalRating != null) {
      const createdPois = await prisma.poi.findMany({
        where: { favouriteItemId: fav.id },
        select: { id: true },
      });
      if (createdPois.length > 0) {
        await prisma.poiRating.createMany({
          data: createdPois.map((p) => ({
            poiId: p.id,
            userId,
            visited: fav.visited ?? false,
            rating: fav.personalRating ?? null,
          })),
          skipDuplicates: true,
        });
      }
    }
  }

  return toCreate.length;
}

/**
 * On city page load (and after city creation), find favourites in the same
 * country that are within 100 km and create POIs for any that are missing.
 */
export async function syncFavouritesToCity(
  cityId: number,
  cityLat: number,
  cityLon: number,
  country: string | null,
  _radiusKm: number | null, // kept for API compat but we always use 100 km
  userId: number,
): Promise<number> {
  // Find favourites for this user — filter by country when available
  const hasCountry = country != null && country.trim() !== "";
  const favourites = await prisma.favouriteItem.findMany({
    where: {
      ...(hasCountry ? { country: { equals: country!, mode: "insensitive" } } : {}),
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
      phoneNumber: true,
      openingHours: true,
      priceLevel: true,
      fee: true,
      address: true,
      notes: true,
      extraFields: true,
      visited: true,
      personalRating: true,
    },
  });

  if (favourites.length === 0) return 0;

  // Batch: get dismissed favourite IDs for this city
  const dismissedFavIds = new Set(
    (await prisma.dismissedFavouriteCity.findMany({
      where: { cityId },
      select: { favouriteItemId: true },
    })).map((d) => d.favouriteItemId),
  );

  // Batch: get existing POIs in this city for dedup
  const existingPois = await prisma.poi.findMany({
    where: { cityId },
    select: { favouriteItemId: true, placeId: true, name: true },
  });
  const existingFavIds = new Set(
    existingPois.filter((p) => p.favouriteItemId != null).map((p) => p.favouriteItemId!),
  );
  const existingPlaceIds = new Set(
    existingPois.filter((p) => p.placeId != null).map((p) => p.placeId!),
  );
  const existingNames = new Set(
    existingPois.map((p) => p.name.toLowerCase().trim()),
  );

  const toCreate: ReturnType<typeof favToPoiData>[] = [];

  for (const fav of favourites) {
    // Distance check
    const dist = haversineKm(cityLat, cityLon, fav.latitude, fav.longitude);
    if (dist > DEFAULT_FAV_RADIUS_KM) continue;

    // User dismissed this favourite from this city
    if (dismissedFavIds.has(fav.id)) continue;

    // Already has a linked POI
    if (existingFavIds.has(fav.id)) continue;

    // Dedup by placeId
    if (fav.sourcePlaceId && existingPlaceIds.has(fav.sourcePlaceId)) continue;

    // Dedup by name (case-insensitive)
    if (existingNames.has(fav.name.toLowerCase().trim())) continue;

    toCreate.push(favToPoiData(fav, cityId));
    // Add to seen sets to prevent duplicates within the same batch
    existingFavIds.add(fav.id);
    if (fav.sourcePlaceId) existingPlaceIds.add(fav.sourcePlaceId);
    existingNames.add(fav.name.toLowerCase().trim());
  }

  if (toCreate.length > 0) {
    await prisma.poi.createMany({ data: toCreate });

    // Create PoiRating records for favourites with visited/personalRating
    const favsWithRating = favourites.filter(
      (f) => toCreate.some((c) => c.favouriteItemId === f.id) &&
             (f.visited || f.personalRating != null),
    );
    if (favsWithRating.length > 0) {
      // Query back the created POIs to get their IDs
      const createdPois = await prisma.poi.findMany({
        where: { cityId, favouriteItemId: { in: favsWithRating.map((f) => f.id) } },
        select: { id: true, favouriteItemId: true },
      });
      const ratingData = createdPois
        .map((poi) => {
          const fav = favsWithRating.find((f) => f.id === poi.favouriteItemId);
          if (!fav) return null;
          return {
            poiId: poi.id,
            userId,
            visited: fav.visited ?? false,
            rating: fav.personalRating ?? null,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (ratingData.length > 0) {
        await prisma.poiRating.createMany({ data: ratingData, skipDuplicates: true });
      }
    }
  }

  return toCreate.length;
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
    phoneNumber?: string | null;
    openingHours?: string | null;
    priceLevel?: number | null;
    fee?: string | null;
    address?: string | null;
    notes?: string | null;
    extraFields?: unknown;
  },
): Promise<void> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) data[key] = value;
  }

  if (Object.keys(data).length === 0) return;

  await prisma.poi.updateMany({
    where: { favouriteItemId },
    data,
  });
}
