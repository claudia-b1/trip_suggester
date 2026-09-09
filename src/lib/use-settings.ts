"use client";

import { useEffect, useState } from "react";

export type DistanceUnit = "km" | "miles";
export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
export type MapStyle = "Streets" | "Satellite" | "Navigation";

export const SETTINGS_DEFAULTS = {
  distanceUnit: "km" as DistanceUnit,
  dateFormat: "DD/MM/YYYY" as DateFormat,
  mapStyle: "Streets" as MapStyle,
  discoverRadius: 5,
  nearbyRadius: 30,
};

export type Settings = typeof SETTINGS_DEFAULTS;

const KEYS = {
  distanceUnit: "pref-distance-unit",
  dateFormat: "pref-date-format",
  mapStyle: "pref-map-style",
  discoverRadius: "pref-discover-radius",
  nearbyRadius: "pref-nearby-radius",
} as const;

/** Read a single setting from localStorage (non-reactive, for one-off reads). */
export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  if (typeof window === "undefined") return SETTINGS_DEFAULTS[key];
  const raw = localStorage.getItem(KEYS[key]);
  if (raw == null) return SETTINGS_DEFAULTS[key];
  if (key === "discoverRadius" || key === "nearbyRadius") {
    const n = Number(raw);
    return (isNaN(n) ? SETTINGS_DEFAULTS[key] : n) as Settings[K];
  }
  return raw as Settings[K];
}

/** React hook — returns all settings, re-reads on mount. */
export function useSettings(): Settings & { mounted: boolean } {
  const [mounted, setMounted] = useState(false);
  const [settings, setSettings] = useState<Settings>(SETTINGS_DEFAULTS);

  useEffect(() => {
    setSettings({
      distanceUnit: getSetting("distanceUnit"),
      dateFormat: getSetting("dateFormat"),
      mapStyle: getSetting("mapStyle"),
      discoverRadius: getSetting("discoverRadius"),
      nearbyRadius: getSetting("nearbyRadius"),
    });
    setMounted(true);
  }, []);

  return { ...settings, mounted };
}

/** Format a distance value using the user's preferred unit. */
export function formatDistance(km: number, unit?: DistanceUnit): string {
  const u = unit ?? getSetting("distanceUnit");
  if (u === "miles") {
    const mi = km * 0.621371;
    return mi < 0.1 ? "< 0.1 mi" : `${mi.toFixed(1)} mi`;
  }
  return km < 0.1 ? "< 0.1 km" : `${km.toFixed(1)} km`;
}

/** Format a date using the user's preferred format. */
export function formatDate(date: Date | string, fmt?: DateFormat): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const f = fmt ?? getSetting("dateFormat");
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  switch (f) {
    case "DD/MM/YYYY": return `${dd}/${mm}/${yyyy}`;
    case "MM/DD/YYYY": return `${mm}/${dd}/${yyyy}`;
    case "YYYY-MM-DD": return `${yyyy}-${mm}-${dd}`;
  }
}
