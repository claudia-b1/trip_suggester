"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { CityAutocomplete, type CityDetails } from "@/components/ui/city-autocomplete";

/** Add days to a YYYY-MM-DD string (timezone-safe). */
function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export type AddSubDestinationModalProps = {
  tripId: number;
  parentCityId: number;
  parentCityName: string;
  parentStartDate: string; // ISO
  parentEndDate: string;   // ISO
  onClose: () => void;
};

export function AddSubDestinationModal({
  tripId,
  parentCityId,
  parentCityName,
  parentStartDate,
  parentEndDate,
  onClose,
}: AddSubDestinationModalProps) {
  const router = useRouter();
  const { toast } = useToast();

  // Form state
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [showNickname, setShowNickname] = useState(false);
  const [cityMeta, setCityMeta] = useState<CityDetails | null>(null);

  // Dates — clamp to parent range
  const minDate = parentStartDate.slice(0, 10);
  const maxDate = parentEndDate.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const defaultStart = today > minDate ? (today > maxDate ? maxDate : today) : minDate;
  const defaultEnd = (() => {
    const computed = addDaysToDate(defaultStart, 1);
    return computed > maxDate ? maxDate : computed;
  })();

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);

  // Generation options
  const [genAbout, setGenAbout] = useState(true);
  const [genRecommendations, setGenRecommendations] = useState(true);
  const [genMustDo, setGenMustDo] = useState(true);
  const [genNearbyCities, setGenNearbyCities] = useState(true);
  const [genNearbyActivities, setGenNearbyActivities] = useState(true);
  const [maxCitiesKm, setMaxCitiesKm] = useState(150);
  const [maxActivitiesKm, setMaxActivitiesKm] = useState(50);

  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/cities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          ...(nickname.trim() && { nickname: nickname.trim() }),
          startDate,
          endDate: endDate || startDate,
          parentCityId,
          ...(cityMeta && {
            country: cityMeta.country,
            countryCode: cityMeta.countryCode,
            latitude: cityMeta.latitude,
            longitude: cityMeta.longitude,
            timezone: cityMeta.timezone,
          }),
        }),
      });

      if (!res.ok) {
        toast("Failed to add sub-destination", { variant: "error" });
        setSubmitting(false);
        return;
      }

      const newCity = await res.json();
      const newCityId = newCity.id;
      setSubmitting(false);

      // Background generation
      if (genAbout) {
        setGenerating("about");
        try {
          await fetch(`/api/cities/${newCityId}/city-info`, { method: "POST" });
        } catch { /* non-critical */ }
      }

      if (genRecommendations && (genMustDo || genNearbyCities || genNearbyActivities)) {
        setGenerating("recommendations");
        try {
          await fetch(`/api/cities/${newCityId}/activities`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              includeMustDo: genMustDo,
              includeNearbyCities: genNearbyCities,
              includeNearbyActivities: genNearbyActivities,
              maxNearbyCitiesKm: maxCitiesKm,
              maxNearbyActivitiesKm: maxActivitiesKm,
            }),
          });
        } catch { /* non-critical */ }
      }

      setGenerating(null);
      router.refresh();
      toast(`Added ${newCity.nickname || newCity.name} as sub-destination`);
      onClose();
    } catch {
      toast("Failed to add sub-destination", { variant: "error" });
      setSubmitting(false);
      setGenerating(null);
    }
  }

  const busy = submitting || !!generating;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="relative mx-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold">Add sub-destination</h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Under {parentCityName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Location */}
          <div className="space-y-2">
            <Label htmlFor="sub-city-name">Location</Label>
            <CityAutocomplete
              id="sub-city-name"
              value={name}
              onChange={setName}
              onSelect={(d) => { setName(d.name); setCityMeta(d); }}
              placeholder="Search destinations..."
              required
            />
            {cityMeta && (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {[cityMeta.country, cityMeta.timezone].filter(Boolean).join(" · ")}
              </p>
            )}
            {cityMeta && !showNickname && (
              <button
                type="button"
                className="text-xs text-[hsl(var(--primary))] hover:underline"
                onClick={() => setShowNickname(true)}
              >
                + Set display name
              </button>
            )}
            {showNickname && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="sub-city-nickname" className="text-xs whitespace-nowrap">Display name</Label>
                  <button
                    type="button"
                    className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    onClick={() => { setShowNickname(false); setNickname(""); }}
                  >
                    ✕
                  </button>
                </div>
                <Input
                  id="sub-city-nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder={`e.g. "Amalfi Coast" instead of "${name}"`}
                  className="text-sm"
                />
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="grid gap-4 grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sub-city-start">Start</Label>
              <Input
                id="sub-city-start"
                type="date"
                value={startDate}
                min={minDate}
                max={maxDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (endDate && endDate < e.target.value) {
                    setEndDate(e.target.value);
                  }
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-city-end">End</Label>
              <Input
                id="sub-city-end"
                type="date"
                value={endDate}
                min={startDate || minDate}
                max={maxDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Generate on creation */}
          <div className="space-y-2 rounded-lg border border-[hsl(var(--border))] p-3 bg-[hsl(var(--muted))]/30">
            <p className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Generate on creation</p>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={genAbout} onChange={(e) => setGenAbout(e.target.checked)} className="rounded" />
              About destination (AI-generated insights)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={genRecommendations} onChange={(e) => setGenRecommendations(e.target.checked)} className="rounded" />
              General recommendations
            </label>
            {genRecommendations && (
              <div className="ml-6 space-y-1.5">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={genMustDo} onChange={(e) => setGenMustDo(e.target.checked)} className="rounded h-3.5 w-3.5" />
                  Must-do activities
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={genNearbyCities} onChange={(e) => setGenNearbyCities(e.target.checked)} className="rounded h-3.5 w-3.5" />
                  Nearby cities
                  <Input type="number" value={maxCitiesKm} onChange={(e) => setMaxCitiesKm(Number(e.target.value))} className="w-14 h-5 text-[10px] px-1" />
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]">km max</span>
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={genNearbyActivities} onChange={(e) => setGenNearbyActivities(e.target.checked)} className="rounded h-3.5 w-3.5" />
                  Recommended activities nearby
                  <Input type="number" value={maxActivitiesKm} onChange={(e) => setMaxActivitiesKm(Number(e.target.value))} className="w-14 h-5 text-[10px] px-1" />
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]">km max</span>
                </label>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>
              {submitting ? "Adding..." : generating ? `Generating ${generating}...` : "Add sub-destination"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
