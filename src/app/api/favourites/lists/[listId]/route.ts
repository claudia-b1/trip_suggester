import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** PATCH /api/favourites/lists/:listId — rename a list */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const { listId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const updated = await prisma.favouriteList.update({
    where: { id: Number(listId) },
    data: { name: body.name.trim() },
  });

  return NextResponse.json(updated);
}

/** DELETE /api/favourites/lists/:listId — cascade delete */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const { listId } = await params;
  await prisma.favouriteList.delete({ where: { id: Number(listId) } });
  return new NextResponse(null, { status: 204 });
}
