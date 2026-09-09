"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import {
  RECOMMENDABLE_CATEGORIES,
  CATEGORY_LABELS,
  type RecommendableCategory,
} from "@/lib/recommendations";
import { CATEGORY_STYLES } from "@/lib/categories";
import { SUBCATEGORIES } from "@/lib/recommendations/subcategories";

const CATEGORY_ICONS: Record<RecommendableCategory, string> = {
  CULTURE:    "🏛️",
  FOOD:       "🍽️",
  NATURE:     "🌳",
  ENTERTAINMENT: "🎡",
  NIGHTLIFE:  "🌃",
  SHOPPING:   "🛍️",
  GROCERIES:  "🛒",
  WELLNESS:   "🧘",
  OUTDOORS:   "🚴",
};

const DEFAULT_COUNTS: Record<RecommendableCategory, number> = {
  CULTURE:    20,
  FOOD:       10,
  NATURE:     10,
  ENTERTAINMENT: 10,
  NIGHTLIFE:  10,
  SHOPPING:   10,
  GROCERIES:  10,
  WELLNESS:   10,
  OUTDOORS:   10,
};

const PREFERENCES = [
  { id: "kid_friendly", label: "👨‍👩‍👧 Kid-friendly" },
  { id: "budget_friendly", label: "💰 Budget-friendly" },
  { id: "highly_rated", label: "⭐ Highly rated" },
  { id: "off_beaten_track", label: "🗺️ Off the beaten track" },
  { id: "romantic", label: "💑 Romantic" },
  { id: "wheelchair_accessible", label: "♿ Accessible" },
  { id: "local_favourite", label: "🏠 Local favourite" },
  // Nearby day trips moved to AI Recommendations section
  // { id: "nearby_trips", label: "🚗 Nearby day trips" },
] as const;

type PreferenceId = (typeof PREFERENCES)[number]["id"];
type Failure = { category: RecommendableCategory; error: string };

export function RecommendationsPanel({
  tripId,
  cityId,
  poisCount,
  radiusKm,
  onRadiusChange,
  nearbyEnabled,
  onNearbyEnabledChange,
  nearbyRadiusKm,
  onNearbyRadiusChange,
  onNearbyRan,
}: {
  tripId: number;
  cityId: number;
  poisCount: number;
  radiusKm: number;
  onRadiusChange: (km: number) => void;
  nearbyEnabled: boolean;
  onNearbyEnabledChange: (v: boolean) => void;
  nearbyRadiusKm: number;
  onNearbyRadiusChange: (km: number) => void;
  /** Called after a successful discover run that included nearby search. */
  onNearbyRan?: (km: number) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [selected, setSelected] = useState<Set<RecommendableCategory>>(
    () => new Set(),
  );
  const [counts, setCounts] = useState<Record<RecommendableCategory, number>>(
    () => ({ ...DEFAULT_COUNTS }),
  );
  // Which subcategory IDs are selected per category (all discoverable ones pre-selected;
  // manualOnly subcategories are excluded — they have no Geoapify tags)
  const [subcats, setSubcats] = useState<Record<RecommendableCategory, Set<string>>>(
    () =>
      Object.fromEntries(
        RECOMMENDABLE_CATEGORIES.map((c) => [
          c,
          new Set(SUBCATEGORIES[c].filter((s) => !s.manualOnly).map((s) => s.id)),
        ]),
      ) as Record<RecommendableCategory, Set<string>>,
  );
  // Which category rows have their subcategory panel expanded
  const [expanded, setExpanded] = useState<Set<RecommendableCategory>>(new Set());
  // Cuisine keyword filter for FOOD
  const [cuisineFilter, setCuisineFilter] = useState("");

  const [preferences, setPreferences] = useState<Set<PreferenceId>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    failures: Failure[];
  } | null>(null);
  // overwrite confirmation: null = not asked, "pending" = waiting for choice
  const [overwriteMode, setOverwriteMode] = useState<"pending" | null>(null);

  // Abort controller for cancelling in-flight discover requests
  const abortRef = useRef<AbortController | null>(null);

  function cancelDiscover() {
    abortRef.current?.abort();
    abortRef.current = null;
    setGenerating(false);
    setProgressStep(null);
    toast("Discovery cancelled");
  }

  // ── Discover profiles ───────────────────────────────────────────────────
  type DiscoverProfileDTO = {
    id: number;
    name: string;
    categories: string[];
    counts: Record<string, number>;
    subcats: Record<string, string[]>;
    isDefault: boolean;
  };

  const [profiles, setProfiles] = useState<DiscoverProfileDTO[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const profilesFetched = useRef(false);

  const applyProfile = useCallback((p: DiscoverProfileDTO) => {
    // Set selected categories
    setSelected(
      new Set(
        p.categories.filter((c): c is RecommendableCategory =>
          RECOMMENDABLE_CATEGORIES.includes(c as RecommendableCategory),
        ),
      ),
    );

    // Merge counts with defaults
    const newCounts = { ...DEFAULT_COUNTS };
    for (const [cat, count] of Object.entries(p.counts)) {
      if (cat in newCounts) newCounts[cat as RecommendableCategory] = count;
    }
    setCounts(newCounts);

    // Apply subcategory selections (filter out stale IDs)
    const newSubcats = Object.fromEntries(
      RECOMMENDABLE_CATEGORIES.map((c) => {
        if (p.subcats[c]) {
          const validIds = p.subcats[c].filter((id) =>
            SUBCATEGORIES[c].some((s) => s.id === id),
          );
          return [c, new Set(validIds)];
        }
        // Not in profile — use all discoverable
        return [
          c,
          new Set(SUBCATEGORIES[c].filter((s) => !s.manualOnly).map((s) => s.id)),
        ];
      }),
    ) as Record<RecommendableCategory, Set<string>>;
    setSubcats(newSubcats);
    setSelectedProfileId(p.id);
  }, []);

  // Fetch profiles when Discover opens for the first time
  useEffect(() => {
    if (!discoverOpen || profilesFetched.current) return;
    profilesFetched.current = true;

    fetch("/api/discover-profiles")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: DiscoverProfileDTO[]) => {
        setProfiles(data);
        // Auto-load default profile (only if no categories are manually selected yet)
        const defaultProfile = data.find((p) => p.isDefault);
        if (defaultProfile && selected.size === 0) {
          applyProfile(defaultProfile);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoverOpen]);

  function handleProfileChange(profileId: string) {
    if (!profileId) {
      setSelectedProfileId(null);
      return;
    }
    const p = profiles.find((pr) => pr.id === Number(profileId));
    if (p) applyProfile(p);
  }

  function toggleCat(cat: RecommendableCategory) {
    setSelectedProfileId(null); // manual change diverges from profile
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
    setSelectedProfileId(null); // manual change diverges from profile
    setSubcats((prev) => {
      const current = new Set(prev[cat]);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return { ...prev, [cat]: current };
    });
  }

  // togglePref removed from UI for now — preferences plumbing kept for future use

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

    // Create a new AbortController for this request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setGenerating(true);
    setError(null);
    setResult(null);
    setProgressStep("🔍 Discovering places…");

    // Build subcategories map: only include discoverable subcategories (not manualOnly),
    // and only when a subset is selected (some deselected)
    const subcategoriesPayload: Record<string, string[]> = {};
    for (const cat of selected) {
      const discoverableIds = SUBCATEGORIES[cat].filter((s) => !s.manualOnly).map((s) => s.id);
      const selectedIds = Array.from(subcats[cat]).filter((id) => discoverableIds.includes(id));
      // Only send to API when fewer than all discoverable subcategories are selected
      if (selectedIds.length < discoverableIds.length) {
        subcategoriesPayload[cat] = selectedIds;
      }
    }

    setProgressStep("📊 Scoring & ranking…");

    try {
      const res = await fetch(`/api/cities/${cityId}/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          categories: Array.from(selected),
          counts: Object.fromEntries(
            Array.from(selected).map((c) => [c, counts[c]]),
          ),
          subcategories: subcategoriesPayload,
          cuisineFilter: cuisineFilter.trim() || undefined,
          preferences: Array.from(preferences),
          nearbyTrips: false,
          overwrite,
          radiusKm,
          nearbyEnabled,
          nearbyRadiusKm: nearbyEnabled ? nearbyRadiusKm : undefined,
        }),
      });

      setProgressStep("✨ Enriching results…");

      setGenerating(false);
      setProgressStep(null);
      abortRef.current = null;

      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}));
        const msg = body.error ?? "Failed to run Discover";
        setError(msg);
        toast(msg, { variant: "error" });
        return;
      }
      const body: { created: number; failures: Failure[] } = await res.json();
      setResult(body);
      if (nearbyEnabled) onNearbyRan?.(nearbyRadiusKm);
      // Persist the discover radius to the database (best-effort)
      fetch(`/api/trips/${tripId}/cities/${cityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discoverRadiusKm: radiusKm }),
      }).catch(() => {/* best-effort */});
      toast(
        `Added ${body.created} POI${body.created === 1 ? "" : "s"}${
          body.failures.length > 0 ? ` · ${body.failures.length} failed` : ""
        }`,
      );
      router.refresh();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Cancelled by user — state already cleaned up in cancelDiscover()
        return;
      }
      setGenerating(false);
      setProgressStep(null);
      abortRef.current = null;
      const msg = err instanceof Error ? err.message : "Failed to run Discover";
      setError(msg);
      toast(msg, { variant: "error" });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setDiscoverOpen((v) => !v)}
          className="flex w-full items-center justify-between"
        >
          <CardTitle className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 text-[hsl(var(--muted-foreground))] transition-transform ${discoverOpen ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            🧭 Discover
          </CardTitle>
          <span className="group relative cursor-help text-[hsl(var(--muted-foreground))]" tabIndex={0} role="button" onClick={(e) => e.stopPropagation()}>
            ⓘ
            <span className="pointer-events-none absolute right-0 top-6 z-20 w-64 max-w-[80vw] rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-xs leading-relaxed shadow-lg opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              Pulls from <strong>Geoapify Places</strong> (discovery) with enrichment via <strong>Wikidata</strong> &amp; <strong>Google Places</strong>. A rule-based engine ranks results by proximity, notability and category match.
            </span>
          </span>
        </button>
      </CardHeader>
      {discoverOpen && <CardContent className="space-y-4">
        {/* Profile selector */}
        {profiles.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Profile
            </p>
            <select
              value={selectedProfileId ?? ""}
              onChange={(e) => handleProfileChange(e.target.value)}
              disabled={generating}
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm disabled:opacity-40"
            >
              <option value="">— Custom —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.isDefault ? " ★" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

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
              const catSubDefs = SUBCATEGORIES[cat];
              const allSelected = selectedSubs.size >= catSubDefs.length;
              // When all are selected (default), show nothing; when some are deselected show what remains
              const subDesc = allSelected
                ? ""
                : catSubDefs.filter((s) => selectedSubs.has(s.id)).map((s) => s.label).join(", ");
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
                  {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
                  {subDesc && <span className="hidden sm:inline text-[10px] opacity-70">· {subDesc}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Area search radius — always visible */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              Area search radius
            </p>
            <span className="text-xs font-semibold tabular-nums text-[hsl(var(--foreground))]">
              {radiusKm} km
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">1</span>
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={radiusKm}
              onChange={(e) => onRadiusChange(Number(e.target.value))}
              disabled={generating}
              className="flex-1 accent-[hsl(var(--primary))] disabled:opacity-40"
            />
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">30</span>
          </div>
          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
            Only include places within {radiusKm} km of the city centre
          </p>
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
            {Object.entries(subcats).some(
              ([cat, s]) => s.size < SUBCATEGORIES[cat as RecommendableCategory].length,
            ) && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">active</span>
            )}
          </button>

          {advancedOpen && (
            <div className="mt-2 space-y-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 p-3">
              {RECOMMENDABLE_CATEGORIES.map((cat) => {
                const active = selected.has(cat);
                if (!active) return null;
                const styles = CATEGORY_STYLES[cat];
                // Filter out manualOnly subcategories — they have no Geoapify tags
                const catSubcats = SUBCATEGORIES[cat].filter((s) => !s.manualOnly);
                const selectedSubs = subcats[cat];

                return (
                  <div key={cat} className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
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
                        onChange={(e) => {
                          setSelectedProfileId(null);
                          setCounts((prev) => ({
                            ...prev,
                            [cat]: Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                          }));
                        }}
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

        {/* Include nearby attractions — moved to AI Recommendations section
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={nearbyEnabled}
              onChange={(e) => onNearbyEnabledChange(e.target.checked)}
              disabled={generating}
              className="h-4 w-4 rounded accent-[hsl(var(--primary))] disabled:opacity-40 cursor-pointer"
            />
            <span className="text-sm font-medium">🗺️ Include nearby attractions</span>
          </label>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] pl-6">
            Add culture &amp; nature highlights from beyond the city centre (≥ 4.0 stars &amp; 1K+ reviews). Up to 30 per category, independent of the max filter above.
          </p>
          {nearbyEnabled && (
            <div className="pl-6 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[hsl(var(--foreground))]">
                  🟠 Nearby search radius
                </p>
                <span className="text-xs font-semibold tabular-nums text-[hsl(var(--foreground))]">
                  {nearbyRadiusKm} km
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">5</span>
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={5}
                  value={nearbyRadiusKm}
                  onChange={(e) => onNearbyRadiusChange(Number(e.target.value))}
                  disabled={generating}
                  className="flex-1 accent-orange-500 disabled:opacity-40"
                />
                <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">60</span>
              </div>
            </div>
          )}
        </div>
        */}

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

          {generating ? (
            <Button
              type="button"
              onClick={cancelDiscover}
              variant="outline"
              className="w-1/3 min-w-[180px] border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              ✕ Cancel discovery
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onGenerate}
              disabled={selected.size === 0}
              className="w-1/3 min-w-[180px]"
            >
              🔍 Discover places
            </Button>
          )}

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
                {CATEGORY_LABELS[f.category]}: {f.error}
              </li>
            ))}
          </ul>
        )}
      </CardContent>}
    </Card>
  );
}