/**
 * Server-side active user helper.
 * Reads and verifies the signed `active-user` cookie (see `session.ts`).
 */
import { cookies } from "next/headers";
import { SESSION_COOKIE, parseSession } from "@/lib/session";

export async function getActiveUserId(): Promise<number | null> {
  const cookieStore = await cookies();
  return parseSession(cookieStore.get(SESSION_COOKIE)?.value);
}
