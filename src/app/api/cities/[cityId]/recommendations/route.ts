import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  GENERATORS,
  isRecommendableCategory,
  type RecommendableCategory,
  type RecommendedPoi,
} from "@/lib/recommendations";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ cityId: string }> },
) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set" },
      { status: 503 },
    );
  }

  const { cityId } = await params;
  const cityIdNum = Number(cityId);

  const body = await req.json().catch(() => null);
  const rawCategories = (body && (body as { categories?: unknown }).categories) ?? [];
  if (!Array.isArray(rawCategories)) {
    return NextResponse.json(
      { error: "categories must be an array" },
      { status: 400 },
    );
  }

  const categories: RecommendableCategory[] = [];
  for (const c of rawCategories) {
    if (isRecommendableCategory(c) && !categories.includes(c)) {
      categories.push(c);
    }
  }
  if (categories.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one category" },
      { status: 400 },
    );
  }

  const city = await prisma.city.findUnique({ where: { id: cityIdNum } });
  if (!city) {
    return NextResponse.json({ error: "City not found" }, { status: 404 });
  }

  // Fan out to category modules in parallel. Each module is independent —
  // one failing doesn't kill the others.
  const settled = await Promise.allSettled(
    categories.map((c) => GENERATORS[c]({ cityName: city.name })),
  );

  const merged: RecommendedPoi[] = [];
  const failures: { category: RecommendableCategory; error: string }[] = [];
  settled.forEach((res, i) => {
    if (res.status === "fulfilled") {
      merged.push(...res.value);
    } else {
      failures.push({
        category: categories[i],
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
    }
  });

  const created = await prisma.$transaction(
    merged.map((p) =>
      prisma.poi.create({
        data: {
          name: p.name,
          category: p.category,
          description: p.description,
          latitude: p.latitude,
          longitude: p.longitude,
          cityId: cityIdNum,
        },
      }),
    ),
  );

  return NextResponse.json(
    { created: created.length, failures },
    { status: failures.length === 0 ? 201 : 207 },
  );
}
