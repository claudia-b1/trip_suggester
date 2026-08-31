"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { CityAutocomplete, type CityDetails } from "@/components/ui/city-autocomplete";

function toInputDate(iso: string) {
  return iso.slice(0, 10);
}

export function EditCityButton({
  tripId,
  city,
  tripStartDate,
  tripEndDate,
}: {
  tripId: number;
  city: { id: number; name: string; nickname: string | null; startDate: string; endDate: string };
  tripStartDate: string;
  tripEndDate: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(city.name);
  const [nickname, setNickname] = useState(city.nickname ?? "");
  const [startDate, setStartDate] = useState(toInputDate(city.startDate));
  const [endDate, setEndDate] = useState(toInputDate(city.endDate));
  const [saving, setSaving] = useState(false);
  const [cityMeta, setCityMeta] = useState<CityDetails | null>(null);

  // Location change dialog state
  const [showLocationChangeDialog, setShowLocationChangeDialog] = useState(false);
  const [deletingPois, setDeletingPois] = useState(false);
  const [poisDeleted, setPoisDeleted] = useState(false);
  const [clearingRecs, setClearingRecs] = useState(false);
  const [recsCleared, setRecsCleared] = useState(false);

  function onCancel() {
    setName(city.name);
    setNickname(city.nickname ?? "");
    setStartDate(toInputDate(city.startDate));
    setEndDate(toInputDate(city.endDate));
    setCityMeta(null);
    setShowLocationChangeDialog(false);
    setPoisDeleted(false);
    setRecsCleared(false);
    setOpen(false);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (new Date(endDate) < new Date(startDate)) {
      toast("End date must be on or after start date", { variant: "error" });
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/trips/${tripId}/cities/${city.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        nickname: nickname.trim() || "",
        startDate,
        endDate,
        ...(cityMeta && {
          country: cityMeta.country,
          countryCode: cityMeta.countryCode,
          latitude: cityMeta.latitude,
          longitude: cityMeta.longitude,
          timezone: cityMeta.timezone,
        }),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      toast("Failed to update destination", { variant: "error" });
      return;
    }
    if (cityMeta) {
      setShowLocationChangeDialog(true);
    } else {
      setOpen(false);
      router.refresh();
    }
  }

  async function handleDeletePois() {
    setDeletingPois(true);
    try {
      await fetch(`/api/cities/${city.id}/pois/bulk`, { method: "DELETE" });
      setPoisDeleted(true);
      toast("All discovered places deleted");
    } catch {
      toast("Failed to delete places", { variant: "error" });
    } finally {
      setDeletingPois(false);
    }
  }

  async function handleClearRecommendations() {
    setClearingRecs(true);
    try {
      // Delete cached activity recommendations
      await fetch(`/api/cities/${city.id}/activities`, { method: "DELETE" });
      setRecsCleared(true);
      toast("Recommendations cleared — you can regenerate them");
    } catch {
      toast("Failed to clear recommendations", { variant: "error" });
    } finally {
      setClearingRecs(false);
    }
  }

  function handleDone() {
    setShowLocationChangeDialog(false);
    setPoisDeleted(false);
    setRecsCleared(false);
    setOpen(false);
    setCityMeta(null);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
        title="Edit destination"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSave} className="space-y-3 rounded-md border border-[hsl(var(--border))] p-4">
        <div className="space-y-1">
          <Label htmlFor="edit-city-name">Location</Label>
          <CityAutocomplete
            id="edit-city-name"
            value={name}
            onChange={setName}
            onSelect={(d) => { setName(d.name); setCityMeta(d); }}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-city-nickname">Display name <span className="text-[10px] font-normal text-[hsl(var(--muted-foreground))]">(optional)</span></Label>
          <Input
            id="edit-city-nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={`e.g. a shorter name for "${name}"`}
          />
          {nickname.trim() && (
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
              Will display &ldquo;{nickname.trim()}&rdquo; instead of &ldquo;{name}&rdquo;
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="edit-city-start">Start date</Label>
            <Input
              id="edit-city-start"
              type="date"
              value={startDate}
              min={tripStartDate.slice(0, 10)}
              max={tripEndDate.slice(0, 10)}
              onChange={(e) => {
                const newStartDate = e.target.value;
                setStartDate(newStartDate);
                // If end date is before new start date, update it to match
                if (endDate < newStartDate) {
                  setEndDate(newStartDate);
                }
              }}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-city-end">End date</Label>
            <Input
              id="edit-city-end"
              type="date"
              value={endDate}
              min={startDate || tripStartDate.slice(0, 10)}
              max={tripEndDate.slice(0, 10)}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving || showLocationChangeDialog}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>

      {showLocationChangeDialog && (
        <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 p-4">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            📍 Location changed — what about existing data?
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleDeletePois}
              disabled={deletingPois || poisDeleted}
              className="flex items-center gap-2 w-full text-left rounded-md border border-[hsl(var(--border))] px-3 py-2 text-sm hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50"
            >
              {poisDeleted ? "✅" : "🗑️"}
              <div>
                <span className="font-medium">{poisDeleted ? "Places deleted" : deletingPois ? "Deleting..." : "Delete all discovered places"}</span>
                {!poisDeleted && <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Remove POIs so you can Discover for the new location</p>}
              </div>
            </button>
            <button
              type="button"
              onClick={handleClearRecommendations}
              disabled={clearingRecs || recsCleared}
              className="flex items-center gap-2 w-full text-left rounded-md border border-[hsl(var(--border))] px-3 py-2 text-sm hover:bg-[hsl(var(--muted))] transition-colors disabled:opacity-50"
            >
              {recsCleared ? "✅" : "🔄"}
              <div>
                <span className="font-medium">{recsCleared ? "Recommendations cleared" : clearingRecs ? "Clearing..." : "Clear recommendations"}</span>
                {!recsCleared && <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Clear cached recommendations so they can be regenerated</p>}
              </div>
            </button>
          </div>
          <Button type="button" size="sm" onClick={handleDone} className="w-full">
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
