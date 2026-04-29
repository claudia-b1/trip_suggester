"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

export function NewTripForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);

  function validateDates(start: string, end: string): string | null {
    if (!start || !end) return null;
    if (new Date(end) < new Date(start)) {
      return "End date must be on or after start date.";
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateDates(startDate, endDate);
    if (err) {
      setDateError(err);
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, startDate, endDate }),
    });
    if (!res.ok) {
      const body: { error?: string } = await res.json().catch(() => ({}));
      toast(body.error ?? "Failed to create trip", { variant: "error" });
      setSubmitting(false);
      return;
    }
    const trip = await res.json();
    router.push(`/trips/${trip.id}`);
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="p-6">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Tokyo, autumn 2026"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="start">Start date</Label>
              <Input
                id="start"
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
              <Label htmlFor="end">End date</Label>
              <Input
                id="end"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDateError(validateDates(startDate, e.target.value));
                }}
                required
                aria-invalid={dateError ? "true" : undefined}
                aria-describedby={dateError ? "end-error" : undefined}
              />
            </div>
          </div>
          {dateError && (
            <p id="end-error" className="text-sm text-red-600">
              {dateError}
            </p>
          )}
          <Button type="submit" disabled={submitting || !!dateError}>
            {submitting ? "Creating…" : "Create trip"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
