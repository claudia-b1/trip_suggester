"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useUser } from "@/components/user/user-provider";
import { useFavourites } from "@/components/favourites/favourites-provider";

// ── Icons (inline SVGs) ─────────────────────────────────────────────────────

function SunIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-[hsl(var(--muted-foreground))]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// ── Theme helpers (duplicated from theme-toggle to avoid coupling) ──────────

type Theme = "light" | "dark" | "system";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem("theme") as Theme) ?? "system";
}

function getSystemTheme() {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const resolved = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

// ── Bottom Sheet ────────────────────────────────────────────────────────────

function MobileMenuSheet({ onClose }: { onClose: () => void }) {
  const { activeUser, users, switchUser } = useUser();
  const { toggle: toggleFavourites } = useFavourites();
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [showUsers, setShowUsers] = useState(false);

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  function cycleTheme() {
    const order: Theme[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
  }

  const themeLabel = theme === "light" ? "Light mode" : theme === "dark" ? "Dark mode" : "System theme";
  const ThemeIcon = theme === "light" ? SunIcon : theme === "dark" ? MoonIcon : MonitorIcon;

  return createPortal(
    <div className="fixed inset-0 z-50 sm:hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      {/* Sheet */}
      <div className="sheet-enter absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-2xl">
        {/* Handle bar */}
        <div className="flex justify-center py-2.5">
          <div className="h-1 w-10 rounded-full bg-[hsl(var(--muted-foreground))]/30" />
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-2 pb-6 space-y-1">
          {/* User section */}
          {activeUser && (
            <>
              <button
                type="button"
                onClick={() => setShowUsers(!showUsers)}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-[hsl(var(--muted))]"
              >
                <span
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white shrink-0"
                  style={{ backgroundColor: activeUser.color }}
                >
                  {activeUser.avatar ?? activeUser.name.charAt(0).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{activeUser.name}</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">Switch user</div>
                </div>
                <ChevronRightIcon />
              </button>

              {/* Expandable user list */}
              {showUsers && (
                <div className="ml-4 space-y-0.5 py-1">
                  {users.filter((u) => u.id !== activeUser.id).map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        switchUser(u.id);
                        onClose();
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-sm transition-colors hover:bg-[hsl(var(--muted))]"
                    >
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white shrink-0"
                        style={{ backgroundColor: u.color }}
                      >
                        {u.avatar ?? u.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="truncate">{u.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="mx-4 border-t border-[hsl(var(--border))]" />

          {/* Theme toggle */}
          <button
            type="button"
            onClick={cycleTheme}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-[hsl(var(--muted))]"
          >
            <ThemeIcon />
            <span className="flex-1">{themeLabel}</span>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">Tap to cycle</span>
          </button>

          {/* Settings */}
          <Link
            href="/settings"
            onClick={onClose}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-[hsl(var(--muted))]"
          >
            <SettingsIcon />
            <span>Settings</span>
          </Link>

          {/* Favourites */}
          <button
            type="button"
            onClick={() => {
              onClose();
              // Small delay so sheet closes before panel opens
              setTimeout(() => toggleFavourites(), 150);
            }}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-[hsl(var(--muted))]"
          >
            <HeartIcon />
            <span>Favourites</span>
          </button>

          {/* New trip */}
          <Link
            href="/trips/new"
            onClick={onClose}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-[hsl(var(--primary))] font-medium transition-colors hover:bg-[hsl(var(--muted))]"
          >
            <PlusIcon />
            <span>New trip</span>
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Trigger Button ──────────────────────────────────────────────────────────

export function MobileMenuButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] transition-colors hover:bg-[hsl(var(--muted))] sm:hidden"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      {open && <MobileMenuSheet onClose={close} />}
    </>
  );
}
