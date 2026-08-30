import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyPoiOwnership } from "@/lib/ownership";

/** POST /api/pois/[poiId]/reset — restore POI to its original discovered data */
export async function POST(
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

  const poi = await prisma.poi.findUniqueOrThrow({
    where: { id: poiIdNum },
    select: { originalData: true },
  });

  if (!poi.originalData) {
    return NextResponse.json({ error: "No original data saved — POI was never edited" }, { status: 400 });
  }

  const original = JSON.parse(poi.originalData) as Record<string, unknown>;

  // Restore all snapshotted fields and clear the originalData marker
  const updated = await prisma.poi.update({
    where: { id: poiIdNum },
    data: {
      ...original,
      originalData: null, // clear snapshot so future edits snapshot again
    },
  });

  return NextResponse.json(updated);
}
