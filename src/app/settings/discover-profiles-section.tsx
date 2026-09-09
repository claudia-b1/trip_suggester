"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  RECOMMENDABLE_CATEGORIES,
  CATEGORY_LABELS,
  type RecommendableCategory,
} from "@/lib/recommendations";
import { CATEGORY_STYLES } from "@/lib/categories";
import { SUBCATEGORIES } from "@/lib/recommendations/subcategories";

const CATEGORY_ICONS: Record<RecommendableCategory, string> = {
  CULTURE: "🏛️",
  FOOD: "🍽️",
  NATURE: "🌳",
  ENTERTAINMENT: "🎡",
  NIGHTLIFE: "🌃",
  SHOPPING: "🛍️",
  GROCERIES: "🛒",
  WELLNESS: "🧘",
  OUTDOORS: "🚴",
};

const DEFAULT_COUNTS: Record<RecommendableCategory, number> = {
  CULTURE: 20,
  FOOD: 10,
  NATURE: 10,
  ENTERTAINMENT: 10,
  NIGHTLIFE: 10,
  SHOPPING: 10,
  GROCERIES: 10,
  WELLNESS: 10,
  OUTDOORS: 10,
};

type DiscoverProfileDTO = {
  id: number;
  name: string;
  categories: string[];
  counts: Record<string, number>;
  subcats: Record<string, string[]>;
  isDefault: boolean;
  order: number;
  createdAt: string;
};

type EditorState = {
  id: number | null; // null = create new
  name: string;
  categories: Set<RecommendableCategory>;
  counts: Record<RecommendableCategory, number>;
  subcats: Record<RecommendableCategory, Set<string>>;
  isDefault: boolean;
  expandedCats: Set<RecommendableCategory>;
};

function newEditorState(): EditorState {
  return {
    id: null,
    name: "",
    categories: new Set(),
    counts: { ...DEFAULT_COUNTS },
    subcats: Object.fromEntries(
      RECOMMENDABLE_CATEGORIES.map((c) => [
        c,
        new Set(SUBCATEGORIES[c].filter((s) => !s.manualOnly).map((s) => s.id)),
      ]),
    ) as Record<RecommendableCategory, Set<string>>,
    isDefault: false,
    expandedCats: new Set(),
  };
}

function profileToEditor(p: DiscoverProfileDTO): EditorState {
  const subcats = Object.fromEntries(
    RECOMMENDABLE_CATEGORIES.map((c) => [
      c,
      p.subcats[c]
        ? new Set(p.subcats[c].filter((id) =>
            SUBCATEGORIES[c].some((s) => s.id === id),
          ))
        : new Set(SUBCATEGORIES[c].filter((s) => !s.manualOnly).map((s) => s.id)),
    ]),
  ) as Record<RecommendableCategory, Set<string>>;

  const counts = { ...DEFAULT_COUNTS };
  for (const [cat, count] of Object.entries(p.counts)) {
    if (cat in counts) counts[cat as RecommendableCategory] = count;
  }

  return {
    id: p.id,
    name: p.name,
    categories: new Set(
      p.categories.filter((c): c is RecommendableCategory =>
        RECOMMENDABLE_CATEGORIES.includes(c as RecommendableCategory),
      ),
    ),
    counts,
    subcats,
    isDefault: p.isDefault,
    expandedCats: new Set(),
  };
}

export function DiscoverProfilesSection() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [profiles, setProfiles] = useState<DiscoverProfileDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch("/api/discover-profiles");
      if (res.ok) setProfiles(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchProfiles(); }, [fetchProfiles]);

  async function handleSave() {
    if (!editor) return;
    if (!editor.name.trim()) {
      toast("Profile name is required", { variant: "error" });
      return;
    }
    if (editor.categories.size === 0) {
      toast("Select at least one category", { variant: "error" });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: editor.name.trim(),
        categories: Array.from(editor.categories),
        counts: Object.fromEntries(
          Array.from(editor.categories).map((c) => [c, editor.counts[c]]),
        ),
        subcats: Object.fromEntries(
          Array.from(editor.categories).map((c) => [c, Array.from(editor.subcats[c])]),
        ),
        isDefault: editor.isDefault,
      };

      const isCreate = editor.id === null;
      const url = isCreate
        ? "/api/discover-profiles"
        : `/api/discover-profiles/${editor.id}`;
      const method = isCreate ? "POST" : "PATCH";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to save" }));
        throw new Error(err.error || "Failed to save");
      }

      toast(isCreate ? "Profile created" : "Profile updated");
      setEditor(null);
      await fetchProfiles();
    } catch (err) {
      console.error("Profile save error:", err);
      toast(err instanceof Error ? err.message : "Failed to save", { variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p: DiscoverProfileDTO) {
    const ok = await confirm({ message: `Delete profile "${p.name}"?`, variant: "destructive" });
    if (!ok) return;

    try {
      const res = await fetch(`/api/discover-profiles/${p.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("Failed to delete");
      toast("Profile deleted");
      if (editor?.id === p.id) setEditor(null);
      await fetchProfiles();
    } catch {
      toast("Failed to delete", { variant: "error" });
    }
  }

  async function handleToggleDefault(p: DiscoverProfileDTO) {
    try {
      const newDefault = !p.isDefault;
      const res = await fetch(`/api/discover-profiles/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: newDefault }),
      });
      if (!res.ok) throw new Error();
      toast(newDefault ? `"${p.name}" set as default` : "Default cleared");
      await fetchProfiles();
    } catch {
      toast("Failed to update", { variant: "error" });
    }
  }

  function toggleCat(cat: RecommendableCategory) {
    if (!editor) return;
    setEditor((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.categories);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return { ...prev, categories: next };
    });
  }

  function toggleSubcat(cat: RecommendableCategory, id: string) {
    if (!editor) return;
    setEditor((prev) => {
      if (!prev) return prev;
      const current = new Set(prev.subcats[cat]);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return { ...prev, subcats: { ...prev.subcats, [cat]: current } };
    });
  }

  function setCount(cat: RecommendableCategory, val: number) {
    if (!editor) return;
    setEditor((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        counts: { ...prev.counts, [cat]: Math.max(1, Math.min(100, val || 1)) },
      };
    });
  }

  function toggleExpandCat(cat: RecommendableCategory) {
    if (!editor) return;
    setEditor((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.expandedCats);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return { ...prev, expandedCats: next };
    });
  }

  return (
    <Card className="mx-auto max-w-[600px]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Discover Profiles</CardTitle>
          {!editor && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setEditor(newEditorState())}
            >
              + New profile
            </Button>
          )}
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Save category presets for the Discover panel
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Loading state */}
        {loading && (
          <div className="h-16 animate-pulse rounded-lg bg-[hsl(var(--muted))]" />
        )}

        {/* Profile list */}
        {!loading && profiles.length === 0 && !editor && (
          <p className="text-sm text-[hsl(var(--muted-foreground))] italic">
            No profiles yet. Create one to save your favourite Discover settings.
          </p>
        )}

        {!loading &&
          profiles.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                editor?.id === p.id
                  ? "border-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/5"
                  : "border-[hsl(var(--border))]"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{p.name}</span>
                  {p.isDefault && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      default
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {p.categories.map((cat) => {
                    const styles = CATEGORY_STYLES[cat as RecommendableCategory];
                    return (
                      <span
                        key={cat}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${styles?.badge ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {CATEGORY_ICONS[cat as RecommendableCategory]} {CATEGORY_LABELS[cat as RecommendableCategory]}
                        <span className="opacity-60">({p.counts[cat] ?? "?"})</span>
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleToggleDefault(p)}
                  className={`p-1 text-sm transition-colors ${
                    p.isDefault ? "text-amber-500" : "text-gray-300 hover:text-amber-400"
                  }`}
                  title={p.isDefault ? "Remove as default" : "Set as default"}
                >
                  ★
                </button>
                <button
                  type="button"
                  onClick={() => setEditor(profileToEditor(p))}
                  className="p-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  title="Edit"
                >
                  ✏️
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(p)}
                  className="p-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}

        {/* Editor */}
        {editor && (
          <div className="space-y-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {editor.id === null ? "New Profile" : "Edit Profile"}
              </h3>
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] text-sm"
              >
                ✕
              </button>
            </div>

            {/* Name */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                Profile name
              </label>
              <Input
                value={editor.name}
                onChange={(e) =>
                  setEditor((prev) => prev && { ...prev, name: e.target.value })
                }
                placeholder="e.g. City Explorer, Food Tour, Nature Trip"
                className="text-sm"
              />
            </div>

            {/* Default checkbox */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={editor.isDefault}
                onChange={(e) =>
                  setEditor((prev) => prev && { ...prev, isDefault: e.target.checked })
                }
                className="rounded border-[hsl(var(--border))]"
              />
              Set as default profile
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                (auto-loads in Discover)
              </span>
            </label>

            {/* Category pills */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Categories
              </p>
              <div className="flex flex-wrap gap-1.5">
                {RECOMMENDABLE_CATEGORIES.map((cat) => {
                  const active = editor.categories.has(cat);
                  const styles = CATEGORY_STYLES[cat];
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleCat(cat)}
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        active
                          ? `${styles.badge} border-transparent ring-1 ring-[hsl(var(--primary))]/20`
                          : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-50 hover:opacity-80"
                      }`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: active ? styles.dot : "#9ca3af" }}
                      />
                      {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Per-category config (counts + subcategories) */}
            {RECOMMENDABLE_CATEGORIES.filter((c) => editor.categories.has(c)).map(
              (cat) => {
                const styles = CATEGORY_STYLES[cat];
                const catSubcats = SUBCATEGORIES[cat].filter((s) => !s.manualOnly);
                const selectedSubs = editor.subcats[cat];
                const isExpanded = editor.expandedCats.has(cat);

                return (
                  <div
                    key={cat}
                    className="space-y-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-2.5"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm">{CATEGORY_ICONS[cat]}</span>
                      <span className="text-xs font-semibold">
                        {CATEGORY_LABELS[cat]}
                      </span>
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                        max:
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={editor.counts[cat]}
                        onChange={(e) => setCount(cat, Number(e.target.value))}
                        className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                      />
                      {catSubcats.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleExpandCat(cat)}
                          className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                        >
                          {isExpanded ? "▼" : "▶"} subcategories
                          {selectedSubs.size < catSubcats.length && (
                            <span className="ml-1 text-amber-600">
                              ({selectedSubs.size}/{catSubcats.length})
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                    {isExpanded && catSubcats.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {catSubcats.map((sub) => {
                          const subActive = selectedSubs.has(sub.id);
                          return (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() => toggleSubcat(cat, sub.id)}
                              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                subActive
                                  ? `${styles.badge} border-transparent`
                                  : "border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:bg-[hsl(var(--muted))]"
                              }`}
                            >
                              <span className="text-[10px]">{sub.emoji}</span>
                              {sub.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              },
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-[hsl(var(--border))]">
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditor(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !editor.name.trim() || editor.categories.size === 0}
              >
                {saving
                  ? "Saving..."
                  : editor.id === null
                    ? "Create Profile"
                    : "Save Changes"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
