"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";

function toInputDate(iso: string) {
  return iso.slice(0, 10);
}

export function EditTripButton({
  trip,
}: {
  trip: { id: number; name: string; startDate: string; endDate: string };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(trip.name);
  const [startDate, setStartDate] = useState(toInputDate(trip.startDate));
  const [endDate, setEndDate] = useState(toInputDate(trip.endDate));
  const [saving, setSaving] = useState(false);

  function onCancel() {
    setName(trip.name);
    setStartDate(toInputDate(trip.startDate));
    setEndDate(toInputDate(trip.endDate));
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
    const res = await fetch(`/api/trips/${trip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), startDate, endDate }),
    });
    setSaving(false);
    if (!res.ok) {
      toast("Failed to update trip", { variant: "error" });
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        ✏️ Edit trip
      </Button>
    );
  }

  return (
    <form onSubmit={onSave} className="space-y-3 rounded-md border border-[hsl(var(--border))] p-4">
      <div className="space-y-1">
        <Label htmlFor="edit-trip-name">Name</Label>
        <Input id="edit-trip-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="edit-trip-start">Start date</Label>
          <Input id="edit-trip-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-trip-end">End date</Label>
          <Input id="edit-trip-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
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
