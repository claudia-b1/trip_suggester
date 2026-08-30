import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyTripOwnership } from "@/lib/ownership";

/**
 * POST /api/trips/:id/copy — deep-clone a trip to another user.
 * Body: { targetUserId: number }
 *
 * Clones: Trip → Cities → Pois → DayPlans → DayActivities → TripNotes
 * Does NOT clone: PoiRatings (personal to each user)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  const tripId = Number(id);
  if (!await verifyTripOwnership(tripId, userId)) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.targetUserId !== "number") {
    return NextResponse.json({ error: "targetUserId is required" }, { status: 400 });
  }
  const { targetUserId } = body;

  // Verify target user exists
  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) {
    return NextResponse.json({ error: "Target user not found" }, { status: 404 });
  }

  // Load the full trip tree
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      cities: {
        include: {
          pois: true,
          dayPlans: {
            include: { activities: true },
          },
        },
      },
      notes: true,
    },
  });

  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }

  // Deep-clone in a transaction
  const cloned = await prisma.$transaction(async (tx) => {
    // 1. Clone trip
    const newTrip = await tx.trip.create({
      data: {
        name: `${trip.name} (copy)`,
        startDate: trip.startDate,
        endDate: trip.endDate,
        archived: false,
        coverImage: trip.coverImage,
        userId: targetUserId,
      },
    });

    // 2. Clone cities (preserving parent-child relationships)
    // First pass: create all cities and build old→new ID mapping
    const cityIdMap = new Map<number, number>();
    // Sort: parents first (parentCityId === null), then children
    const sortedCities = [...trip.cities].sort((a, b) => {
      if (a.parentCityId === null && b.parentCityId !== null) return -1;
      if (a.parentCityId !== null && b.parentCityId === null) return 1;
      return a.order - b.order;
    });

    for (const city of sortedCities) {
      const newCity = await tx.city.create({
        data: {
          name: city.name,
          nickname: city.nickname,
          startDate: city.startDate,
          endDate: city.endDate,
          order: city.order,
          country: city.country,
          countryCode: city.countryCode,
          latitude: city.latitude,
          longitude: city.longitude,
          timezone: city.timezone,
          tripId: newTrip.id,
          parentCityId: city.parentCityId ? (cityIdMap.get(city.parentCityId) ?? null) : null,
        },
      });
      cityIdMap.set(city.id, newCity.id);
    }

    // 3. Clone POIs and build old→new ID mapping
    const poiIdMap = new Map<number, number>();
    for (const city of trip.cities) {
      const newCityId = cityIdMap.get(city.id)!;
      for (const poi of city.pois) {
        const newPoi = await tx.poi.create({
          data: {
            name: poi.name,
            category: poi.category,
            description: poi.description,
            latitude: poi.latitude,
            longitude: poi.longitude,
            imageUrl: poi.imageUrl,
            rating: poi.rating,
            bestTimeToVisit: poi.bestTimeToVisit,
            estimatedDurationMinutes: poi.estimatedDurationMinutes,
            tips: poi.tips,
            placeId: poi.placeId,
            priceLevel: poi.priceLevel,
            website: poi.website,
            phoneNumber: poi.phoneNumber,
            openingHours: poi.openingHours,
            photoUrl: poi.photoUrl,
            fee: poi.fee,
            isUnescoSite: poi.isUnescoSite,
            inceptionYear: poi.inceptionYear,
            wikidataId: poi.wikidataId,
            score: poi.score,
            scoreBreakdown: poi.scoreBreakdown,
            userRatingCount: poi.userRatingCount,
            subcategory: poi.subcategory,
            cityId: newCityId,
          },
        });
        poiIdMap.set(poi.id, newPoi.id);
      }
    }

    // 4. Clone DayPlans and DayActivities
    for (const city of trip.cities) {
      const newCityId = cityIdMap.get(city.id)!;
      for (const dp of city.dayPlans) {
        const newDayPlan = await tx.dayPlan.create({
          data: {
            date: dp.date,
            cityId: newCityId,
          },
        });

        for (const act of dp.activities) {
          const newPoiId = poiIdMap.get(act.poiId);
          if (newPoiId) {
            await tx.dayActivity.create({
              data: {
                dayPlanId: newDayPlan.id,
                poiId: newPoiId,
                timeSlot: act.timeSlot,
                order: act.order,
              },
            });
          }
        }
      }
    }

    // 5. Clone trip-level notes
    for (const note of trip.notes) {
      if (note.tripId && !note.cityId && !note.dayPlanId) {
        await tx.tripNote.create({
          data: {
            tripId: newTrip.id,
            content: note.content,
          },
        });
      }
    }

    return newTrip;
  });

  return NextResponse.json(cloned, { status: 201 });
}
