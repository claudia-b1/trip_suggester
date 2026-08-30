import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET /api/users — list all users */
export async function GET() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(users);
}

/** POST /api/users — create a new user */
export async function POST(req: Request) {
  const { name, color, avatar } = await req.json();

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      ...(color && typeof color === "string" ? { color } : {}),
      ...(avatar && typeof avatar === "string" ? { avatar } : {}),
    },
  });

  return NextResponse.json(user, { status: 201 });
}
