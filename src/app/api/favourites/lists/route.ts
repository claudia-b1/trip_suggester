import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";

/** GET /api/favourites/lists — all top-level lists with sublists and item counts */
export async function GET() {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const lists = await prisma.favouriteList.findMany({
    where: { parentId: null, userId },
    orderBy: { order: "asc" },
    include: {
      sublists: {
        orderBy: { order: "asc" },
        include: {
          _count: { select: { items: true } },
          items: { orderBy: [{ order: "asc" }, { createdAt: "desc" }] },
        },
      },
      _count: { select: { items: true } },
      items: { orderBy: [{ order: "asc" }, { createdAt: "desc" }] },
    },
  });
  return NextResponse.json(lists);
}

/** POST /api/favourites/lists — create a list or sublist */
export async function POST(req: Request) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { name, parentId } = body;

  // Enforce one-level depth: parentId must be a root list (parentId === null)
  if (typeof parentId === "number") {
    const parent = await prisma.favouriteList.findUnique({
      where: { id: parentId },
      select: { parentId: true, userId: true },
    });
    if (!parent || parent.userId !== userId) {
      return NextResponse.json({ error: "Parent list not found" }, { status: 404 });
    }
    if (parent.parentId !== null) {
      return NextResponse.json(
        { error: "Sublists cannot have their own sublists (one level deep)" },
        { status: 400 },
      );
    }
  }

  // Next order value
  const last = await prisma.favouriteList.findFirst({
    where: { parentId: parentId ?? null, userId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const list = await prisma.favouriteList.create({
    data: {
      name: name.trim(),
      parentId: parentId ?? null,
      order: last ? last.order + 1 : 0,
      userId,
    },
  });

  return NextResponse.json(list, { status: 201 });
}
