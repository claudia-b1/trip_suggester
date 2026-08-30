"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS, type Category } from "@/lib/categories";
import { SUBCATEGORIES, type SubcategoryDef } from "@/lib/recommendations/subcategories";
import { ACCOMMODATION_SUBCATEGORIES } from "@/lib/favourite-fields";
import type { RecommendableCategory } from "@/lib/recommendations";
import { resizeImageFile } from "@/lib/resize-image";

/** Get subcategory options for a given category */
function getSubcategoryOptions(cat: string): { id: string; label: string; emoji: string }[] {
  if (cat === "ACCOMMODATION") {
    return ACCOMMODATION_SUBCATEGORIES;
  }
  if (cat in SUBCATEGORIES) {
    return (SUBCATEGORIES[cat as RecommendableCategory] as SubcategoryDef[]).map((s) => ({
      id: s.id,
      label: s.label,
      emoji: s.emoji,
    }));
  }
  // FUEL and any unknown categories have no predefined subcategories
  return [];
}

export type EditPoiData = {
  id: number;
  name: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  website: string | null;
  phoneNumber: string | null;
  openingHours: string | null;
  photoUrl: string | null;
  priceLevel: number | null;
  fee: string | null;
  tips: string | null;
  bestTimeToVisit: string | null;
  estimatedDurationMinutes: number | null;
  hasOriginalData?: boolean;
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
  const [tips, setTips] = useState(poi.tips ?? "");
  const [bestTimeToVisit, setBestTimeToVisit] = useState(poi.bestTimeToVisit ?? "");
  const [estimatedDuration, setEstimatedDuration] = useState<number | null>(poi.estimatedDurationMinutes);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

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

  async function handleSave() {
    if (!name.trim()) {
      toast("Name is required", { variant: "error" });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      // Only send changed fields
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
      if ((tips || null) !== poi.tips) body.tips = tips || null;
      if ((bestTimeToVisit || null) !== poi.bestTimeToVisit) body.bestTimeToVisit = bestTimeToVisit || null;
      if (estimatedDuration !== poi.estimatedDurationMinutes) body.estimatedDurationMinutes = estimatedDuration;

      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }

      const res = await fetch(`/api/pois/${poi.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save");
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
          <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-2 gap-3">
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

          {/* Price level + Fee + Duration row */}
          <div className="grid grid-cols-3 gap-3">
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
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Duration (min)</label>
              <Input
                type="number"
                value={estimatedDuration ?? ""}
                onChange={(e) => setEstimatedDuration(e.target.value ? Number(e.target.value) : null)}
                className="text-sm"
              />
            </div>
          </div>

          {/* Best time + Tips */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Best time</label>
              <select
                value={bestTimeToVisit}
                onChange={(e) => setBestTimeToVisit(e.target.value)}
                className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Tips</label>
              <Input value={tips} onChange={(e) => setTips(e.target.value)} className="text-sm" />
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
