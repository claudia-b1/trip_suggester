/**
 * Active-user session.
 *
 * The cookie is httpOnly and signed, so it can only be read and written here —
 * the browser can no longer set a user id directly.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getActiveUserId } from "@/lib/active-user";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, serializeSession } from "@/lib/session";

/** GET — who is the active user? */
export async function GET() {
  const userId = await getActiveUserId();
  return NextResponse.json({ userId });
}

/** POST { userId } — switch the active user. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const userId = Number(body?.userId);

  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  // Only sign ids that actually exist, so a stale or made-up id can't be
  // minted into a valid-looking session.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, serializeSession(user.id), SESSION_COOKIE_OPTIONS);

  return NextResponse.json({ userId: user.id });
}

/** DELETE — sign out. */
export async function DELETE() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...SESSION_COOKIE_OPTIONS, maxAge: 0 });
  return new NextResponse(null, { status: 204 });
}
