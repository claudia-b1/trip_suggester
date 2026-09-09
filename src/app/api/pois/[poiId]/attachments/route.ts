import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { verifyPoiOwnership } from "@/lib/ownership";
import { attachmentUploadSchema, parseBody } from "@/lib/api-schemas";

const MAX_ATTACHMENTS = 5;
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function POST(
  req: Request,
  { params }: { params: Promise<{ poiId: string }> },
) {
  const userId = await getActiveUserId();
  if (!userId) return NextResponse.json({ error: "No active user" }, { status: 401 });

  const { poiId } = await params;
  const poiIdNum = Number(poiId);
  if (!await verifyPoiOwnership(poiIdNum, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  if (!raw) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const parsed = parseBody(attachmentUploadSchema, raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Check attachment count
  const count = await prisma.attachment.count({ where: { poiId: poiIdNum } });
  if (count >= MAX_ATTACHMENTS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_ATTACHMENTS} attachments allowed` },
      { status: 400 },
    );
  }

  // Decode data URI and check size
  const { filename, mimeType, data } = parsed.data;
  const base64Match = data.match(/^data:[^;]*;base64,(.+)$/);
  const rawBytes = base64Match
    ? Buffer.from(base64Match[1], "base64").length
    : Buffer.from(data).length;

  if (rawBytes > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_SIZE_BYTES / 1024 / 1024}MB)` },
      { status: 400 },
    );
  }

  const attachment = await prisma.attachment.create({
    data: {
      filename,
      mimeType,
      sizeBytes: rawBytes,
      data,
      poiId: poiIdNum,
    },
    select: { id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true },
  });

  return NextResponse.json(attachment, { status: 201 });
}
