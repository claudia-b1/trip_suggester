import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET /api/notes?tripId=X or ?cityId=X or ?dayPlanId=X */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tripId = searchParams.get("tripId");
  const cityId = searchParams.get("cityId");
  const dayPlanId = searchParams.get("dayPlanId");

  const where: Record<string, unknown> = {};
  if (tripId) where.tripId = Number(tripId);
  if (cityId) where.cityId = Number(cityId);
  if (dayPlanId) where.dayPlanId = Number(dayPlanId);

  if (Object.keys(where).length === 0) {
    return NextResponse.json({ error: "Provide tripId, cityId, or dayPlanId" }, { status: 400 });
  }

  const notes = await prisma.tripNote.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(notes);
}

/** POST /api/notes — create a note */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { tripId, cityId, dayPlanId, content } = body;

  // Require exactly one scope
  const scopes = [tripId, cityId, dayPlanId].filter((v) => v != null);
  if (scopes.length === 0) {
    return NextResponse.json({ error: "Provide tripId, cityId, or dayPlanId" }, { status: 400 });
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
