import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyPoiOwnership } from "@/lib/ownership";
import { updatePoiSchema, parseBody } from "@/lib/api-schemas";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ poiId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { poiId } = await params;
  const poiIdNum = Number(poiId);
  if (!await verifyPoiOwnership(poiIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await req.json();
  const parsed = parseBody(updatePoiSchema, raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const body = parsed.data;
  const data: Record<string, unknown> = {};

  // Copy all validated fields that were provided
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) data[key] = value;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Snapshot original discovered values before first user edit
  const SNAPSHOT_FIELDS = [
    "name", "category", "subcategory", "description", "website", "phoneNumber",
    "openingHours", "photoUrl", "priceLevel", "fee", "tips", "bestTimeToVisit",
    "estimatedDurationMinutes", "address", "notes",
  ] as const;

  const existing = await prisma.poi.findUniqueOrThrow({
    where: { id: poiIdNum },
    select: {
      originalData: true,
      ...Object.fromEntries(SNAPSHOT_FIELDS.map((f) => [f, true])),
    },
  });

  if (!existing.originalData) {
    // First edit — save current values as the original snapshot
    const snapshot: Record<string, unknown> = {};
    for (const f of SNAPSHOT_FIELDS) {
      snapshot[f] = (existing as Record<string, unknown>)[f] ?? null;
    }
    data.originalData = JSON.stringify(snapshot);
  }

  const updated = await prisma.poi.update({
    where: { id: poiIdNum },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ poiId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { poiId } = await params;
  const poiIdNum = Number(poiId);
  if (!await verifyPoiOwnership(poiIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // If this POI was auto-created from a favourite, record the dismissal
  // so the sync won't re-create it on subsequent page loads.
  const poi = await prisma.poi.findUnique({
    where: { id: poiIdNum },
    select: { favouriteItemId: true, cityId: true },
  });
  if (poi?.favouriteItemId) {
    await prisma.dismissedFavouriteCity.upsert({
      where: {
        favouriteItemId_cityId: {
          favouriteItemId: poi.favouriteItemId,
          cityId: poi.cityId,
        },
      },
      create: {
        favouriteItemId: poi.favouriteItemId,
        cityId: poi.cityId,
      },
      update: {},
    });
  }

  await prisma.poi.delete({ where: { id: poiIdNum } });
  return new NextResponse(null, { status: 204 });
}
