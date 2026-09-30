import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyNoteOwnership } from "@/lib/ownership";

/** PATCH /api/notes/:id — update note content */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  if (!await verifyNoteOwnership(Number(id), userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const note = await prisma.tripNote.update({
    where: { id: Number(id) },
    data: { content: body.content },
  });

  return NextResponse.json(note);
}

/** DELETE /api/notes/:id */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  if (!await verifyNoteOwnership(Number(id), userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.tripNote.delete({ where: { id: Number(id) } });
  return new NextResponse(null, { status: 204 });
}
