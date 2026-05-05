"use client";

import dynamic from "next/dynamic";
import type { PoiMapProps, DayPlanOption } from "./poi-map-impl";

export type { DayPlanOption };

const PoiMapDynamic = dynamic(
  () => import("./poi-map-impl").then((m) => ({ default: m.PoiMapImpl })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[clamp(500px,70vh,825px)] animate-pulse rounded-md bg-gray-100 border border-[hsl(var(--border))]" />
    ),
  },
);

export function PoiMap(props: PoiMapProps) {
  return <PoiMapDynamic {...props} />;
}