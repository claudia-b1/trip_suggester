import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { createDiscoverProfileSchema, parseBody } from "@/lib/api-schemas";

/** Parse JSON string fields from DB row into structured objects. */
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

/** GET /api/discover-profiles — list all profiles for the active user */
export async function GET() {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  try {
    const rows = await prisma.discoverProfile.findMany({
      where: { userId },
      orderBy: { order: "asc" },
    });
    return NextResponse.json(rows.map(parseProfile));
  } catch (err) {
    console.error("GET /api/discover-profiles error:", err);
    return NextResponse.json({ error: "Failed to load profiles" }, { status: 500 });
  }
}

/** POST /api/discover-profiles — create a new profile */
export async function POST(req: Request) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const raw = await req.json().catch(() => null);
  if (!raw) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const parsed = parseBody(createDiscoverProfileSchema, raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { name, categories, counts, subcats, isDefault } = parsed.data;

  try {
    // If setting as default, clear existing default
    if (isDefault) {
      await prisma.discoverProfile.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    // Next order value
    const last = await prisma.discoverProfile.findFirst({
      where: { userId },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const row = await prisma.discoverProfile.create({
      data: {
        name,
        categories: JSON.stringify(categories),
        counts: JSON.stringify(counts),
        subcats: JSON.stringify(subcats),
        isDefault: isDefault ?? false,
        order: last ? last.order + 1 : 0,
        userId,
      },
    });

    return NextResponse.json(parseProfile(row), { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("POST /api/discover-profiles error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
