import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyDiscoverProfileOwnership } from "@/lib/ownership";
import { updateDiscoverProfileSchema, parseBody } from "@/lib/api-schemas";

/** Parse JSON string fields from DB row. */
function parseProfile(row: {
  id: number;
  name: string;
  categories: string;
  counts: string;
  subcats: string;
  isDefault: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    categories: JSON.parse(row.categories) as string[],
    counts: JSON.parse(row.counts) as Record<string, number>,
    subcats: JSON.parse(row.subcats) as Record<string, string[]>,
    isDefault: row.isDefault,
    order: row.order,
    createdAt: row.createdAt.toISOString(),
  };
}

/** PATCH /api/discover-profiles/:id — update a profile */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  const idNum = Number(id);
  if (!await verifyDiscoverProfileOwnership(idNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  if (!raw) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const parsed = parseBody(updateDiscoverProfileSchema, raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const body = parsed.data;
    const data: Record<string, unknown> = {};

    if (body.name !== undefined) data.name = body.name;
    if (body.categories !== undefined) data.categories = JSON.stringify(body.categories);
    if (body.counts !== undefined) data.counts = JSON.stringify(body.counts);
    if (body.subcats !== undefined) data.subcats = JSON.stringify(body.subcats);

    // Handle default toggling atomically
    if (body.isDefault !== undefined) {
      if (body.isDefault) {
        await prisma.discoverProfile.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      data.isDefault = body.isDefault;
    }

    const row = await prisma.discoverProfile.update({
      where: { id: idNum },
      data,
    });

    return NextResponse.json(parseProfile(row));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("PATCH /api/discover-profiles/:id error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/discover-profiles/:id — remove a profile */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  const idNum = Number(id);
  if (!await verifyDiscoverProfileOwnership(idNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await prisma.discoverProfile.delete({ where: { id: idNum } });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("DELETE /api/discover-profiles/:id error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
