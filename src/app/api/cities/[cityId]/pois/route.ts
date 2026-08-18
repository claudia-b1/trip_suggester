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
  const { name, category, subcategory, description, latitude, longitude, photoUrl, website, placeId } = await req.json();

  if (!isCategory(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const poi = await prisma.poi.create({
    data: {
      name,
      category,
      subcategory: typeof subcategory === "string" && subcategory.trim() ? subcategory.trim() : null,
      description: description || null,
      latitude: typeof latitude === "number" ? latitude : null,
      longitude: typeof longitude === "number" ? longitude : null,
      photoUrl: typeof photoUrl === "string" && photoUrl ? photoUrl : null,
      website: typeof website === "string" && website ? website : null,
      placeId: typeof placeId === "string" && placeId ? placeId : null,
      cityId: Number(cityId),
    },
  });
  return NextResponse.json(poi, { status: 201 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  const { cityId } = await params;
  const id = Number(cityId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid cityId" }, { status: 400 });
  }
  await prisma.poi.deleteMany({ where: { cityId: id } });
  return new NextResponse(null, { status: 204 });
}
