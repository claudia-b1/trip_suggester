"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export type PoiSuggestion = {
  placeId: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  category: string;
  type: string;
};

export function PoiAutocomplete({
  value,
  onChange,
  onSelect,
  cityLat,
  cityLon,
  id,
  placeholder = "Search places…",
  required,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (poi: PoiSuggestion) => void;
  /** City center latitude — biases results */
  cityLat?: number;
  /** City center longitude — biases results */
  cityLon?: number;
  id?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<PoiSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

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
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        let url = `/api/pois/search?q=${encodeURIComponent(v.trim())}`;
        if (cityLat != null && cityLon != null) {
          url += `&lat=${cityLat}&lon=${cityLon}`;
        }
        const res = await fetch(url);
        if (!res.ok) return;
        const data: PoiSuggestion[] = await res.json();
        setSuggestions(data);
        setOpen(data.length > 0);
      } catch {
        /* ignore */
      }
    }, 300);
  }

  function handleSelect(s: PoiSuggestion) {
    onChange(s.name);
    setOpen(false);
    setSuggestions([]);
    onSelect(s);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg overflow-hidden max-h-60 overflow-y-auto">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-[hsl(var(--muted))] transition-colors"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(s)}
              >
                <span className="font-medium">{s.name}</span>
                <br />
                <span className="text-xs text-[hsl(var(--muted-foreground))] line-clamp-1">
                  {s.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
