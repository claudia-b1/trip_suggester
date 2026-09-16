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
  iconOnly = false,
}: {
  trip: { id: number; name: string; startDate: string; endDate: string };
  iconOnly?: boolean;
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
    if (iconOnly) {
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Edit trip"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      );
    }
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
