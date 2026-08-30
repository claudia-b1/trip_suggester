/**
 * Server-side active user helper.
 * Reads the active user ID from the `active-user-id` cookie.
 */
import { cookies } from "next/headers";

export async function getActiveUserId(): Promise<number | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get("active-user-id")?.value;
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
