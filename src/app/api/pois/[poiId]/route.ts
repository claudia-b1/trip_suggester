import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const VALID_CATEGORIES = [
  "CULTURE", "FOOD", "NATURE", "ENTERTAINMENT",
  "NIGHTLIFE", "SHOPPING", "WELLNESS", "ACCOMMODATION",
];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ poiId: string }> },
) {
  const { poiId } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};
  if (typeof body.category === "string") {
    if (!VALID_CATEGORIES.includes(body.category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    data.category = body.category;
  }
  if (typeof body.subcategory === "string" || body.subcategory === null) {
    data.subcategory = body.subcategory;
  }
  if (typeof body.photoUrl === "string" || body.photoUrl === null) {
    data.photoUrl = body.photoUrl;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const updated = await prisma.poi.update({
    where: { id: Number(poiId) },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ poiId: string }> },
) {
  const { poiId } = await params;
  await prisma.poi.delete({ where: { id: Number(poiId) } });
  return new NextResponse(null, { status: 204 });
}
