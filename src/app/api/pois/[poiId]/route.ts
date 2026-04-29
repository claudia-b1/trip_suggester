import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ poiId: string }> },
) {
  const { poiId } = await params;
  await prisma.poi.delete({ where: { id: Number(poiId) } });
  return new NextResponse(null, { status: 204 });
}
