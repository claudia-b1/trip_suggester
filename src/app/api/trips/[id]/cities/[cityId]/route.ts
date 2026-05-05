import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; cityId: string }> },
) {
  const { cityId } = await params;
  const cityIdNum = Number(cityId);
  if (!Number.isInteger(cityIdNum)) {
    return NextResponse.json({ error: "Invalid cityId" }, { status: 400 });
  }
  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (body.startDate) data.startDate = new Date(body.startDate);
  if (body.endDate) data.endDate = new Date(body.endDate);
  if (typeof body.country === "string") data.country = body.country;
  if (typeof body.countryCode === "string") data.countryCode = body.countryCode;
  if (typeof body.latitude === "number") data.latitude = body.latitude;
  if (typeof body.longitude === "number") data.longitude = body.longitude;
  if (typeof body.timezone === "string") data.timezone = body.timezone;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  const city = await prisma.city.update({ where: { id: cityIdNum }, data });
  return NextResponse.json(city);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; cityId: string }> },
) {
  const { cityId } = await params;
  await prisma.city.delete({ where: { id: Number(cityId) } });
  return new NextResponse(null, { status: 204 });
}
