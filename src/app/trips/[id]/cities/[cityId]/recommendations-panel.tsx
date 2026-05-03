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

const PREFERENCES = [
  { id: "kid_friendly", label: "👨‍👩‍👧 Kid-friendly" },
  { id: "budget_friendly", label: "💰 Budget-friendly" },
  { id: "highly_rated", label: "⭐ Highly rated" },
  { id: "off_beaten_track", label: "🗺️ Off the beaten track" },
  { id: "romantic", label: "💑 Romantic" },
  { id: "wheelchair_accessible", label: "♿ Accessible" },
  { id: "local_favourite", label: "🏠 Local favourite" },
] as const;

type PreferenceId = (typeof PREFERENCES)[number]["id"];
type Failure = { category: RecommendableCategory; error: string };

export function RecommendationsPanel({ cityId }: { cityId: number }) {
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
  const [nearbyTrips, setNearbyTrips] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    failures: Failure[];
  } | null>(null);

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
    setGenerating(true);
    setError(null);
    setResult(null);

    // Build subcategories map: only include non-empty selections
    const subcategoriesPayload: Record<string, string[]> = {};
    for (const cat of selected) {
      const ids = Array.from(subcats[cat]);
      if (ids.length > 0) subcategoriesPayload[cat] = ids;
    }

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
        preferences: Array.from(preferences),
        nearbyTrips,
      }),
    });
    setGenerating(false);
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
      <CardHeader>
        <CardTitle>Discover</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Source attribution */}
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Pulls from{" "}
          <span className="font-medium text-[hsl(var(--foreground))]">Geoapify Places</span>{" "}
          (discovery) with enrichment via{" "}
          <span className="font-medium text-[hsl(var(--foreground))]">Wikidata</span>{" "}
          &amp;{" "}
          <span className="font-medium text-[hsl(var(--foreground))]">Google Places</span>.
          A rule-based engine ranks results by proximity, notability and category match.
        </p>

        {/* Preferences */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
            Preferences
          </p>
          <div className="flex flex-wrap gap-2">
            {PREFERENCES.map((pref) => {
              const active = preferences.has(pref.id);
              return (
                <button
                  key={pref.id}
                  type="button"
                  onClick={() => togglePref(pref.id)}
                  disabled={generating}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
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

        {/* Categories + subcategories + per-category count */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Categories
            </p>
            <button
              type="button"
              onClick={() => {
                if (selected.size === RECOMMENDABLE_CATEGORIES.length) {
                  setSelected(new Set());
                } else {
                  setSelected(new Set(RECOMMENDABLE_CATEGORIES));
                }
              }}
              disabled={generating}
              className="text-xs text-[hsl(var(--primary))] hover:underline disabled:opacity-40"
            >
              {selected.size === RECOMMENDABLE_CATEGORIES.length ? "Deselect all" : "Select all"}
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {RECOMMENDABLE_CATEGORIES.map((cat) => {
              const active = selected.has(cat);
              const isExpanded = expanded.has(cat);
              const styles = CATEGORY_STYLES[cat];
              const catSubcats = SUBCATEGORIES[cat];
              const selectedSubs = subcats[cat];
              const hasSubcatSelection = selectedSubs.size > 0;

              return (
                <div key={cat}>
                  {/* Main row: category pill | filter icon */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleCat(cat)}
                      disabled={generating}
                      className={`flex w-40 shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                        active
                          ? `${styles.badge} border-transparent`
                          : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-50"
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: active ? styles.dot : "#9ca3af" }}
                      />
                      {CATEGORY_ICONS[cat]} {cat}
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleExpand(cat)}
                      disabled={!active || generating}
                      title={isExpanded ? "Hide filters" : "Show filters"}
                      className={`relative flex items-center justify-center rounded-md border p-1.5 transition-colors disabled:opacity-30 ${
                        isExpanded
                          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                          : hasSubcatSelection
                          ? "border-amber-400 bg-amber-50 text-amber-700"
                          : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                      }`}
                    >
                      {/* Funnel / filter icon */}
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                      </svg>
                      {hasSubcatSelection && !isExpanded && (
                        <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-white">
                          {selectedSubs.size}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Subcategory chips — shown when expanded */}
                  {isExpanded && active && (
                    <div className="ml-2 mt-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-3 space-y-3">
                      {/* Result limit */}
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">Max results:</label>
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
                          className="w-16 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-0.5 text-sm disabled:opacity-40"
                        />
                      </div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                        Include only · leave all unselected to include everything
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {catSubcats.map((sub) => {
                          const subActive = selectedSubs.has(sub.id);
                          return (
                            <button
                              key={sub.id}
                              type="button"
                              onClick={() => toggleSubcat(cat, sub.id)}
                              disabled={generating}
                              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                subActive
                                  ? `${styles.badge} border-transparent`
                                  : "border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:bg-[hsl(var(--muted))]"
                              }`}
                            >
                              <span className="text-[11px]">{sub.emoji}</span>
                              {sub.label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Cuisine keyword input — only for FOOD */}
                      {cat === "FOOD" && (
                        <div className="flex items-center gap-2 pt-1">
                          <label className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">
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
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Nearby day trips toggle */}
        <button
          type="button"
          onClick={() => setNearbyTrips((v) => !v)}
          disabled={generating}
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
            nearbyTrips
              ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
              : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
          }`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full border-2 transition-colors ${
              nearbyTrips
                ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]"
                : "border-gray-400"
            }`}
          />
          🚗 Include nearby day trips
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            (renders driving routes on map)
          </span>
        </button>

        {/* Action row */}
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            type="button"
            onClick={onGenerate}
            disabled={generating || selected.size === 0}
          >
            {generating ? `Discovering ${selected.size}…` : "Run Discover"}
          </Button>
          {error && <span className="text-sm text-red-600">{error}</span>}
          {result && !error && (
            <span className="text-sm text-[hsl(var(--muted-foreground))]">
              Added {result.created} POI{result.created === 1 ? "" : "s"}
              {result.failures.length > 0 ? ` · ${result.failures.length} failed` : ""}
            </span>
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