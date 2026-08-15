"use client";

import dynamic from "next/dynamic";
import type { TripMapProps } from "./trip-map-impl";

export type { TripMapProps };

const TripMapDynamic = dynamic(
  () => import("./trip-map-impl").then((m) => ({ default: m.TripMapImpl })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full min-h-[240px] animate-pulse rounded-xl bg-[hsl(var(--muted))] border border-[hsl(var(--border))]" />
    ),
  },
);

export function TripMap(props: TripMapProps) {
  return <TripMapDynamic {...props} />;
}
