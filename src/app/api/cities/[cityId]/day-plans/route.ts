import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET /api/cities/:cityId/day-plans — list day plans for a city */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const { cityId } = await params;
  const dayPlans = await prisma.dayPlan.findMany({
    where: { cityId: Number(cityId) },
    orderBy: { date: "asc" },
    select: { id: true, date: true },
  });
  return NextResponse.json(dayPlans);
}
