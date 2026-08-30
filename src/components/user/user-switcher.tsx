"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useUser } from "./user-provider";
import { UserManageModal } from "./user-manage-modal";

/** Small coloured circle with first letter or emoji avatar. */
function UserAvatar({
  user,
  size = "sm",
}: {
  user: { name: string; color: string; avatar: string | null };
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-6 w-6 text-xs" : "h-8 w-8 text-sm";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0 ${dim}`}
      style={{ backgroundColor: user.color }}
    >
      {user.avatar ?? user.name.charAt(0).toUpperCase()}
    </span>
  );
}

export function UserSwitcher() {
  const { activeUser, users, switchUser, loading } = useUser();
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  if (loading || !activeUser) return null;

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm font-medium transition-colors hover:bg-[hsl(var(--muted))]"
        >
          <UserAvatar user={activeUser} />
          <span className="max-w-[80px] truncate">{activeUser.name}</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] transition-transform ${open ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-1 shadow-lg">
            {users.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  switchUser(u.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-[hsl(var(--muted))] ${
                  u.id === activeUser.id
                    ? "bg-[hsl(var(--muted))] font-medium"
                    : ""
                }`}
              >
                <UserAvatar user={u} />
                <span className="truncate">{u.name}</span>
                {u.id === activeUser.id && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="ml-auto h-4 w-4 text-[hsl(var(--primary))]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}

            <div className="my-1 border-t border-[hsl(var(--border))]" />

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setManageOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Manage users
            </button>
          </div>
        )}
      </div>

      {manageOpen && createPortal(
        <UserManageModal onClose={() => setManageOpen(false)} />,
        document.body,
      )}
    </>
  );
}

export { UserAvatar };
