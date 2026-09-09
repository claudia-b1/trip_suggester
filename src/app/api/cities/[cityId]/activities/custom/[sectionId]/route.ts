import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";
import type { ActivityRecommendationsResult } from "@/lib/activity-recommendations";

/** DELETE /api/cities/[cityId]/activities/custom/[sectionId] — remove a custom section */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ cityId: string; sectionId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId, sectionId } = await params;
  const cityIdNum = Number(cityId);
  if (!Number.isInteger(cityIdNum)) {
    return NextResponse.json({ error: "Invalid cityId" }, { status: 400 });
  }

  if (!await verifyCityOwnership(cityIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const cached = await prisma.cityInfoCache.findFirst({
    where: { cityId: cityIdNum, type: "activities" },
  });

  if (!cached) {
    return NextResponse.json({ deleted: true });
  }

  try {
    const data: ActivityRecommendationsResult = JSON.parse(cached.data);
    data.customSections = (data.customSections ?? []).filter((s) => s.id !== sectionId);

    await prisma.cityInfoCache.update({
      where: { cityId_type: { cityId: cityIdNum, type: "activities" } },
      data: { data: JSON.stringify(data), generatedAt: new Date() },
    });
  } catch {
    // Cache data was corrupt — just delete it
  }

  return NextResponse.json({ deleted: true });
}
