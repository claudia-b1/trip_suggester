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
}: {
  tripId: number;
  city: { id: number; name: string; startDate: string; endDate: string };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(city.name);
  const [startDate, setStartDate] = useState(toInputDate(city.startDate));
  const [endDate, setEndDate] = useState(toInputDate(city.endDate));
  const [saving, setSaving] = useState(false);
  const [cityMeta, setCityMeta] = useState<CityDetails | null>(null);

  function onCancel() {
    setName(city.name);
    setStartDate(toInputDate(city.startDate));
    setEndDate(toInputDate(city.endDate));
    setCityMeta(null);
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
      toast("Failed to update city", { variant: "error" });
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        ✏️ Edit city
      </Button>
    );
  }

  return (
    <form onSubmit={onSave} className="space-y-3 rounded-md border border-[hsl(var(--border))] p-4">
      <div className="space-y-1">
        <Label htmlFor="edit-city-name">Name</Label>
        <CityAutocomplete
          id="edit-city-name"
          value={name}
          onChange={setName}
          onSelect={(d) => { setName(d.name); setCityMeta(d); }}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="edit-city-start">Start date</Label>
          <Input id="edit-city-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-city-end">End date</Label>
          <Input id="edit-city-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
