import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** GET /api/users/:id — get a single user */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(user);
}

/** PATCH /api/users/:id — update name, color, or avatar */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  const body = await req.json();
  const data: Record<string, string> = {};

  if (typeof body.name === "string" && body.name.trim().length > 0) {
    data.name = body.name.trim();
  }
  if (typeof body.color === "string") {
    data.color = body.color;
  }
  if (typeof body.avatar === "string" || body.avatar === null) {
    data.avatar = body.avatar;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
  });

  return NextResponse.json(user);
}

/** DELETE /api/users/:id — delete a user (refuses if last remaining user) */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  const count = await prisma.user.count();
  if (count <= 1) {
    return NextResponse.json(
      { error: "Cannot delete the last user" },
      { status: 400 },
    );
  }

  await prisma.user.delete({ where: { id: userId } });
  return NextResponse.json({ success: true });
}
