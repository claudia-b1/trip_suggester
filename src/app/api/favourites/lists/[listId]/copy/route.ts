import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyListOwnership } from "@/lib/ownership";

/**
 * POST /api/favourites/lists/:listId/copy — clone a favourite list to another user.
 * Body: { targetUserId: number }
 *
 * Clones: FavouriteList → sublists → FavouriteItems
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ listId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { listId } = await params;
  const listIdNum = Number(listId);
  if (!await verifyListOwnership(listIdNum, userId)) {
    return NextResponse.json({ error: "List not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.targetUserId !== "number") {
    return NextResponse.json({ error: "targetUserId is required" }, { status: 400 });
  }
  const { targetUserId } = body;

  // Verify target user exists
  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) {
    return NextResponse.json({ error: "Target user not found" }, { status: 404 });
  }

  // Load the full list tree
  const list = await prisma.favouriteList.findUnique({
    where: { id: listIdNum },
    include: {
      items: true,
      sublists: {
        include: { items: true },
      },
    },
  });

  if (!list) {
    return NextResponse.json({ error: "List not found" }, { status: 404 });
  }

  // Clone in a transaction
  const cloned = await prisma.$transaction(async (tx) => {
    // 1. Clone the parent list
    const newList = await tx.favouriteList.create({
      data: {
        name: `${list.name} (copy)`,
        order: list.order,
        userId: targetUserId,
      },
    });

    // 2. Clone items in the parent list
    for (const item of list.items) {
      await tx.favouriteItem.create({
        data: {
          name: item.name,
          category: item.category,
          subcategory: item.subcategory,
          country: item.country,
          city: item.city,
          address: item.address,
          latitude: item.latitude,
          longitude: item.longitude,
          description: item.description,
          notes: item.notes,
          photoUrl: item.photoUrl,
          website: item.website,
          sourcePlaceId: item.sourcePlaceId,
          visited: item.visited,
          personalRating: item.personalRating,
          extraFields: item.extraFields ?? undefined,
          order: item.order,
          listId: newList.id,
        },
      });
    }

    // 3. Clone sublists + their items
    for (const sublist of list.sublists) {
      const newSublist = await tx.favouriteList.create({
        data: {
          name: sublist.name,
          order: sublist.order,
          parentId: newList.id,
          userId: targetUserId,
        },
      });

      for (const item of sublist.items) {
        await tx.favouriteItem.create({
          data: {
            name: item.name,
            category: item.category,
            subcategory: item.subcategory,
            country: item.country,
            city: item.city,
            address: item.address,
            latitude: item.latitude,
            longitude: item.longitude,
            description: item.description,
            notes: item.notes,
            photoUrl: item.photoUrl,
            website: item.website,
            sourcePlaceId: item.sourcePlaceId,
            visited: item.visited,
            personalRating: item.personalRating,
            extraFields: item.extraFields ?? undefined,
            order: item.order,
            listId: newSublist.id,
          },
        });
      }
    }

    return newList;
  });

  return NextResponse.json(cloned, { status: 201 });
}
