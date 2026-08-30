import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";

/** PATCH /api/favourites/items/batch — bulk update (e.g. move to list) */
export async function PATCH(req: Request) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.ids) || !body.data) {
    return NextResponse.json(
      { error: "ids array and data object required" },
      { status: 400 },
    );
  }

  const { ids, data } = body as { ids: number[]; data: { listId?: number } };

  if (typeof data.listId === "number") {
    // Verify target list exists and belongs to the active user
    const list = await prisma.favouriteList.findUnique({
      where: { id: data.listId },
    });
    if (!list || list.userId !== userId) {
      return NextResponse.json({ error: "Target list not found" }, { status: 404 });
    }
  }

  await prisma.favouriteItem.updateMany({
    where: { id: { in: ids } },
    data: data,
  });

  return NextResponse.json({ updated: ids.length });
}

/** DELETE /api/favourites/items/batch — bulk delete */
export async function DELETE(req: Request) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.ids)) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }

  const { ids } = body as { ids: number[] };

  await prisma.favouriteItem.deleteMany({
    where: { id: { in: ids } },
  });

  return new NextResponse(null, { status: 204 });
}
