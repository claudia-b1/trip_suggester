"use client";

import dynamic from "next/dynamic";
import type { PoiMapProps, DayPlanOption, RecommendationMarker } from "./poi-map-impl";

export type { DayPlanOption, RecommendationMarker };

const PoiMapDynamic = dynamic(
  () => import("./poi-map-impl").then((m) => ({ default: m.PoiMapImpl })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[clamp(340px,65vh,1100px)] animate-pulse rounded-md bg-[hsl(var(--muted))] border border-[hsl(var(--border))]" />
    ),
  },
);

export function PoiMap(props: PoiMapProps) {
  return <PoiMapDynamic {...props} />;
}