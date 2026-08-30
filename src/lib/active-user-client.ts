/**
 * Client-side active user helpers.
 * Manages the active-user-id cookie and the per-device default user in localStorage.
 */

export function setActiveUser(userId: number) {
  document.cookie = `active-user-id=${userId};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
}

export function getActiveUserIdFromCookie(): number | null {
  const match = document.cookie.match(/(?:^|;\s*)active-user-id=(\d+)/);
  return match ? Number(match[1]) : null;
}

export function clearActiveUser() {
  document.cookie = "active-user-id=;path=/;max-age=0;SameSite=Lax";
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
