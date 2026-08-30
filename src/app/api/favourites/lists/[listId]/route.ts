import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyListOwnership } from "@/lib/ownership";

/** PATCH /api/favourites/lists/:listId — rename a list */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { listId } = await params;
  const listIdNum = Number(listId);
  if (!await verifyListOwnership(listIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const updated = await prisma.favouriteList.update({
    where: { id: listIdNum },
    data: { name: body.name.trim() },
  });

  return NextResponse.json(updated);
}

/** DELETE /api/favourites/lists/:listId — cascade delete */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { listId } = await params;
  const listIdNum = Number(listId);
  if (!await verifyListOwnership(listIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.favouriteList.delete({ where: { id: listIdNum } });
  return new NextResponse(null, { status: 204 });
}
