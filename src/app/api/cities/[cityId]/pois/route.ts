import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isCategory } from "@/lib/categories";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const { cityId } = await params;
  const pois = await prisma.poi.findMany({
    where: { cityId: Number(cityId) },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(pois);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const { cityId } = await params;
  const { name, category, description } = await req.json();

  if (!isCategory(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const poi = await prisma.poi.create({
    data: {
      name,
      category,
      description: description || null,
      cityId: Number(cityId),
    },
  });
  return NextResponse.json(poi, { status: 201 });
}
