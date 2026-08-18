import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** PATCH /api/favourites/lists/reorder — update list ordering */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.orderedIds)) {
    return NextResponse.json({ error: "orderedIds array required" }, { status: 400 });
  }

  const { orderedIds } = body as { orderedIds: number[] };

  await Promise.all(
    orderedIds.map((id, index) =>
      prisma.favouriteList.update({
        where: { id },
        data: { order: index },
      }),
    ),
  );

  return NextResponse.json({ ok: true });
}
