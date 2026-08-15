"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export type CityDetails = {
  name: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

type Prediction = {
  placeId: string;
  name: string;
  description: string;
};

export function CityAutocomplete({
  value,
  onChange,
  onSelect,
  id,
  placeholder = "Search cities…",
  required,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (details: CityDetails) => void;
  id?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleChange(v: string) {
    onChange(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length < 2) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cities/search?q=${encodeURIComponent(v.trim())}`);
        if (!res.ok) return;
        const data: Prediction[] = await res.json();
        setPredictions(data);
        setOpen(data.length > 0);
      } catch {
        /* ignore */
      }
    }, 300);
  }

  async function handleSelect(pred: Prediction) {
    onChange(pred.name);
    setOpen(false);
    setPredictions([]);
    setLoading(true);
    try {
      const res = await fetch(`/api/cities/search?placeId=${encodeURIComponent(pred.placeId)}`);
      if (res.ok) {
        const details: CityDetails = await res.json();
        onSelect(details);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => predictions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        required={required}
        disabled={disabled || loading}
        autoComplete="off"
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[hsl(var(--muted-foreground))] animate-pulse">
          Loading…
        </span>
      )}
      {open && predictions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg overflow-hidden">
          {predictions.map((p) => (
            <li key={p.placeId}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-[hsl(var(--muted))] transition-colors"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(p)}
              >
                <span className="font-medium">{p.name}</span>
                <span className="ml-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                  {p.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
