import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyPoiOwnership } from "@/lib/ownership";

const VALID_CATEGORIES = [
  "CULTURE", "FOOD", "NATURE", "ENTERTAINMENT",
  "NIGHTLIFE", "SHOPPING", "GROCERIES", "WELLNESS", "OUTDOORS", "ACCOMMODATION", "FUEL",
];

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

  const body = await req.json();

  const data: Record<string, unknown> = {};

  // String fields
  for (const field of ["name", "description", "website", "phoneNumber", "openingHours", "fee", "tips", "bestTimeToVisit", "subcategory"] as const) {
    if (typeof body[field] === "string" || body[field] === null) {
      data[field] = body[field];
    }
  }

  // Category with validation
  if (typeof body.category === "string") {
    if (!VALID_CATEGORIES.includes(body.category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    data.category = body.category;
  }

  // Photo URL (string or null)
  if (typeof body.photoUrl === "string" || body.photoUrl === null) {
    data.photoUrl = body.photoUrl;
  }

  // Number fields
  for (const field of ["priceLevel", "estimatedDurationMinutes"] as const) {
    if (typeof body[field] === "number" || body[field] === null) {
      data[field] = body[field];
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Snapshot original discovered values before first user edit
  const SNAPSHOT_FIELDS = [
    "name", "category", "subcategory", "description", "website", "phoneNumber",
    "openingHours", "photoUrl", "priceLevel", "fee", "tips", "bestTimeToVisit",
    "estimatedDurationMinutes",
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

  await prisma.poi.delete({ where: { id: poiIdNum } });
  return new NextResponse(null, { status: 204 });
}
