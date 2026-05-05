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
import { CityAutocomplete, type CityDetails } from "@/components/ui/city-autocomplete";

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
  const [cityMeta, setCityMeta] = useState<CityDetails | null>(null);

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
      body: JSON.stringify({
        name,
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
    if (!res.ok) {
      toast("Failed to add city", { variant: "error" });
      setSubmitting(false);
      return;
    }
    setName("");
    setStartDate("");
    setEndDate("");
    setCityMeta(null);
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
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[hsl(var(--border))] px-6 py-10 text-center">
            <span className="text-4xl mb-2">🏙️</span>
            <p className="text-sm font-medium">No cities yet</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Add one below to start planning.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {cities.map((city, i) => {
              const CITY_ICONS = ["🏛️", "🗼", "🌃", "🏰", "⛩️", "🌉"];
              const icon = CITY_ICONS[i % CITY_ICONS.length];
              const days = Math.round((new Date(city.endDate).getTime() - new Date(city.startDate).getTime()) / 86400000) + 1;
              return (
                <div
                  key={city.id}
                  className="group relative overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
                >
                  <Link
                    href={`/trips/${tripId}/cities/${city.id}`}
                    className="block p-4"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))] text-xl group-hover:scale-110 transition-transform">
                        {icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold truncate group-hover:text-[hsl(var(--primary))] transition-colors">{city.name}</h4>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                          {formatDate(city.startDate)} – {formatDate(city.endDate)}
                        </p>
                        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[hsl(var(--primary))]/10 px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--primary))]">
                          📅 {days} day{days !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                  </Link>
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded-md border border-red-200 p-1.5 text-red-500 opacity-0 transition-all hover:bg-red-50 hover:text-red-700 hover:border-red-300 group-hover:opacity-100 disabled:opacity-30"
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
                </div>
              );
            })}
          </div>
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
            <CityAutocomplete
              id="city-name"
              value={name}
              onChange={setName}
              onSelect={(d) => {
                setName(d.name);
                setCityMeta(d);
              }}
              placeholder="Search cities…"
              required
            />
            {cityMeta && (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {cityMeta.country} · {cityMeta.timezone}
              </p>
            )}
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
