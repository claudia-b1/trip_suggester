/**
 * Ownership verification helpers.
 * Used by API routes to confirm a resource belongs to the active user.
 */
import { prisma } from "@/lib/prisma";

/** Verify a trip belongs to the given user. */
export async function verifyTripOwnership(
  tripId: number,
  userId: number,
): Promise<boolean> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: { id: true },
  });
  return trip !== null;
}

/** Verify a city's trip belongs to the given user. */
export async function verifyCityOwnership(
  cityId: number,
  userId: number,
): Promise<boolean> {
  const city = await prisma.city.findFirst({
    where: { id: cityId, trip: { userId } },
    select: { id: true },
  });
  return city !== null;
}

/** Verify a favourite list belongs to the given user. */
export async function verifyListOwnership(
  listId: number,
  userId: number,
): Promise<boolean> {
  const list = await prisma.favouriteList.findFirst({
    where: { id: listId, userId },
    select: { id: true },
  });
  return list !== null;
}

/** Verify a day plan's city's trip belongs to the given user. */
export async function verifyDayPlanOwnership(
  dayPlanId: number,
  userId: number,
): Promise<boolean> {
  const dp = await prisma.dayPlan.findFirst({
    where: { id: dayPlanId, city: { trip: { userId } } },
    select: { id: true },
  });
  return dp !== null;
}

/** Verify a POI's city's trip belongs to the given user. */
export async function verifyPoiOwnership(
  poiId: number,
  userId: number,
): Promise<boolean> {
  const poi = await prisma.poi.findFirst({
    where: { id: poiId, city: { trip: { userId } } },
    select: { id: true },
  });
  return poi !== null;
}
