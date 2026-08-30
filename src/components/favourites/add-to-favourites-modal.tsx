"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  isCategory,
  type Category,
} from "@/lib/categories";
import { SUBCATEGORIES } from "@/lib/recommendations/subcategories";
import { ACCOMMODATION_SUBCATEGORIES, getExtraFieldDefs, PROXIMITY_OPTIONS, type ExtraFieldDef } from "@/lib/favourite-fields";
import { useFavourites, type FavouriteItemDTO } from "./favourites-provider";
import { useToast } from "@/components/ui/toast";
import { resizeImageFile } from "@/lib/resize-image";

/* ── Subcategory lookup helper ─────────────────────────────────────────── */

function getSubcatsForCategory(cat: string): { id: string; label: string; emoji: string }[] {
  if (cat === "ACCOMMODATION") return ACCOMMODATION_SUBCATEGORIES;
  return (SUBCATEGORIES as Record<string, { id: string; label: string; emoji: string }[]>)[cat] ?? [];
}

/* ── Autocomplete suggestion type ──────────────────────────────────────── */

type Suggestion = {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
  lat?: number;
  lng?: number;
};

/* ── useDebounce hook ──────────────────────────────────────────────────── */

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/* ── Autocomplete dropdown sub-component ──────────────────────────────── */

function AutocompleteInput({
  value,
  onChange,
  onSelect,
  types,
  country,
  placeholder,
  className,
  required,
  label,
  labelSuffix,
}: {
  value: string;
  onChange: (val: string) => void;
  onSelect: (suggestion: Suggestion) => void;
  types: "address" | "cities";
  country: string;
  placeholder: string;
  className: string;
  required?: boolean;
  label: string;
  labelSuffix?: string;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounce(value, 300);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounced.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams({
      action: "autocomplete",
      q: debounced,
      types,
    });
    if (country.trim()) params.set("country", country.trim());

    fetch(`/api/geocode?${params}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: Suggestion[]) => {
        if (!cancelled) {
          setSuggestions(data);
          setOpen(data.length > 0);
        }
      })
      .catch(() => { if (!cancelled) setSuggestions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [debounced, types, country]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">
        {label}
        {labelSuffix && <span className="text-[hsl(var(--muted-foreground))]"> {labelSuffix}</span>}
      </label>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          required={required}
          className={className}
          autoComplete="off"
        />
        {loading && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[hsl(var(--muted-foreground))]">
            ...
          </span>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-[hsl(var(--muted))] transition-colors"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(s);
                  setOpen(false);
                  setSuggestions([]);
                }}
              >
                <span className="font-medium">{s.mainText}</span>
                {s.secondaryText && (
                  <>
                    <br />
                    <span className="text-xs text-[hsl(var(--muted-foreground))] line-clamp-1">
                      {s.secondaryText}
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Extra fields editor sub-component ─────────────────────────────────── */

function ExtraFieldsEditor({
  fields,
  values,
  onChange,
}: {
  fields: ExtraFieldDef[];
  values: Record<string, unknown>;
  onChange: (vals: Record<string, unknown>) => void;
}) {
  if (fields.length === 0) return null;

  const set = (key: string, val: unknown) => onChange({ ...values, [key]: val });

  // Group fields by type for layout
  const proximityFields = fields.filter((f) => f.type === "proximity");
  const starFields = fields.filter((f) => f.type === "stars");
  const boolFields = fields.filter((f) => f.type === "boolean");
  const selectFields = fields.filter((f) => f.type === "select");
  const textFields = fields.filter((f) => f.type === "text");

  return (
    <div className="space-y-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3">
      <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Extra fields</p>

      {/* Proximity ratings */}
      {proximityFields.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {proximityFields.map((f) => (
            <div key={f.key}>
              <label className="mb-0.5 block text-xs text-[hsl(var(--foreground))]">{f.label}</label>
              <select
                value={(values[f.key] as string) || "-"}
                onChange={(e) => set(f.key, e.target.value)}
                className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs"
              >
                {PROXIMITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Star ratings */}
      {starFields.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {starFields.map((f) => {
            const val = (values[f.key] as number) || 0;
            return (
              <div key={f.key}>
                <label className="mb-0.5 block text-xs text-[hsl(var(--foreground))]">{f.label}</label>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => set(f.key, val === star ? null : star)}
                      className={`text-sm ${star <= val ? "text-amber-400" : "text-gray-300"}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Select fields */}
      {selectFields.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {selectFields.map((f) => (
            <div key={f.key}>
              <label className="mb-0.5 block text-xs text-[hsl(var(--foreground))]">{f.label}</label>
              <select
                value={(values[f.key] as string) || ""}
                onChange={(e) => set(f.key, e.target.value || null)}
                className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs"
              >
                <option value="">—</option>
                {f.type === "select" && f.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Boolean checkboxes */}
      {boolFields.length > 0 && (
        <div className="grid grid-cols-2 gap-1">
          {boolFields.map((f) => (
            <label key={f.key} className="flex items-center gap-1.5 text-xs text-[hsl(var(--foreground))]">
              <input
                type="checkbox"
                checked={!!values[f.key]}
                onChange={(e) => set(f.key, e.target.checked || undefined)}
                className="rounded border-[hsl(var(--border))]"
              />
              {f.label}
            </label>
          ))}
        </div>
      )}

      {/* Text fields */}
      {textFields.length > 0 && (
        <div className="space-y-2">
          {textFields.map((f) => (
            <div key={f.key}>
              <label className="mb-0.5 block text-xs text-[hsl(var(--foreground))]">{f.label}</label>
              <input
                type="text"
                value={(values[f.key] as string) || ""}
                onChange={(e) => set(f.key, e.target.value || undefined)}
                className="w-full rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Coordinate format parser ─────────────────────────────────────────── */

/**
 * Try to parse coordinates from various non-standard formats.
 * Returns null if it can't parse, or { lat, lng } if it can.
 *
 * Supported formats:
 *   DMS:    50°53'28"N 7°1'23"E   /  50°53'28.5"N, 7°1'23.2"E
 *   DM:     50°53.467'N 7°1.383'E
 *   Dec+dir: 50.891N 7.023E  /  N50.891, E7.023  /  50.891°N, 7.023°E
 *   Degree symbol: 50.891° 7.023°
 *   Misc separators: semicolons, slashes, pipes, spaces
 */
function tryParseCoords(input: string): { lat: number; lng: number } | null {
  const s = input.trim();
  if (!s) return null;

  // Normalise common unicode variants
  const n = s
    .replace(/[′’`]/g, "'")   // ′ ' ` → '
    .replace(/[″”]/g, '"')          // ″ " → "
    .replace(/°/g, "°");                 // ensure °

  // 1. DMS: 50°53'28"N 7°1'23"E  (with optional decimals on seconds)
  const dms = n.match(
    /(\d+)\s*°\s*(\d+)\s*['"]\s*(\d+(?:\.\d+)?)\s*["]\s*([NSns])\s*[,;/|\s]+\s*(\d+)\s*°\s*(\d+)\s*['"]\s*(\d+(?:\.\d+)?)\s*["]\s*([EWew])/,
  );
  if (dms) {
    const lat = (parseInt(dms[1]) + parseInt(dms[2]) / 60 + parseFloat(dms[3]) / 3600) * (dms[4].toUpperCase() === "S" ? -1 : 1);
    const lng = (parseInt(dms[5]) + parseInt(dms[6]) / 60 + parseFloat(dms[7]) / 3600) * (dms[8].toUpperCase() === "W" ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }

  // 2. DM: 50°53.467'N 7°1.383'E
  const dm = n.match(
    /(\d+)\s*°\s*(\d+(?:\.\d+)?)\s*['"]\s*([NSns])\s*[,;/|\s]+\s*(\d+)\s*°\s*(\d+(?:\.\d+)?)\s*['"]\s*([EWew])/,
  );
  if (dm) {
    const lat = (parseInt(dm[1]) + parseFloat(dm[2]) / 60) * (dm[3].toUpperCase() === "S" ? -1 : 1);
    const lng = (parseInt(dm[4]) + parseFloat(dm[5]) / 60) * (dm[6].toUpperCase() === "W" ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }

  // 3. Decimal with direction after: 50.891°N, 7.023°E  or  50.891 N, 7.023 E  or  50.891N 7.023E
  const decDir = n.match(
    /(-?\d+\.?\d*)\s*°?\s*([NSns])\s*[,;/|\s]+\s*(-?\d+\.?\d*)\s*°?\s*([EWew])/,
  );
  if (decDir) {
    const lat = parseFloat(decDir[1]) * (decDir[2].toUpperCase() === "S" ? -1 : 1);
    const lng = parseFloat(decDir[3]) * (decDir[4].toUpperCase() === "W" ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }

  // 4. Direction before decimal: N50.891, E7.023  or  N 50.891, E 7.023
  const dirDec = n.match(
    /([NSns])\s*(-?\d+\.?\d*)\s*°?\s*[,;/|\s]+\s*([EWew])\s*(-?\d+\.?\d*)/,
  );
  if (dirDec) {
    const lat = parseFloat(dirDec[2]) * (dirDec[1].toUpperCase() === "S" ? -1 : 1);
    const lng = parseFloat(dirDec[4]) * (dirDec[3].toUpperCase() === "W" ? -1 : 1);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }

  // 5. Decimal with degree symbol only: 50.891° 7.023°  or  50.891°, 7.023°
  const deg = n.match(
    /(-?\d+\.?\d*)\s*°\s*[,;/|\s]+\s*(-?\d+\.?\d*)\s*°/,
  );
  if (deg) {
    const lat = parseFloat(deg[1]);
    const lng = parseFloat(deg[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }

  // 6. Decimal separated by non-standard separators: 50.891 / 7.023  or  50.891 | 7.023
  const misc = n.match(
    /^\s*(-?\d+\.?\d*)\s*[/|]\s*(-?\d+\.?\d*)\s*$/,
  );
  if (misc) {
    const lat = parseFloat(misc[1]);
    const lng = parseFloat(misc[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }

  return null;
}

/* ── Main Modal ────────────────────────────────────────────────────────── */

export function AddToFavouritesModal() {
  const {
    addModalPrefill, closeAddModal,
    editModalItem, closeEditModal,
    lists, refreshLists, favouritedPlaceIds,
  } = useFavourites();
  const { toast } = useToast();

  const isEditMode = !!editModalItem;
  const isVisible = !!addModalPrefill || !!editModalItem;

  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("CULTURE");
  const [subcategory, setSubcategory] = useState("");
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [locMode, setLocMode] = useState<"address" | "coords">("address");
  const [coords, setCoords] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [extraFields, setExtraFields] = useState<Record<string, unknown>>({});
  const [listId, setListId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [showCreateList, setShowCreateList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [coordsSuggestion, setCoordsSuggestion] = useState<{ lat: number; lng: number; original: string } | null>(null);
  const [reverseGeocodedAddress, setReverseGeocodedAddress] = useState<string | null>(null);
  const [reverseGeocoding, setReverseGeocoding] = useState(false);

  // Track whether coords were resolved from address (to avoid re-validating)
  const coordsFromGeocode = useRef(false);
  // Track latest reverse geocode request to avoid race conditions
  const reverseGeoAbort = useRef<AbortController | null>(null);

  // Reverse geocode coordinates → address (debounced)
  const reverseGeoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerReverseGeocode = useCallback((lat: number, lng: number) => {
    // Cancel any pending request
    if (reverseGeoTimer.current) clearTimeout(reverseGeoTimer.current);
    if (reverseGeoAbort.current) reverseGeoAbort.current.abort();

    reverseGeoTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      reverseGeoAbort.current = controller;
      setReverseGeocoding(true);

      try {
        const params = new URLSearchParams({
          action: "reverse",
          lat: String(lat),
          lng: String(lng),
        });
        const res = await fetch(`/api/geocode?${params}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          if (!controller.signal.aborted) {
            setReverseGeocodedAddress(data.address ?? null);
            // Also auto-fill address state so it gets saved
            if (data.address) setAddress(data.address);
            // Auto-fill city and country if empty
            if (data.city) setCity((prev) => prev.trim() ? prev : data.city);
            if (data.country) setCountry((prev) => prev.trim() ? prev : data.country);
          }
        }
      } catch {
        // Aborted or network error — ignore
      } finally {
        if (!controller.signal.aborted) setReverseGeocoding(false);
      }
    }, 500);
  }, []);

  // Reset form when prefill/edit item changes
  useEffect(() => {
    if (editModalItem) {
      setName(editModalItem.name);
      setCategory(isCategory(editModalItem.category) ? editModalItem.category : "CULTURE");
      setSubcategory(editModalItem.subcategory ?? "");
      setCountry(editModalItem.country);
      setCity(editModalItem.city);
      setAddress(editModalItem.address ?? "");
      setLatitude(editModalItem.latitude);
      setLongitude(editModalItem.longitude);
      setCoords(editModalItem.latitude && editModalItem.longitude ? `${editModalItem.latitude}, ${editModalItem.longitude}` : "");
      setLocMode(editModalItem.address ? "address" : "coords");
      setDescription(editModalItem.description ?? "");
      setWebsite(editModalItem.website ?? "");
      setPhotoUrl(editModalItem.photoUrl ?? "");
      setNotes(editModalItem.notes ?? "");
      setExtraFields((editModalItem.extraFields as Record<string, unknown>) ?? {});
      setListId(editModalItem.listId);
      setShowCreateList(false);
      setNewListName("");
      setLocationError(null);
      setCoordsSuggestion(null);
      setReverseGeocodedAddress(null);
      coordsFromGeocode.current = false;
    } else if (addModalPrefill) {
      setName(addModalPrefill.name ?? "");
      setCategory(addModalPrefill.category ?? "CULTURE");
      setSubcategory(addModalPrefill.subcategory ?? "");
      setCountry(addModalPrefill.country ?? "");
      setCity(addModalPrefill.city ?? "");
      setAddress("");
      setLatitude(addModalPrefill.latitude ?? null);
      setLongitude(addModalPrefill.longitude ?? null);
      setCoords(addModalPrefill.latitude && addModalPrefill.longitude ? `${addModalPrefill.latitude}, ${addModalPrefill.longitude}` : "");
      setLocMode(addModalPrefill.latitude != null ? "coords" : "address");
      setDescription(addModalPrefill.description ?? "");
      setWebsite(addModalPrefill.website ?? "");
      setPhotoUrl(addModalPrefill.photoUrl ?? "");
      setNotes("");
      setExtraFields(addModalPrefill.extraFields ?? {});
      setShowCreateList(false);
      setNewListName("");
      setLocationError(null);
      setCoordsSuggestion(null);
      setReverseGeocodedAddress(null);
      coordsFromGeocode.current = false;
      // Auto-select list
      const allLists = flattenLists();
      if (addModalPrefill.listId && allLists.some((l) => l.id === addModalPrefill.listId)) {
        setListId(addModalPrefill.listId);
      } else if (allLists.length > 0) {
        setListId(allLists[0].id);
      } else {
        setListId("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addModalPrefill, editModalItem]);

  // When lists load, auto-select first list
  useEffect(() => {
    if (!addModalPrefill || isEditMode) return;
    if (listId !== "" && !showCreateList) return;
    const allLists = flattenLists();
    if (allLists.length > 0 && !showCreateList) {
      if (addModalPrefill.listId && allLists.some((l) => l.id === addModalPrefill.listId)) {
        setListId(addModalPrefill.listId);
      } else {
        setListId(allLists[0].id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists]);

  // Duplicate detection
  const duplicateWarning = useMemo(() => {
    if (!addModalPrefill || isEditMode) return null;
    if (addModalPrefill.sourcePlaceId && favouritedPlaceIds.has(addModalPrefill.sourcePlaceId)) {
      return "This place is already in your favourites.";
    }
    if (!name.trim() || !city.trim()) return null;
    const nameLower = name.trim().toLowerCase();
    const cityLower = city.trim().toLowerCase();
    for (const list of lists) {
      for (const item of list.items) {
        if (item.name.toLowerCase() === nameLower && item.city.toLowerCase() === cityLower) {
          return `Similar favourite "${item.name}" already exists in ${list.name}.`;
        }
      }
      for (const sub of list.sublists) {
        for (const item of sub.items) {
          if (item.name.toLowerCase() === nameLower && item.city.toLowerCase() === cityLower) {
            return `Similar favourite "${item.name}" already exists in ${list.name} / ${sub.name}.`;
          }
        }
      }
    }
    return null;
  }, [name, city, lists, addModalPrefill, isEditMode, favouritedPlaceIds]);

  if (!isVisible) return null;

  function flattenLists() {
    const result: { id: number; name: string }[] = [];
    for (const list of lists) {
      result.push({ id: list.id, name: list.name });
      for (const sub of list.sublists) {
        result.push({ id: sub.id, name: `${list.name} / ${sub.name}` });
      }
    }
    return result;
  }

  const handleClose = () => {
    if (isEditMode) closeEditModal();
    else closeAddModal();
  };

  const availableLists = flattenLists();
  const subcats = getSubcatsForCategory(category);
  const extraFieldDefs = getExtraFieldDefs(category, subcategory || null);

  // ── Location helpers ─────────────────────────────────────────────────────

  function handleCoordsChange(val: string) {
    setCoords(val);
    setLocationError(null);
    setCoordsSuggestion(null);
    setReverseGeocodedAddress(null);
    coordsFromGeocode.current = false;

    // Try standard decimal format first: 48.8566, 2.3522
    const match = val.match(/^\s*(-?\d+\.?\d*)\s*[,;\s]\s*(-?\d+\.?\d*)\s*$/);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        setLatitude(lat);
        setLongitude(lng);
        // Auto-resolve address from coordinates
        triggerReverseGeocode(lat, lng);
      } else {
        setLocationError("Coordinates out of range (lat: -90 to 90, lng: -180 to 180)");
        setLatitude(null);
        setLongitude(null);
      }
      return;
    }

    // Not standard format — try alternative formats and show suggestion
    if (val.trim()) {
      setLatitude(null);
      setLongitude(null);
      const parsed = tryParseCoords(val);
      if (parsed) {
        setCoordsSuggestion({ lat: parsed.lat, lng: parsed.lng, original: val });
      }
    }
  }

  function applySuggestion() {
    if (!coordsSuggestion) return;
    const { lat, lng } = coordsSuggestion;
    const formatted = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    setCoords(formatted);
    setLatitude(lat);
    setLongitude(lng);
    setCoordsSuggestion(null);
    setLocationError(null);
    // Auto-resolve address from coordinates
    triggerReverseGeocode(lat, lng);
  }

  function handleAddressSelect(s: Suggestion) {
    setAddress(s.description);
    setLocationError(null);

    // If the suggestion already has coords (Mapbox), use them directly
    if (s.lat != null && s.lng != null) {
      setLatitude(s.lat);
      setLongitude(s.lng);
      setCoords(`${s.lat}, ${s.lng}`);
      coordsFromGeocode.current = true;
      return;
    }

    // Otherwise geocode via Google place_id
    setGeocoding(true);
    const params = new URLSearchParams({ action: "geocode", placeId: s.placeId });
    if (country.trim()) params.set("country", country.trim());

    fetch(`/api/geocode?${params}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.lat != null && data?.lng != null) {
          setLatitude(data.lat);
          setLongitude(data.lng);
          setCoords(`${data.lat}, ${data.lng}`);
          coordsFromGeocode.current = true;
          // Auto-fill city and country if empty
          if (!city.trim() && data.city) setCity(data.city);
          if (!country.trim() && data.country) setCountry(data.country);
        }
      })
      .catch(() => {})
      .finally(() => setGeocoding(false));
  }

  function handleCitySelect(s: Suggestion) {
    setCity(s.mainText);

    // If city suggestion has coords (Mapbox), geocode to get the country
    if (s.lat != null && s.lng != null) {
      // Auto-fill country from secondary text if not set
      if (!country.trim() && s.secondaryText) {
        // secondaryText is typically "State, Country"
        const parts = s.secondaryText.split(",").map((p) => p.trim());
        if (parts.length > 0) setCountry(parts[parts.length - 1]);
      }
      return;
    }

    // Geocode placeId to get country
    if (s.placeId && !country.trim()) {
      const params = new URLSearchParams({ action: "geocode", placeId: s.placeId });
      fetch(`/api/geocode?${params}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data?.country && !country.trim()) setCountry(data.country);
        })
        .catch(() => {});
    }
  }

  // Validate coordinates are within the selected country
  async function validateLocation(): Promise<boolean> {
    setLocationError(null);

    const hasCoords = latitude != null && longitude != null;
    const hasAddress = address.trim().length > 0;

    // Must have at least one
    if (locMode === "coords" && !hasCoords) {
      setLocationError("Please enter valid coordinates (lat, lng)");
      return false;
    }
    if (locMode === "address" && !hasAddress && !hasCoords) {
      setLocationError("Please enter an address or search for a place");
      return false;
    }

    // If address mode but no coords yet, geocode the address
    if (locMode === "address" && hasAddress && !hasCoords) {
      setGeocoding(true);
      try {
        const params = new URLSearchParams({ action: "geocode", address: address.trim() });
        if (country.trim()) params.set("country", country.trim());
        const res = await fetch(`/api/geocode?${params}`);
        if (res.ok) {
          const data = await res.json();
          if (data.lat != null && data.lng != null) {
            setLatitude(data.lat);
            setLongitude(data.lng);
            setCoords(`${data.lat}, ${data.lng}`);
            coordsFromGeocode.current = true;
            if (!city.trim() && data.city) setCity(data.city);
            if (!country.trim() && data.country) setCountry(data.country);
          } else {
            setLocationError("Could not find coordinates for this address");
            return false;
          }
        } else {
          setLocationError("Could not find coordinates for this address");
          return false;
        }
      } catch {
        setLocationError("Failed to geocode address");
        return false;
      } finally {
        setGeocoding(false);
      }
    }

    // Validate coords are within country (skip if coords came from geocoding the same country)
    if (country.trim() && latitude != null && longitude != null && !coordsFromGeocode.current) {
      setValidating(true);
      try {
        const params = new URLSearchParams({
          action: "validate",
          lat: String(latitude),
          lng: String(longitude),
          country: country.trim(),
        });
        const res = await fetch(`/api/geocode?${params}`);
        if (res.ok) {
          const data = await res.json();
          if (data.valid === false) {
            setLocationError(data.reason ?? "Coordinates are not in the selected country");
            return false;
          }
        }
      } catch { /* allow through */ }
      finally { setValidating(false); }
    }

    return true;
  }

  function copyCoords() {
    if (latitude != null && longitude != null) {
      navigator.clipboard.writeText(`${latitude}, ${longitude}`);
      toast("Coordinates copied!");
    }
  }

  // Check if location is provided (for submit button)
  const hasLocation = locMode === "coords"
    ? (latitude != null && longitude != null)
    : (address.trim().length > 0 || (latitude != null && longitude != null));

  // Clean extra fields — remove undefined/null/"" values
  function cleanExtraFields(fields: Record<string, unknown>): Record<string, unknown> | null {
    const cleaned: Record<string, unknown> = {};
    let hasValue = false;
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null && v !== "" && v !== false && v !== "-") {
        cleaned[k] = v;
        hasValue = true;
      }
    }
    return hasValue ? cleaned : null;
  }

  async function handleCreateListAndSave() {
    if (!newListName.trim()) {
      toast("Please enter a list name", { variant: "error" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/favourites/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newListName.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast(err?.error ?? "Failed to create list", { variant: "error" });
        return;
      }
      const newList = await res.json();
      await refreshLists();
      await saveItem(newList.id);
    } catch {
      toast("Failed to create list", { variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function saveItem(targetListId: number) {
    setSaving(true);
    try {
      const payload = {
        name,
        category,
        subcategory: subcategory || null,
        country,
        city,
        address: address || null,
        latitude: latitude ?? 0,
        longitude: longitude ?? 0,
        description: description || null,
        notes: notes || null,
        website: website || null,
        photoUrl: photoUrl.trim() || null,
        extraFields: cleanExtraFields(extraFields),
        listId: targetListId,
        ...(isEditMode ? {} : {
          sourcePlaceId: addModalPrefill?.sourcePlaceId || null,
        }),
      };

      const url = isEditMode
        ? `/api/favourites/items/${editModalItem!.id}`
        : "/api/favourites/items";
      const method = isEditMode ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast(isEditMode ? "Favourite updated!" : "Added to favourites!");
        await refreshLists();
        // Dispatch sync event so POI section picks up changes
        if (isEditMode && editModalItem) {
          window.dispatchEvent(new CustomEvent("favourite-sync", {
            detail: {
              name: editModalItem.name,
              city: editModalItem.city,
              sourcePlaceId: editModalItem.sourcePlaceId,
              category: payload.category,
              subcategory: payload.subcategory,
            },
          }));
        } else {
          window.dispatchEvent(new CustomEvent("favourite-sync", {
            detail: { newFavourite: true },
          }));
        }
        handleClose();
      } else {
        const err = await res.json().catch(() => null);
        toast(err?.error ?? "Failed to save", { variant: "error" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Validate location before saving
    const valid = await validateLocation();
    if (!valid) return;

    if (isEditMode) {
      await saveItem(typeof listId === "number" ? listId : editModalItem!.listId);
    } else if (showCreateList) {
      await handleCreateListAndSave();
    } else if (typeof listId === "number") {
      await saveItem(listId);
    }
  }

  const inputCls = "w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative z-10 mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">
            {isEditMode ? "✏️ Edit Favourite" : "❤️ Add to Favourites"}
          </h3>
          <button onClick={handleClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className={inputCls} />
          </div>

          {/* Category + Subcategory */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">Category</label>
              <select value={category} onChange={(e) => { setCategory(e.target.value as Category); setSubcategory(""); setExtraFields({}); }} className={inputCls}>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">Subcategory</label>
              <select value={subcategory} onChange={(e) => { setSubcategory(e.target.value); setExtraFields({}); }} className={inputCls}>
                <option value="">— None —</option>
                {subcats.map((s) => (
                  <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Country + City with autocomplete */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">Country *</label>
              <input
                type="text"
                value={country}
                onChange={(e) => { setCountry(e.target.value); setLocationError(null); coordsFromGeocode.current = false; }}
                required
                className={inputCls}
                placeholder="e.g. France"
              />
            </div>
            <AutocompleteInput
              value={city}
              onChange={(v) => { setCity(v); setLocationError(null); }}
              onSelect={handleCitySelect}
              types="cities"
              country={country}
              placeholder="e.g. Paris"
              className={inputCls}
              required
              label="City *"
            />
          </div>

          {/* Location: Address OR Coordinates */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-[hsl(var(--foreground))]">
                Location *
              </label>
              <div className="inline-flex rounded-md border border-[hsl(var(--border))] p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => { setLocMode("address"); setLocationError(null); }}
                  className={`rounded px-2 py-0.5 font-medium transition-colors ${
                    locMode === "address"
                      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                      : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                  }`}
                >
                  📍 Address
                </button>
                <button
                  type="button"
                  onClick={() => { setLocMode("coords"); setLocationError(null); }}
                  className={`rounded px-2 py-0.5 font-medium transition-colors ${
                    locMode === "coords"
                      ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                      : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                  }`}
                >
                  🌐 Coordinates
                </button>
              </div>
            </div>

            {locMode === "address" ? (
              <div className="space-y-2">
                <AutocompleteInput
                  value={address}
                  onChange={(v) => { setAddress(v); setLocationError(null); coordsFromGeocode.current = false; }}
                  onSelect={handleAddressSelect}
                  types="address"
                  country={country}
                  placeholder="Search address or place name..."
                  className={inputCls}
                  label=""
                  labelSuffix=""
                />
                {geocoding && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Resolving coordinates...</p>
                )}
                {latitude != null && longitude != null && (
                  <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                    <span>📍 {latitude.toFixed(5)}, {longitude.toFixed(5)}</span>
                    <button type="button" onClick={copyCoords} className="hover:text-[hsl(var(--foreground))]" title="Copy">
                      📋
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={coords}
                    onChange={(e) => handleCoordsChange(e.target.value)}
                    placeholder="e.g. 48.8566, 2.3522"
                    className={`flex-1 ${inputCls}`}
                  />
                  {latitude != null && longitude != null && (
                    <button type="button" onClick={copyCoords} className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]" title="Copy coordinates">
                      📋
                    </button>
                  )}
                </div>
                {/* Suggestion for non-standard format */}
                {coordsSuggestion && (
                  <button
                    type="button"
                    onClick={applySuggestion}
                    className="flex w-full items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-left text-xs transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:hover:bg-blue-950/60"
                  >
                    <span className="text-blue-500">💡</span>
                    <span className="flex-1">
                      <span className="text-[hsl(var(--muted-foreground))]">Did you mean </span>
                      <span className="font-medium text-blue-700 dark:text-blue-300">
                        {coordsSuggestion.lat.toFixed(6)}, {coordsSuggestion.lng.toFixed(6)}
                      </span>
                      <span className="text-[hsl(var(--muted-foreground))]">?</span>
                    </span>
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                      Apply
                    </span>
                  </button>
                )}
                {/* Resolved address from reverse geocoding */}
                {reverseGeocoding && (
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Resolving address...</p>
                )}
                {reverseGeocodedAddress && !reverseGeocoding && (
                  <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs dark:border-emerald-800 dark:bg-emerald-950/40">
                    <span className="mt-0.5 text-emerald-500">📍</span>
                    <span className="flex-1 text-emerald-800 dark:text-emerald-200">
                      {reverseGeocodedAddress}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Location validation feedback */}
            {locationError && (
              <p className="rounded-md border border-red-300/50 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:border-red-700/50 dark:bg-red-950/30 dark:text-red-300">
                {locationError}
              </p>
            )}
            {validating && (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Validating location...</p>
            )}
          </div>

          {/* Website */}
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">
              Website <span className="text-[hsl(var(--muted-foreground))]">(optional)</span>
            </label>
            <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." className={inputCls} />
          </div>

          {/* Image upload */}
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">
              Image <span className="text-[hsl(var(--muted-foreground))]">(optional)</span>
            </label>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm hover:bg-[hsl(var(--accent))] transition-colors">
                📷 {photoUrl ? "Change" : "Choose file"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const dataUri = await resizeImageFile(file, 600);
                    setPhotoUrl(dataUri);
                  }}
                />
              </label>
              {photoUrl && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrl} alt="Preview" className="h-8 w-8 rounded object-cover" />
                  <button type="button" onClick={() => setPhotoUrl("")} className="text-xs text-red-400 hover:text-red-300">✕</button>
                </>
              )}
            </div>
          </div>

          {/* Description (edit mode) */}
          {isEditMode && (
            <div>
              <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">
                Description <span className="text-[hsl(var(--muted-foreground))]">(optional)</span>
              </label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">
              Notes <span className="text-[hsl(var(--muted-foreground))]">(optional)</span>
            </label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} placeholder="Personal notes about this place..." />
          </div>

          {/* Extra fields (dynamic based on category/subcategory) */}
          {extraFieldDefs.length > 0 && (
            <ExtraFieldsEditor fields={extraFieldDefs} values={extraFields} onChange={setExtraFields} />
          )}

          {/* List picker */}
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">
              {isEditMode ? "List" : "Save to list"}
            </label>
            {showCreateList ? (
              <div className="flex gap-2">
                <input type="text" value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="New list name..." className={`flex-1 ${inputCls}`} autoFocus />
                <button type="button" onClick={() => setShowCreateList(false)} className="rounded-md border border-[hsl(var(--border))] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                  Cancel
                </button>
              </div>
            ) : availableLists.length > 0 ? (
              <div className="flex gap-2">
                <select value={listId} onChange={(e) => setListId(Number(e.target.value))} required className={`flex-1 ${inputCls}`}>
                  {availableLists.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                {!isEditMode && (
                  <button type="button" onClick={() => setShowCreateList(true)} className="rounded-md border border-[hsl(var(--border))] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]" title="Create new list">
                    + New
                  </button>
                )}
              </div>
            ) : (
              <div>
                <p className="mb-1.5 text-xs text-[hsl(var(--muted-foreground))]">No lists yet — create one:</p>
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => { setNewListName(e.target.value); setShowCreateList(true); }}
                  onFocus={() => setShowCreateList(true)}
                  placeholder="List name..."
                  className={inputCls}
                />
              </div>
            )}
          </div>

          {/* Duplicate warning */}
          {duplicateWarning && (
            <div className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300">
              {duplicateWarning} Save anyway?
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={handleClose} className="rounded-md border border-[hsl(var(--border))] px-4 py-2 text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || validating || geocoding || !name.trim() || !country.trim() || !city.trim() || !hasLocation || (!isEditMode && !showCreateList && !listId)}
              className="rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
            >
              {saving ? "Saving..." : validating ? "Validating..." : geocoding ? "Resolving..." : isEditMode ? "Save Changes" : "Save to Favourites"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
