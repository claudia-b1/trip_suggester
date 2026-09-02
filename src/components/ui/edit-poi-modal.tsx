"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS, type Category } from "@/lib/categories";
import { SUBCATEGORIES, type SubcategoryDef } from "@/lib/recommendations/subcategories";
import { ACCOMMODATION_SUBCATEGORIES, FUEL_SUBCATEGORIES } from "@/lib/favourite-fields";
import type { RecommendableCategory } from "@/lib/recommendations";
import { resizeImageFile, getImageFromClipboard } from "@/lib/resize-image";

/** Get subcategory options for a given category */
function getSubcategoryOptions(cat: string): { id: string; label: string; emoji: string }[] {
  if (cat === "ACCOMMODATION") {
    return ACCOMMODATION_SUBCATEGORIES;
  }
  if (cat === "FUEL") {
    return FUEL_SUBCATEGORIES;
  }
  if (cat in SUBCATEGORIES) {
    return (SUBCATEGORIES[cat as RecommendableCategory] as SubcategoryDef[]).map((s) => ({
      id: s.id,
      label: s.label,
      emoji: s.emoji,
    }));
  }
  return [];
}

export type EditPoiData = {
  id: number;
  name: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
  phoneNumber: string | null;
  openingHours: string | null;
  photoUrl: string | null;
  priceLevel: number | null;
  fee: string | null;
  address: string | null;
  notes: string | null;
  // Context from city
  cityName: string | null;
  country: string | null;
  // User-specific
  visited: boolean;
  personalRating: number | null;
  hasOriginalData?: boolean;
  extraFields?: Record<string, unknown> | null;
};

export function EditPoiModal({
  poi,
  onClose,
}: {
  poi: EditPoiData;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Form state — initialize from POI
  const [name, setName] = useState(poi.name);
  const [category, setCategory] = useState(poi.category);
  const [subcategory, setSubcategory] = useState(poi.subcategory ?? "");
  const [description, setDescription] = useState(poi.description ?? "");
  const [website, setWebsite] = useState(poi.website ?? "");
  const [phoneNumber, setPhoneNumber] = useState(poi.phoneNumber ?? "");
  const [openingHours, setOpeningHours] = useState(poi.openingHours ?? "");
  const [photoUrl, setPhotoUrl] = useState(poi.photoUrl);
  const [priceLevel, setPriceLevel] = useState<number | null>(poi.priceLevel);
  const [fee, setFee] = useState(poi.fee ?? "");
  const [address, setAddress] = useState(poi.address ?? "");
  const [notes, setNotes] = useState(poi.notes ?? "");
  const [visited, setVisited] = useState(poi.visited);
  const [personalRating, setPersonalRating] = useState<number | null>(poi.personalRating);
  const [country, setCountry] = useState(poi.country ?? "");
  const [cityName, setCityName] = useState(poi.cityName ?? "");
  const [extraFields, setExtraFields] = useState<Record<string, unknown>>(
    () => (poi.extraFields && typeof poi.extraFields === "object" ? { ...poi.extraFields } : {}),
  );
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [reverseGeocoding, setReverseGeocoding] = useState(false);

  // Reverse geocode to get address, country, city from coordinates
  const reverseGeoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reverseGeoAbort = useRef<AbortController | null>(null);

  const triggerReverseGeocode = useCallback((lat: number, lng: number) => {
    if (reverseGeoTimer.current) clearTimeout(reverseGeoTimer.current);
    if (reverseGeoAbort.current) reverseGeoAbort.current.abort();

    reverseGeoTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      reverseGeoAbort.current = controller;
      setReverseGeocoding(true);
      try {
        const params = new URLSearchParams({ action: "reverse", lat: String(lat), lng: String(lng) });
        const res = await fetch(`/api/geocode?${params}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          if (!controller.signal.aborted) {
            if (data.address) setAddress(data.address);
            if (data.country) setCountry((prev) => prev || data.country);
            if (data.city) setCityName(data.city);
          }
        }
      } catch { /* aborted or network error */ }
      finally { if (!controller.signal.aborted) setReverseGeocoding(false); }
    }, 300);
  }, []);

  // Auto-fill address/country/city from coordinates on mount — only when address is missing.
  // Once the address is set (saved on the POI), we don't re-geocode to avoid overwriting.
  useEffect(() => {
    if (!address && poi.latitude != null && poi.longitude != null) {
      triggerReverseGeocode(poi.latitude, poi.longitude);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUri = await resizeImageFile(file, 600);
      setPhotoUrl(dataUri);
      setPhotoPreview(dataUri);
    } catch {
      toast("Failed to process image", { variant: "error" });
    }
  }

  async function handlePaste(e: React.ClipboardEvent) {
    const dataUri = await getImageFromClipboard(e, 600);
    if (dataUri) {
      e.preventDefault();
      setPhotoUrl(dataUri);
      setPhotoPreview(dataUri);
      toast("Image pasted");
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      toast("Name is required", { variant: "error" });
      return;
    }
    setSaving(true);
    try {
      // Save POI fields
      const body: Record<string, unknown> = {};
      if (name !== poi.name) body.name = name;
      if (category !== poi.category) body.category = category;
      if ((subcategory || null) !== poi.subcategory) body.subcategory = subcategory || null;
      if ((description || null) !== poi.description) body.description = description || null;
      if ((website || null) !== poi.website) body.website = website || null;
      if ((phoneNumber || null) !== poi.phoneNumber) body.phoneNumber = phoneNumber || null;
      if ((openingHours || null) !== poi.openingHours) body.openingHours = openingHours || null;
      if (photoUrl !== poi.photoUrl) body.photoUrl = photoUrl;
      if (priceLevel !== poi.priceLevel) body.priceLevel = priceLevel;
      if ((fee || null) !== poi.fee) body.fee = fee || null;
      if ((address || null) !== poi.address) body.address = address || null;
      if ((notes || null) !== poi.notes) body.notes = notes || null;
      // Extra fields — compare JSON to detect changes
      const origExtra = poi.extraFields && typeof poi.extraFields === "object" ? poi.extraFields : {};
      if (JSON.stringify(extraFields) !== JSON.stringify(origExtra)) {
        body.extraFields = Object.keys(extraFields).length > 0 ? extraFields : null;
      }

      // Save rating/visited separately via rating API
      const ratingChanged = visited !== poi.visited || personalRating !== poi.personalRating;

      const promises: Promise<Response>[] = [];

      if (Object.keys(body).length > 0) {
        promises.push(
          fetch(`/api/pois/${poi.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        );
      }

      if (ratingChanged) {
        const ratingBody: Record<string, unknown> = {};
        if (visited !== poi.visited) ratingBody.visited = visited;
        if (personalRating !== poi.personalRating) ratingBody.rating = personalRating;
        promises.push(
          fetch(`/api/pois/${poi.id}/rating`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ratingBody),
          })
        );
      }

      if (promises.length === 0) {
        onClose();
        return;
      }

      const results = await Promise.all(promises);
      for (const res of results) {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Failed to save");
        }
      }

      toast("POI updated");
      router.refresh();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", { variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const res = await fetch(`/api/pois/${poi.id}/reset`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to reset");
      }
      toast("Restored to original");
      router.refresh();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to reset", { variant: "error" });
    } finally {
      setResetting(false);
    }
  }

  // Photo display source
  const displayPhoto = photoPreview ?? (photoUrl?.startsWith("data:") ? photoUrl : (photoUrl ? `/api/pois/${poi.id}/photo` : null));

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="relative mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onPaste={handlePaste}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Edit Place</h2>
          <button type="button" onClick={onClose} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-4">
          {/* Photo section */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Photo</label>
            <div className="flex items-start gap-3">
              {displayPhoto ? (
                <div className="relative h-20 w-28 rounded-lg overflow-hidden border border-[hsl(var(--border))] flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={displayPhoto} alt="" className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="flex h-20 w-28 items-center justify-center rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 flex-shrink-0">
                  <span className="text-2xl opacity-20">📷</span>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => fileRef.current?.click()}>
                  Upload photo
                </Button>
                <span className="text-[10px] text-[hsl(var(--muted-foreground))]">or paste from clipboard</span>
                {photoUrl && (
                  <Button variant="ghost" size="sm" className="text-xs text-[hsl(var(--muted-foreground))]" onClick={() => { setPhotoUrl(null); setPhotoPreview(null); }}>
                    Remove photo
                  </Button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
              </div>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="text-sm" />
          </div>

          {/* Category + Subcategory row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Category</label>
              <select
                value={category}
                onChange={(e) => { setCategory(e.target.value); setSubcategory(""); }}
                className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Subcategory</label>
              {(() => {
                const opts = getSubcategoryOptions(category);
                if (opts.length === 0) {
                  return <Input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} placeholder="e.g. gas station" className="text-sm" />;
                }
                const currentInList = opts.some((o) => o.id === subcategory);
                return (
                  <select
                    value={currentInList ? subcategory : "__other__"}
                    onChange={(e) => setSubcategory(e.target.value === "__other__" ? "" : e.target.value)}
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm"
                  >
                    <option value="">—</option>
                    {opts.map((o) => (
                      <option key={o.id} value={o.id}>{o.emoji} {o.label}</option>
                    ))}
                    {subcategory && !currentInList && (
                      <option value="__other__">{subcategory}</option>
                    )}
                  </select>
                );
              })()}
            </div>
          </div>

          {/* Country + City row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                Country
                {reverseGeocoding && !country && <span className="ml-1 text-[10px] font-normal normal-case">...</span>}
              </label>
              <Input value={country} disabled className="text-sm opacity-60" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
                City
                {reverseGeocoding && !cityName && <span className="ml-1 text-[10px] font-normal normal-case">...</span>}
              </label>
              <Input value={cityName} disabled className="text-sm opacity-60" />
            </div>
          </div>

          {/* Address (reverse geocoded, editable) */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
              Address
              {reverseGeocoding && <span className="ml-2 text-[10px] font-normal normal-case">resolving...</span>}
            </label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Auto-filled from coordinates" className="text-sm" />
            {poi.latitude != null && poi.longitude != null && (
              <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                📍 {poi.latitude.toFixed(5)}, {poi.longitude.toFixed(5)}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
            />
          </div>

          {/* Website + Phone row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Website</label>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." className="text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Phone</label>
              <Input value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className="text-sm" />
            </div>
          </div>

          {/* Opening hours */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Opening hours</label>
            <Input value={openingHours} onChange={(e) => setOpeningHours(e.target.value)} placeholder="Mon-Fri 9:00-18:00" className="text-sm" />
          </div>

          {/* Price level + Fee row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Price</label>
              <select
                value={priceLevel ?? ""}
                onChange={(e) => setPriceLevel(e.target.value ? Number(e.target.value) : null)}
                className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                <option value="0">Free</option>
                <option value="1">$</option>
                <option value="2">$$</option>
                <option value="3">$$$</option>
                <option value="4">$$$$</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Fee</label>
              <Input value={fee} onChange={(e) => setFee(e.target.value)} placeholder="e.g. 5 EUR" className="text-sm" />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Personal notes about this place..."
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
            />
          </div>

          {/* Extra fields — dynamic key-value pairs */}
          {Object.keys(extraFields).length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Extra info</label>
              </div>
              <div className="space-y-1.5 rounded-md border border-[hsl(var(--border))] p-2.5 bg-[hsl(var(--muted))]/20">
                {Object.entries(extraFields).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-xs text-[hsl(var(--muted-foreground))] min-w-[120px] shrink-0 truncate" title={key}>
                      {key}
                    </span>
                    {typeof value === "boolean" ? (
                      <button
                        type="button"
                        onClick={() => setExtraFields((prev) => ({ ...prev, [key]: !value }))}
                        className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                          value
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {value ? "Yes" : "No"}
                      </button>
                    ) : typeof value === "number" ? (
                      <Input
                        type="number"
                        value={value}
                        onChange={(e) => setExtraFields((prev) => ({ ...prev, [key]: e.target.value ? Number(e.target.value) : 0 }))}
                        className="text-xs h-7 flex-1"
                      />
                    ) : (
                      <Input
                        value={String(value ?? "")}
                        onChange={(e) => setExtraFields((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="text-xs h-7 flex-1"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setExtraFields((prev) => {
                        const next = { ...prev };
                        delete next[key];
                        return next;
                      })}
                      className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))] text-xs shrink-0"
                      title="Remove"
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Visited + Personal rating row */}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Visited</label>
              <button
                type="button"
                onClick={() => setVisited(!visited)}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  visited
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))]"
                }`}
              >
                {visited ? "✅ Visited" : "Not visited"}
              </button>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Personal rating</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setPersonalRating(personalRating === star ? null : star)}
                    className={`text-lg transition-colors ${
                      star <= (personalRating ?? 0)
                        ? "text-amber-400"
                        : "text-gray-300 hover:text-amber-200"
                    }`}
                  >
                    ★
                  </button>
                ))}
                {personalRating != null && (
                  <button
                    type="button"
                    onClick={() => setPersonalRating(null)}
                    className="ml-1 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  >
                    clear
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center mt-6 pt-4 border-t border-[hsl(var(--border))]">
          {poi.hasOriginalData && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
              onClick={handleReset}
              disabled={saving || resetting}
            >
              {resetting ? "Restoring..." : "Reset to original"}
            </Button>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving || resetting}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving || resetting}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
