import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyAttachmentOwnership } from "@/lib/ownership";

/** GET /api/attachments/:id — download the attachment as binary */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const idNum = Number(id);

  const attachment = await prisma.attachment.findUnique({
    where: { id: idNum },
    select: { filename: true, mimeType: true, data: true },
  });

  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Parse data URI: data:<mimeType>;base64,<base64data>
  const base64Match = attachment.data.match(/^data:[^;]*;base64,(.+)$/);
  if (!base64Match) {
    return NextResponse.json({ error: "Invalid attachment data" }, { status: 500 });
  }

  const buffer = Buffer.from(base64Match[1], "base64");

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename="${attachment.filename.replace(/"/g, '\\"')}"`,
      "Content-Length": String(buffer.length),
    },
  });
}

/** DELETE /api/attachments/:id — remove an attachment */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { id } = await params;
  const idNum = Number(id);

  if (!await verifyAttachmentOwnership(idNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.attachment.delete({ where: { id: idNum } });
  return new NextResponse(null, { status: 204 });
}
