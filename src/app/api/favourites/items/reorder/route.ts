import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";

/** PATCH /api/favourites/items/reorder — update item ordering within a list */
export async function PATCH(req: Request) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.orderedIds)) {
    return NextResponse.json({ error: "orderedIds array required" }, { status: 400 });
  }

  const { orderedIds } = body as { orderedIds: number[] };

  await Promise.all(
    orderedIds.map((id, index) =>
      prisma.favouriteItem.update({
        where: { id },
        data: { order: index },
      }),
    ),
  );

  return NextResponse.json({ ok: true });
}
