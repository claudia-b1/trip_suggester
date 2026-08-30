import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyCityOwnership } from "@/lib/ownership";

/** GET /api/cities/:cityId/day-plans — list day plans for a city */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { cityId } = await params;

  if (!await verifyCityOwnership(Number(cityId), userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const dayPlans = await prisma.dayPlan.findMany({
    where: { cityId: Number(cityId) },
    orderBy: { date: "asc" },
    select: { id: true, date: true },
  });
  return NextResponse.json(dayPlans);
}
