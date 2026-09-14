/**
 * POST /api/cities/[cityId]/generate-descriptions
 *
 * Triggers background LLM description generation for POIs in a city.
 * Called automatically after Discover completes (fire-and-forget from client).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";
import { generatePoiDescriptions } from "@/lib/poi-description-generator";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;
  const cityIdNum = Number(cityId);

  if (!await verifyCityOwnership(cityIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const city = await prisma.city.findUnique({
    where: { id: cityIdNum },
    select: { name: true, country: true },
  });
  if (!city) return NextResponse.json({ error: "City not found" }, { status: 404 });

  try {
    const result = await generatePoiDescriptions(cityIdNum, city.name, city.country ?? undefined);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[generate-descriptions]", msg, err);
    return NextResponse.json(
      { error: "Description generation failed", details: msg },
      { status: 500 },
    );
  }
}
