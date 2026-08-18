import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** PATCH /api/notes/:id — update note content */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
  const { id } = await params;
  await prisma.tripNote.delete({ where: { id: Number(id) } });
  return new NextResponse(null, { status: 204 });
}
