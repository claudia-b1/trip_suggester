import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; cityId: string }> },
) {
  const { cityId } = await params;
  await prisma.city.delete({ where: { id: Number(cityId) } });
  return new NextResponse(null, { status: 204 });
}
