import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyTripOwnership } from "@/lib/ownership";
import { reorderCitiesSchema, parseBody } from "@/lib/api-schemas";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) {
    return NextResponse.json({ error: "No active user" }, { status: 401 });
  }

  const { id } = await params;
  const tripId = Number(id);
  if (!Number.isInteger(tripId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  if (!(await verifyTripOwnership(tripId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await req.json();
  const parsed = parseBody(reorderCitiesSchema, raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { cityIds } = parsed.data;

  // Verify all cities belong to this trip and are top-level (no parentCityId)
  const cities = await prisma.city.findMany({
    where: { tripId, parentCityId: null },
    select: { id: true },
  });
  const validIds = new Set(cities.map((c) => c.id));
  for (const cid of cityIds) {
    if (!validIds.has(cid)) {
      return NextResponse.json(
        { error: `City ${cid} does not belong to this trip or is a subcity` },
        { status: 400 },
      );
    }
  }

  // Update each city's order based on its position in the array
  await prisma.$transaction(
    cityIds.map((cid: number, index: number) =>
      prisma.city.update({ where: { id: cid }, data: { order: index } }),
    ),
  );

  return NextResponse.json({ ok: true });
}
