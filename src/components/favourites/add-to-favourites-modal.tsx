"use client";

import { useState, useEffect, useMemo } from "react";
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

/* ── Subcategory lookup helper ─────────────────────────────────────────── */

function getSubcatsForCategory(cat: string): { id: string; label: string; emoji: string }[] {
  if (cat === "ACCOMMODATION") return ACCOMMODATION_SUBCATEGORIES;
  return (SUBCATEGORIES as Record<string, { id: string; label: string; emoji: string }[]>)[cat] ?? [];
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
  const [coords, setCoords] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const [extraFields, setExtraFields] = useState<Record<string, unknown>>({});
  const [listId, setListId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [showCreateList, setShowCreateList] = useState(false);
  const [newListName, setNewListName] = useState("");

  // Reset form when prefill/edit item changes
  useEffect(() => {
    if (editModalItem) {
      setName(editModalItem.name);
      setCategory(isCategory(editModalItem.category) ? editModalItem.category : "CULTURE");
      setSubcategory(editModalItem.subcategory ?? "");
      setCountry(editModalItem.country);
      setCity(editModalItem.city);
      setLatitude(editModalItem.latitude);
      setLongitude(editModalItem.longitude);
      setCoords(editModalItem.latitude && editModalItem.longitude ? `${editModalItem.latitude}, ${editModalItem.longitude}` : "");
      setDescription(editModalItem.description ?? "");
      setWebsite(editModalItem.website ?? "");
      setNotes(editModalItem.notes ?? "");
      setExtraFields((editModalItem.extraFields as Record<string, unknown>) ?? {});
      setListId(editModalItem.listId);
      setShowCreateList(false);
      setNewListName("");
    } else if (addModalPrefill) {
      setName(addModalPrefill.name ?? "");
      setCategory(addModalPrefill.category ?? "CULTURE");
      setSubcategory(addModalPrefill.subcategory ?? "");
      setCountry(addModalPrefill.country ?? "");
      setCity(addModalPrefill.city ?? "");
      setLatitude(addModalPrefill.latitude ?? null);
      setLongitude(addModalPrefill.longitude ?? null);
      setCoords(addModalPrefill.latitude && addModalPrefill.longitude ? `${addModalPrefill.latitude}, ${addModalPrefill.longitude}` : "");
      setDescription(addModalPrefill.description ?? "");
      setWebsite(addModalPrefill.website ?? "");
      setNotes("");
      setExtraFields(addModalPrefill.extraFields ?? {});
      setShowCreateList(false);
      setNewListName("");
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

  // Parse coordinates from text input
  function handleCoordsChange(val: string) {
    setCoords(val);
    const match = val.match(/^\s*(-?\d+\.?\d*)\s*[,;\s]\s*(-?\d+\.?\d*)\s*$/);
    if (match) {
      setLatitude(parseFloat(match[1]));
      setLongitude(parseFloat(match[2]));
    }
  }

  function copyCoords() {
    if (latitude != null && longitude != null) {
      navigator.clipboard.writeText(`${latitude}, ${longitude}`);
      toast("Coordinates copied!");
    }
  }

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
        latitude: latitude ?? 0,
        longitude: longitude ?? 0,
        description: description || null,
        notes: notes || null,
        website: website || null,
        extraFields: cleanExtraFields(extraFields),
        listId: targetListId,
        ...(isEditMode ? {} : {
          photoUrl: addModalPrefill?.photoUrl || null,
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
          // Edit mode: sync category/subcategory changes
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
          // New favourite: auto-POI was created server-side, trigger refresh
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
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">Name</label>
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

          {/* Country + City */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">Country *</label>
              <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} required className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">City *</label>
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} required className={inputCls} />
            </div>
          </div>

          {/* Coordinates */}
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">
              Coordinates <span className="text-[hsl(var(--muted-foreground))]">(lat, lng — paste or type)</span>
            </label>
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
          </div>

          {/* Website */}
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground))]">
              Website <span className="text-[hsl(var(--muted-foreground))]">(optional)</span>
            </label>
            <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." className={inputCls} />
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
              disabled={saving || !name.trim() || !country.trim() || !city.trim() || (!isEditMode && !showCreateList && !listId)}
              className="rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
            >
              {saving ? "Saving..." : isEditMode ? "Save Changes" : "Save to Favourites"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
