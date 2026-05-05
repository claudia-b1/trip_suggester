"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

function getSystemTheme() {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const resolved = theme === "system" ? getSystemTheme() : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    const t = stored ?? "system";
    setTheme(t);
    applyTheme(t);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => { if (theme === "system") applyTheme("system"); };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  function cycle() {
    const order: Theme[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
    localStorage.setItem("theme", next);
    applyTheme(next);
  }

  const icons: Record<Theme, string> = { light: "☀️", dark: "🌙", system: "💻" };

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${theme}`}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm transition-colors hover:bg-[hsl(var(--muted))]"
    >
      {icons[theme]}
    </button>
  );
}
