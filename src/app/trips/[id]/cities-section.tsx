"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

type City = {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString();
}

function validateDates(start: string, end: string): string | null {
  if (!start || !end) return null;
  if (new Date(end) < new Date(start)) {
    return "End date must be on or after start date.";
  }
  return null;
}

export function CitiesSection({
  tripId,
  cities,
}: {
  tripId: number;
  cities: City[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const err = validateDates(startDate, endDate);
    if (err) {
      setDateError(err);
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/trips/${tripId}/cities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, startDate, endDate }),
    });
    if (!res.ok) {
      toast("Failed to add city", { variant: "error" });
      setSubmitting(false);
      return;
    }
    setName("");
    setStartDate("");
    setEndDate("");
    setSubmitting(false);
    setAddOpen(false);
    router.refresh();
  }

  async function onDelete(city: City) {
    const ok = await confirm({
      title: "Delete city?",
      message: `Remove "${city.name}" and its POIs and day plans? This cannot be undone.`,
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(city.id);
    const res = await fetch(`/api/trips/${tripId}/cities/${city.id}`, {
      method: "DELETE",
    });
    setDeletingId(null);
    if (!res.ok) {
      toast("Failed to delete city", { variant: "error" });
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cities</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {cities.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            No cities yet. Add one below to start planning.
          </p>
        ) : (
          <ul className="divide-y divide-[hsl(var(--border))] rounded-md border border-[hsl(var(--border))]">
            {cities.map((city) => (
              <li
                key={city.id}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <Link
                  href={`/trips/${tripId}/cities/${city.id}`}
                  className="flex flex-1 flex-col gap-1 hover:underline sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-medium">{city.name}</span>
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">
                    {formatDate(city.startDate)} – {formatDate(city.endDate)}
                  </span>
                </Link>
                <button
                  type="button"
                  className="self-start rounded-md border border-red-200 p-1.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 hover:border-red-300 disabled:opacity-30 sm:ml-3 sm:self-auto"
                  onClick={() => onDelete(city)}
                  disabled={deletingId === city.id}
                  aria-label={`Delete ${city.name}`}
                >
                  {deletingId === city.id ? (
                    <span className="inline-block h-4 w-4 text-center text-xs">…</span>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-[hsl(var(--border))] pt-4">
          {!addOpen ? (
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              + Add city
            </Button>
          ) : (
            <form
              onSubmit={onAdd}
              className="space-y-4"
              noValidate
            >
          <div className="space-y-2">
            <Label htmlFor="city-name">Name</Label>
            <Input
              id="city-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Kyoto"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="city-start">Start</Label>
              <Input
                id="city-start"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setDateError(validateDates(e.target.value, endDate));
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city-end">End</Label>
              <Input
                id="city-end"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDateError(validateDates(startDate, e.target.value));
                }}
                required
                aria-invalid={dateError ? "true" : undefined}
              />
            </div>
          </div>
          {dateError && (
            <p className="text-sm text-red-600">{dateError}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting || !!dateError}>
              {submitting ? "Adding…" : "Add city"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
