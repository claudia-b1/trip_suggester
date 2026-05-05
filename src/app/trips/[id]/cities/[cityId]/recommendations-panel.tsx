"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import {
  RECOMMENDABLE_CATEGORIES,
  type RecommendableCategory,
} from "@/lib/recommendations";
import { CATEGORY_STYLES } from "@/lib/categories";
import { SUBCATEGORIES } from "@/lib/recommendations/subcategories";

const CATEGORY_ICONS: Record<RecommendableCategory, string> = {
  CULTURE: "🏛️",
  FOOD: "🍽️",
  NATURE: "🌿",
  NIGHTLIFE: "🌙",
  OUTDOORS: "🏔️",
};

const CATEGORY_DESCRIPTIONS: Record<RecommendableCategory, string> = {
  CULTURE: "Museums, landmarks, historic sites & galleries",
  FOOD: "Restaurants, cafés, street food & local cuisine",
  NATURE: "Parks, gardens, scenic viewpoints & wildlife",
  NIGHTLIFE: "Bars, clubs, live music & entertainment",
  OUTDOORS: "Hiking, beaches, adventure & sports",
};

const PREFERENCES = [
  { id: "kid_friendly", label: "👨‍👩‍👧 Kid-friendly" },
  { id: "budget_friendly", label: "💰 Budget-friendly" },
  { id: "highly_rated", label: "⭐ Highly rated" },
  { id: "off_beaten_track", label: "🗺️ Off the beaten track" },
  { id: "romantic", label: "💑 Romantic" },
  { id: "wheelchair_accessible", label: "♿ Accessible" },
  { id: "local_favourite", label: "🏠 Local favourite" },
  { id: "nearby_trips", label: "🚗 Nearby day trips" },
] as const;

type PreferenceId = (typeof PREFERENCES)[number]["id"];
type Failure = { category: RecommendableCategory; error: string };

export function RecommendationsPanel({ cityId, poisCount }: { cityId: number; poisCount: number }) {
  const router = useRouter();
  const { toast } = useToast();

  const [selected, setSelected] = useState<Set<RecommendableCategory>>(
    () => new Set(RECOMMENDABLE_CATEGORIES),
  );
  const [counts, setCounts] = useState<Record<RecommendableCategory, number>>(
    () =>
      Object.fromEntries(
        RECOMMENDABLE_CATEGORIES.map((c) => [c, 10]),
      ) as Record<RecommendableCategory, number>,
  );
  // Which subcategory IDs are toggled ON per category (empty = all)
  const [subcats, setSubcats] = useState<Record<RecommendableCategory, Set<string>>>(
    () =>
      Object.fromEntries(
        RECOMMENDABLE_CATEGORIES.map((c) => [c, new Set<string>()]),
      ) as Record<RecommendableCategory, Set<string>>,
  );
  // Which category rows have their subcategory panel expanded
  const [expanded, setExpanded] = useState<Set<RecommendableCategory>>(new Set());
  // Cuisine keyword filter for FOOD
  const [cuisineFilter, setCuisineFilter] = useState("");

  const [preferences, setPreferences] = useState<Set<PreferenceId>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    failures: Failure[];
  } | null>(null);
  // overwrite confirmation: null = not asked, "pending" = waiting for choice
  const [overwriteMode, setOverwriteMode] = useState<"pending" | null>(null);

  function toggleCat(cat: RecommendableCategory) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function toggleExpand(cat: RecommendableCategory) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function toggleSubcat(cat: RecommendableCategory, id: string) {
    setSubcats((prev) => {
      const current = new Set(prev[cat]);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return { ...prev, [cat]: current };
    });
  }

  function togglePref(id: PreferenceId) {
    setPreferences((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onGenerate() {
    if (selected.size === 0 || generating) return;
    // If there are existing POIs and we haven't asked yet, show the choice
    if (poisCount > 0 && overwriteMode === null) {
      setOverwriteMode("pending");
      return;
    }
    // No existing POIs — run directly (add mode)
    await runGenerate(false);
  }

  async function runGenerate(overwrite: boolean) {
    setOverwriteMode(null);
    if (selected.size === 0 || generating) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    setProgressStep("🔍 Discovering places…");

    // Build subcategories map: only include non-empty selections
    const subcategoriesPayload: Record<string, string[]> = {};
    for (const cat of selected) {
      const ids = Array.from(subcats[cat]);
      if (ids.length > 0) subcategoriesPayload[cat] = ids;
    }

    setProgressStep("📊 Scoring & ranking…");

    const res = await fetch(`/api/cities/${cityId}/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categories: Array.from(selected),
        counts: Object.fromEntries(
          Array.from(selected).map((c) => [c, counts[c]]),
        ),
        subcategories: subcategoriesPayload,
        cuisineFilter: cuisineFilter.trim() || undefined,
        preferences: Array.from(preferences).filter((p) => p !== "nearby_trips"),
        nearbyTrips: preferences.has("nearby_trips"),
        overwrite,
      }),
    });

    setProgressStep("✨ Enriching results…");

    setGenerating(false);
    setProgressStep(null);
    if (!res.ok) {
      const body: { error?: string } = await res.json().catch(() => ({}));
      const msg = body.error ?? "Failed to run Discover";
      setError(msg);
      toast(msg, { variant: "error" });
      return;
    }
    const body: { created: number; failures: Failure[] } = await res.json();
    setResult(body);
    toast(
      `Added ${body.created} POI${body.created === 1 ? "" : "s"}${
        body.failures.length > 0 ? ` · ${body.failures.length} failed` : ""
      }`,
    );
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle>🧭 Discover</CardTitle>
          <span className="group relative cursor-help text-[hsl(var(--muted-foreground))]">
            ⓘ
            <span className="pointer-events-none absolute right-0 top-6 z-20 w-64 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-xs leading-relaxed shadow-lg opacity-0 transition-opacity group-hover:opacity-100">
              Pulls from <strong>Geoapify Places</strong> (discovery) with enrichment via <strong>Wikidata</strong> &amp; <strong>Google Places</strong>. A rule-based engine ranks results by proximity, notability and category match.
            </span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Categories — compact pill row */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Categories
          </p>
          <div className="flex flex-wrap gap-1.5">
            {RECOMMENDABLE_CATEGORIES.map((cat) => {
              const active = selected.has(cat);
              const styles = CATEGORY_STYLES[cat];
              const selectedSubs = subcats[cat];
              const subDesc = selectedSubs.size > 0
                ? `${selectedSubs.size} filter${selectedSubs.size > 1 ? "s" : ""}`
                : CATEGORY_DESCRIPTIONS[cat];
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => !generating && toggleCat(cat)}
                  disabled={generating}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? `${styles.badge} border-transparent ring-1 ring-[hsl(var(--primary))]/20`
                      : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-50 hover:opacity-80"
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: active ? styles.dot : "#9ca3af" }} />
                  {CATEGORY_ICONS[cat]} {cat}
                  <span className="hidden sm:inline text-[10px] opacity-70">· {subDesc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Preferences — pill row (includes nearby trips) */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Preferences
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PREFERENCES.map((pref) => {
              const active = preferences.has(pref.id);
              return (
                <button
                  key={pref.id}
                  type="button"
                  onClick={() => togglePref(pref.id)}
                  disabled={generating}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    active
                      ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                      : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                  }`}
                >
                  {pref.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Advanced filters — single collapsible section */}
        <div>
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            <span className={`transition-transform ${advancedOpen ? "rotate-90" : ""}`}>▶</span>
            Advanced filters
            {Object.values(subcats).some((s) => s.size > 0) && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">active</span>
            )}
          </button>

          {advancedOpen && (
            <div className="mt-2 space-y-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3">
              {RECOMMENDABLE_CATEGORIES.map((cat) => {
                const active = selected.has(cat);
                if (!active) return null;
                const styles = CATEGORY_STYLES[cat];
                const catSubcats = SUBCATEGORIES[cat];
                const selectedSubs = subcats[cat];

                return (
                  <div key={cat} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{CATEGORY_ICONS[cat]}</span>
                      <span className="text-xs font-semibold">{cat}</span>
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                        max:
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={counts[cat]}
                        onChange={(e) =>
                          setCounts((prev) => ({
                            ...prev,
                            [cat]: Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                          }))
                        }
                        disabled={generating}
                        className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs disabled:opacity-40"
                      />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {catSubcats.map((sub) => {
                        const subActive = selectedSubs.has(sub.id);
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            onClick={() => toggleSubcat(cat, sub.id)}
                            disabled={generating}
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

                    {/* Cuisine keyword input — only for FOOD */}
                    {cat === "FOOD" && (
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-[hsl(var(--muted-foreground))] shrink-0">
                          Cuisine:
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. italian, thai, sushi…"
                          value={cuisineFilter}
                          onChange={(e) => setCuisineFilter(e.target.value)}
                          disabled={generating}
                          className="flex-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-0.5 text-xs disabled:opacity-40"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {selected.size === 0 && (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Select at least one category above.</p>
              )}
            </div>
          )}
        </div>

        {/* Action row — centered 1/3 width button */}
        <div className="flex flex-col items-center gap-2">

          {/* Overwrite / Add confirmation prompt */}
          {overwriteMode === "pending" && (
            <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">
                ⚠️ You already have {poisCount} POI{poisCount === 1 ? "" : "s"} in this city. What would you like to do?
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => runGenerate(false)}
                  className="flex-1 text-xs"
                >
                  ➕ Add to list
                </Button>
                <Button
                  type="button"
                  onClick={() => runGenerate(true)}
                  className="flex-1 text-xs bg-red-600 hover:bg-red-700"
                >
                  🗑️ Overwrite all
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOverwriteMode(null)}
                  className="text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <Button
            type="button"
            onClick={onGenerate}
            disabled={generating || selected.size === 0}
            className="w-1/3 min-w-[180px]"
          >
            {generating && <span className="spinner mr-1.5" />}
            {generating ? "Discovering…" : `🔍 Discover places`}
          </Button>

          {/* Progress steps */}
          {generating && progressStep && (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--primary))] animate-pulse">
              <span className="spinner" />
              {progressStep}
            </div>
          )}

          {error && <span className="text-sm text-red-600">{error}</span>}

          {/* Result summary card */}
          {result && !error && (
            <div className="w-full rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                ✅ Added {result.created} POI{result.created === 1 ? "" : "s"} to your collection
              </p>
              {result.failures.length > 0 && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  ⚠️ {result.failures.length} categor{result.failures.length === 1 ? "y" : "ies"} had issues
                </p>
              )}
            </div>
          )}
        </div>

        {result && result.failures.length > 0 && (
          <ul className="text-xs text-red-600">
            {result.failures.map((f) => (
              <li key={f.category}>
                {f.category}: {f.error}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}