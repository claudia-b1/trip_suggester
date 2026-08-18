import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET /api/favourites/items/by-city?city=Rome&country=Italy — auto-include lookup */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const city = url.searchParams.get("city");
  if (!city) {
    return NextResponse.json({ error: "city param is required" }, { status: 400 });
  }

  const country = url.searchParams.get("country");

  const items = await prisma.favouriteItem.findMany({
    where: {
      city: { equals: city, mode: "insensitive" },
      ...(country ? { country: { equals: country, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(items);
}
