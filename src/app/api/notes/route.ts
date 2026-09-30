import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyTripOwnership, verifyCityOwnership, verifyDayPlanOwnership } from "@/lib/ownership";

/**
 * A note is scoped to exactly one of trip / city / dayPlan, so each scope has
 * its own ownership path.
 */
async function ownsScope(
  scope: { tripId?: number; cityId?: number; dayPlanId?: number },
  userId: number,
): Promise<boolean> {
  if (scope.tripId != null) return verifyTripOwnership(scope.tripId, userId);
  if (scope.cityId != null) return verifyCityOwnership(scope.cityId, userId);
  if (scope.dayPlanId != null) return verifyDayPlanOwnership(scope.dayPlanId, userId);
  return false;
}

/** GET /api/notes?tripId=X or ?cityId=X or ?dayPlanId=X */
export async function GET(req: Request) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const tripId = searchParams.get("tripId");
  const cityId = searchParams.get("cityId");
  const dayPlanId = searchParams.get("dayPlanId");

  const where: Record<string, unknown> = {};
  const scope: { tripId?: number; cityId?: number; dayPlanId?: number } = {};
  if (tripId) { where.tripId = Number(tripId); scope.tripId = Number(tripId); }
  if (cityId) { where.cityId = Number(cityId); scope.cityId = Number(cityId); }
  if (dayPlanId) { where.dayPlanId = Number(dayPlanId); scope.dayPlanId = Number(dayPlanId); }

  if (Object.keys(where).length === 0) {
    return NextResponse.json({ error: "Provide tripId, cityId, or dayPlanId" }, { status: 400 });
  }

  if (!await ownsScope(scope, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const notes = await prisma.tripNote.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(notes);
}

/** POST /api/notes — create a note */
export async function POST(req: Request) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { tripId, cityId, dayPlanId, content } = body;

  // Require exactly one scope
  const scopes = [tripId, cityId, dayPlanId].filter((v) => v != null);
  if (scopes.length === 0) {
    return NextResponse.json({ error: "Provide tripId, cityId, or dayPlanId" }, { status: 400 });
  }

  if (!await ownsScope({ tripId, cityId, dayPlanId }, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const note = await prisma.tripNote.create({
    data: {
      tripId: tripId ?? null,
      cityId: cityId ?? null,
      dayPlanId: dayPlanId ?? null,
      content: typeof content === "string" ? content : "",
    },
  });

  return NextResponse.json(note, { status: 201 });
}
