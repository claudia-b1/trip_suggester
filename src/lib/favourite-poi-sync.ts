/**
 * Favourite ↔ POI auto-sync utilities.
 *
 * When a favourite is created/updated, matching POIs in trip cities are
 * created/updated. When a city page is loaded, matching favourites
 * are auto-added as POIs.
 *
 * "Matching" means: same country AND within the effective radius.
 *   • Travel stops always use DEFAULT_FAV_RADIUS_KM (80 km).
 *   • Destinations / sub-destinations use the most recent discover radius
 *     (discoverRadiusKm on the City model). No sync until discover is run.
 *
 * If a user deletes a favourite-linked POI, a DismissedFavouriteCity row is
 * recorded so the sync won't re-create it.
 */

import { prisma } from "@/lib/prisma";

const DEFAULT_FAV_RADIUS_KM = 80;

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
      type: true,
      discoverRadiusKm: true,
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

  // Batch: get existing POIs linked to this favourite OR matching by name (across all cities)
  const cityIds = cities.map((c) => c.id);
  const existingPois = await prisma.poi.findMany({
    where: {
      cityId: { in: cityIds },
      OR: [
        { favouriteItemId: fav.id },
        ...(fav.sourcePlaceId ? [{ placeId: fav.sourcePlaceId }] : []),
        { name: { equals: fav.name, mode: "insensitive" }, category: fav.category },
      ],
    },
    select: { cityId: true, id: true, favouriteItemId: true },
  });
  const citiesWithExisting = new Set(existingPois.map((p) => p.cityId));

  // Link unlinked existing POIs to this favourite (e.g., manually created accommodation)
  const unlinkable = existingPois.filter((p) => p.favouriteItemId == null);
  if (unlinkable.length > 0) {
    await Promise.allSettled(
      unlinkable.map((p) =>
        prisma.poi.update({ where: { id: p.id }, data: { favouriteItemId: fav.id } }),
      ),
    );
  }

  const toCreate: ReturnType<typeof favToPoiData>[] = [];

  for (const city of cities) {
    if (city.latitude == null || city.longitude == null) continue;
    if (dismissedCityIds.has(city.id)) continue;
    if (citiesWithExisting.has(city.id)) continue;

    // Destinations require a discover radius; skip if none set yet
    if (city.type !== "stop" && city.discoverRadiusKm == null) continue;

    const dist = haversineKm(city.latitude, city.longitude, fav.latitude, fav.longitude);
    const maxDist = city.type === "stop"
      ? DEFAULT_FAV_RADIUS_KM
      : city.discoverRadiusKm!;
    if (dist > maxDist) continue;

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
 * country that are within radius and create POIs for any that are missing.
 *
 * For travel stops (`cityType === "stop"`), always uses DEFAULT_FAV_RADIUS_KM (80 km).
 * For destinations / sub-destinations, uses the most recent discover radius
 * (`discoverRadiusKm`). Skips sync entirely if no discover has been run yet,
 * and prunes any stale favourite POIs that were created under a previous radius.
 */
export async function syncFavouritesToCity(
  cityId: number,
  cityLat: number,
  cityLon: number,
  country: string | null,
  discoverRadiusKm: number | null,
  userId: number,
  cityType: string = "destination",
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

  if (favourites.length === 0) {
    // Prune stale favourite POIs that are now outside the radius
    const pruneRadius = cityType === "stop" ? DEFAULT_FAV_RADIUS_KM : discoverRadiusKm;
    await pruneFavouritePoisOutsideRadius(cityId, cityLat, cityLon, pruneRadius);
    return 0;
  }

  // Destinations require a discover radius — no favourite sync until discover is run.
  // Travel stops always use the wide 80 km radius.
  if (cityType !== "stop" && discoverRadiusKm == null) {
    await pruneFavouritePoisOutsideRadius(cityId, cityLat, cityLon, null);
    return 0;
  }

  const effectiveRadiusKm =
    cityType === "stop" ? DEFAULT_FAV_RADIUS_KM : discoverRadiusKm!;

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
    select: { id: true, favouriteItemId: true, placeId: true, name: true, category: true },
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
  const toLink: { poiId: number; favouriteItemId: number }[] = [];

  for (const fav of favourites) {
    // Distance check
    const dist = haversineKm(cityLat, cityLon, fav.latitude, fav.longitude);
    if (dist > effectiveRadiusKm) continue;

    // User dismissed this favourite from this city
    if (dismissedFavIds.has(fav.id)) continue;

    // Already has a linked POI
    if (existingFavIds.has(fav.id)) continue;

    // Dedup by placeId — but link the unlinked POI to this favourite
    if (fav.sourcePlaceId && existingPlaceIds.has(fav.sourcePlaceId)) {
      const match = existingPois.find((p) => p.placeId === fav.sourcePlaceId && !p.favouriteItemId);
      if (match) toLink.push({ poiId: match.id, favouriteItemId: fav.id });
      continue;
    }

    // Dedup by name (case-insensitive) — but link the unlinked POI to this favourite
    if (existingNames.has(fav.name.toLowerCase().trim())) {
      const match = existingPois.find(
        (p) => p.name.toLowerCase().trim() === fav.name.toLowerCase().trim() && !p.favouriteItemId && p.category === fav.category,
      );
      if (match) toLink.push({ poiId: match.id, favouriteItemId: fav.id });
      continue;
    }

    toCreate.push(favToPoiData(fav, cityId));
    // Add to seen sets to prevent duplicates within the same batch
    existingFavIds.add(fav.id);
    if (fav.sourcePlaceId) existingPlaceIds.add(fav.sourcePlaceId);
    existingNames.add(fav.name.toLowerCase().trim());
  }

  // Link unlinked existing POIs to their matching favourite (e.g., manually created accommodations)
  if (toLink.length > 0) {
    await Promise.allSettled(
      toLink.map((l) =>
        prisma.poi.update({ where: { id: l.poiId }, data: { favouriteItemId: l.favouriteItemId } }),
      ),
    );
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

  // Prune favourite-synced POIs that are now outside the effective radius
  await pruneFavouritePoisOutsideRadius(cityId, cityLat, cityLon, effectiveRadiusKm);

  return toCreate.length;
}

/**
 * Remove favourite-synced POIs that are outside the given radius.
 * If radiusKm is null (destination with no discover run), removes ALL favourite-synced POIs.
 * Skips POIs that are the city's selected accommodation or used in day plans.
 */
async function pruneFavouritePoisOutsideRadius(
  cityId: number,
  cityLat: number,
  cityLon: number,
  radiusKm: number | null,
): Promise<number> {
  const favPois = await prisma.poi.findMany({
    where: { cityId, favouriteItemId: { not: null } },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      activities: { select: { id: true }, take: 1 },
    },
  });

  if (favPois.length === 0) return 0;

  // Don't remove the selected accommodation
  const city = await prisma.city.findUnique({
    where: { id: cityId },
    select: { accommodationPoiId: true },
  });

  const toDelete: number[] = [];
  for (const poi of favPois) {
    // Keep POIs that are the selected accommodation
    if (city?.accommodationPoiId === poi.id) continue;
    // Keep POIs that are used in day plans
    if (poi.activities.length > 0) continue;

    if (radiusKm == null) {
      // No discover radius → remove all favourite POIs
      toDelete.push(poi.id);
    } else if (poi.latitude != null && poi.longitude != null) {
      const dist = haversineKm(cityLat, cityLon, poi.latitude, poi.longitude);
      if (dist > radiusKm) {
        toDelete.push(poi.id);
      }
    }
  }

  if (toDelete.length > 0) {
    await prisma.poi.deleteMany({ where: { id: { in: toDelete } } });
  }

  return toDelete.length;
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
