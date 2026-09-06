"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import {
  type DistanceUnit,
  type DateFormat,
  type MapStyle,
  SETTINGS_DEFAULTS as DEFAULTS,
} from "@/lib/use-settings";

function OptionButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
        selected
          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
          : "border-[hsl(var(--input))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
      }`}
    >
      {children}
    </button>
  );
}

export function SettingsForm() {
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(DEFAULTS.distanceUnit);
  const [dateFormat, setDateFormat] = useState<DateFormat>(DEFAULTS.dateFormat);
  const [mapStyle, setMapStyle] = useState<MapStyle>(DEFAULTS.mapStyle);
  const [discoverRadius, setDiscoverRadius] = useState(DEFAULTS.discoverRadius);
  const [nearbyRadius, setNearbyRadius] = useState(DEFAULTS.nearbyRadius);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = {
      distanceUnit: localStorage.getItem("pref-distance-unit") as DistanceUnit | null,
      dateFormat: localStorage.getItem("pref-date-format") as DateFormat | null,
      mapStyle: localStorage.getItem("pref-map-style") as MapStyle | null,
      discoverRadius: localStorage.getItem("pref-discover-radius"),
      nearbyRadius: localStorage.getItem("pref-nearby-radius"),
    };

    if (stored.distanceUnit) setDistanceUnit(stored.distanceUnit);
    if (stored.dateFormat) setDateFormat(stored.dateFormat);
    if (stored.mapStyle) setMapStyle(stored.mapStyle);
    if (stored.discoverRadius) setDiscoverRadius(Number(stored.discoverRadius));
    if (stored.nearbyRadius) setNearbyRadius(Number(stored.nearbyRadius));

    setMounted(true);
  }, []);

  function save(key: string, value: string) {
    localStorage.setItem(key, value);
    toast("Settings saved", { durationMs: 2000 });
  }

  function handleDistanceUnit(value: DistanceUnit) {
    setDistanceUnit(value);
    save("pref-distance-unit", value);
  }

  function handleDateFormat(value: DateFormat) {
    setDateFormat(value);
    save("pref-date-format", value);
  }

  function handleMapStyle(value: MapStyle) {
    setMapStyle(value);
    save("pref-map-style", value);
  }

  function handleDiscoverRadius(value: string) {
    const num = Number(value);
    if (isNaN(num) || num < 1) return;
    setDiscoverRadius(num);
    save("pref-discover-radius", String(num));
  }

  function handleNearbyRadius(value: string) {
    const num = Number(value);
    if (isNaN(num) || num < 1) return;
    setNearbyRadius(num);
    save("pref-nearby-radius", String(num));
  }

  // Avoid hydration mismatch — render nothing until mounted
  if (!mounted) {
    return (
      <div className="mx-auto max-w-[600px] space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Display Preferences</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48 animate-pulse rounded-lg bg-[hsl(var(--muted))]" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recommendation Defaults</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-24 animate-pulse rounded-lg bg-[hsl(var(--muted))]" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[600px] space-y-6">
      {/* Display Preferences */}
      <Card>
        <CardHeader>
          <CardTitle>Display Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Distance Unit */}
          <div className="space-y-2">
            <Label className="text-[hsl(var(--muted-foreground))]">Distance unit</Label>
            <div className="flex gap-2">
              <OptionButton
                selected={distanceUnit === "km"}
                onClick={() => handleDistanceUnit("km")}
              >
                Kilometres (km)
              </OptionButton>
              <OptionButton
                selected={distanceUnit === "miles"}
                onClick={() => handleDistanceUnit("miles")}
              >
                Miles
              </OptionButton>
            </div>
          </div>

          {/* Date Format */}
          <div className="space-y-2">
            <Label className="text-[hsl(var(--muted-foreground))]">Date format</Label>
            <div className="flex flex-wrap gap-2">
              {(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const).map((fmt) => (
                <OptionButton
                  key={fmt}
                  selected={dateFormat === fmt}
                  onClick={() => handleDateFormat(fmt)}
                >
                  {fmt}
                </OptionButton>
              ))}
            </div>
          </div>

          {/* Map Style */}
          <div className="space-y-2">
            <Label className="text-[hsl(var(--muted-foreground))]">Default map style</Label>
            <div className="flex flex-wrap gap-2">
              {(["Streets", "Satellite", "Navigation"] as const).map((style) => (
                <OptionButton
                  key={style}
                  selected={mapStyle === style}
                  onClick={() => handleMapStyle(style)}
                >
                  {style}
                </OptionButton>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recommendation Defaults */}
      <Card>
        <CardHeader>
          <CardTitle>Recommendation Defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Discover Radius */}
          <div className="space-y-2">
            <Label htmlFor="discover-radius" className="text-[hsl(var(--muted-foreground))]">
              Default discover radius
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="discover-radius"
                type="number"
                min={1}
                max={100}
                value={discoverRadius}
                onChange={(e) => handleDiscoverRadius(e.target.value)}
                className="w-24"
              />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">km</span>
            </div>
          </div>

          {/* Nearby Radius */}
          <div className="space-y-2">
            <Label htmlFor="nearby-radius" className="text-[hsl(var(--muted-foreground))]">
              Default nearby radius
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="nearby-radius"
                type="number"
                min={1}
                max={500}
                value={nearbyRadius}
                onChange={(e) => handleNearbyRadius(e.target.value)}
                className="w-24"
              />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">km</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
