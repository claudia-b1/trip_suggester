import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";

/** DELETE /api/cities/[cityId]/pois/bulk — delete all POIs for a city */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  const cityIdNum = Number(cityId);

  // Verify ownership
  const city = await prisma.city.findUnique({
    where: { id: cityIdNum },
    select: { trip: { select: { userId: true } } },
  });
  if (!city || city.trip.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Delete all POIs for this city (cascade deletes day activities)
  const result = await prisma.poi.deleteMany({ where: { cityId: cityIdNum } });
  return NextResponse.json({ deleted: result.count });
}
