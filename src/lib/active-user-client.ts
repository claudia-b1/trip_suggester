/**
 * Client-side active user helpers.
 *
 * The session cookie is httpOnly and signed, so the browser can neither read nor
 * write it directly — these go through `/api/users/session`. The per-device
 * default user stays in localStorage, since it's only a convenience hint about
 * which user to pre-select and carries no authority.
 */

/**
 * Remove the pre-signing `active-user-id` cookie if it is still around.
 * Nothing reads it any more, but leaving a stale user id in the browser is
 * confusing when debugging.
 */
function dropLegacyCookie() {
  if (document.cookie.includes("active-user-id=")) {
    document.cookie = "active-user-id=;path=/;max-age=0;SameSite=Lax";
  }
}

/** Switch the active user. Resolves once the server has set the cookie. */
export async function setActiveUser(userId: number): Promise<boolean> {
  dropLegacyCookie();
  try {
    const res = await fetch("/api/users/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ask the server who the active user is. */
export async function getActiveUserId(): Promise<number | null> {
  try {
    const res = await fetch("/api/users/session");
    if (!res.ok) return null;
    const data = (await res.json()) as { userId?: number | null };
    return data.userId ?? null;
  } catch {
    return null;
  }
}

export async function clearActiveUser(): Promise<void> {
  try {
    await fetch("/api/users/session", { method: "DELETE" });
  } catch {
    // Signing out locally is best-effort; the cookie expires on its own.
  }
}

export function setDefaultUser(userId: number) {
  localStorage.setItem("default-user-id", String(userId));
}

export function getDefaultUserId(): number | null {
  const raw = localStorage.getItem("default-user-id");
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function clearDefaultUser() {
  localStorage.removeItem("default-user-id");
}
