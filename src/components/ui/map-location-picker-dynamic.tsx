"use client";

import dynamic from "next/dynamic";
import type { MapLocationPickerProps } from "./map-location-picker";

export type { MapLocationPickerProps };

const MapLocationPickerLazy = dynamic(
  () => import("./map-location-picker").then((m) => ({ default: m.MapLocationPicker })),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="w-full max-w-3xl h-[80vh] max-h-[600px] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-xl flex items-center justify-center">
          <div className="h-6 w-6 border-2 border-[hsl(var(--primary))] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    ),
  },
);

export function MapLocationPickerModal(props: MapLocationPickerProps) {
  return <MapLocationPickerLazy {...props} />;
}
