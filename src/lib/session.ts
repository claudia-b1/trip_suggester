/**
 * Signed active-user cookie.
 *
 * The active user used to be a plain `active-user-id=3` cookie written by the
 * browser, so anyone could type another id into devtools and read or write that
 * user's trips. Every ownership check in `ownership.ts` was verifying against a
 * value the client fully controlled.
 *
 * The cookie is now `<id>.<hmac>`, set server-side and httpOnly, so the id can't
 * be forged or edited from the page. This is not real authentication — there is
 * no password and anyone who can reach the server can still create a user — it
 * closes the "trivially impersonate another user" hole, which is the part that
 * matters for a small shared deployment.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "active-user";

/**
 * Signing key. `AUTH_SECRET` is preferred; without it we derive a stable key
 * from `DATABASE_URL`, which is server-only and always present for the app to
 * run at all. That keeps existing deployments working without new config while
 * still being unguessable — failing closed here would take the whole app down.
 */
function secret(): string {
  const explicit = process.env.AUTH_SECRET;
  if (explicit) return explicit;

  const fallback = process.env.DATABASE_URL;
  if (!fallback) {
    throw new Error("Cannot sign session: set AUTH_SECRET (or DATABASE_URL).");
  }
  return `derived:${fallback}`;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** Build the cookie value for a user id. */
export function serializeSession(userId: number): string {
  return `${userId}.${sign(String(userId))}`;
}

/** Recover a user id from a cookie value, or null if it is missing or forged. */
export function parseSession(raw: string | undefined): number | null {
  if (!raw) return null;

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;

  const idPart = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);

  const id = Number(idPart);
  if (!Number.isInteger(id) || id <= 0) return null;

  const expected = sign(idPart);
  // Both are base64url of a SHA-256 digest, so lengths match unless tampered.
  if (signature.length !== expected.length) return null;

  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  return id;
}

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  secure: process.env.NODE_ENV === "production",
};
