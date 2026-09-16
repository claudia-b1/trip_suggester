"use client";

/**
 * /share — Web Share Target landing page.
 *
 * Opened by Android when the user shares a Google Maps link to this PWA.
 * Also used by the "Paste Google Maps link" flow (navigated to directly).
 *
 * Flow:
 *  1. Read ?title=&text=&url= query params (from share intent or manual nav)
 *  2. Extract Google Maps URL from params
 *  3. Call /api/share/resolve-google-maps to get place details
 *  4. Show preview card + list/category/subcategory pickers
 *  5. On save → POST /api/favourites/items → close window
 */

import { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  type Category,
} from "@/lib/categories";
import {
  SUBCATEGORIES,
  groupSubcategories,
  type SubcategoryGroup,
} from "@/lib/recommendations/subcategories";
import type { RecommendableCategory } from "@/lib/recommendations";
import {
  ACCOMMODATION_SUBCATEGORIES,
  FUEL_SUBCATEGORIES,
} from "@/lib/favourite-fields";
import {
  useFavourites,
  type FavouriteListDTO,
  type FavouriteItemDTO,
} from "@/components/favourites/favourites-provider";
import { useUser } from "@/components/user/user-provider";
import { useToast } from "@/components/ui/toast";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract a Google Maps URL from the shared text/url params. */
function extractGoogleMapsUrl(
  title?: string | null,
  text?: string | null,
  url?: string | null,
): string | null {
  // Check each param for a Google Maps URL
  for (const raw of [url, text, title]) {
    if (!raw) continue;
    // Match full URLs in the string
    const match = raw.match(
      /https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.\w+\/maps|maps\.google\.\w+|google\.\w+\/maps)[^\s)"]*/i,
    );
    if (match) return match[0];
  }
  return null;
}

function getSubcatsForCategory(
  cat: string,
): { id: string; label: string; emoji: string }[] {
  if (cat === "ACCOMMODATION") return ACCOMMODATION_SUBCATEGORIES;
  if (cat === "FUEL") return FUEL_SUBCATEGORIES;
  return (
    (SUBCATEGORIES as Record<string, { id: string; label: string; emoji: string }[]>)[
      cat
    ] ?? []
  );
}

function getSubcatGroups(cat: string): SubcategoryGroup[] | null {
  if (cat === "ACCOMMODATION" || cat === "FUEL") return null;
  if (cat in SUBCATEGORIES)
    return groupSubcategories(cat as RecommendableCategory);
  return null;
}

/** Find a duplicate favourite by sourcePlaceId or name+city. */
function findDuplicate(
  lists: FavouriteListDTO[],
  sourcePlaceId: string | null | undefined,
  name: string,
  city: string,
): { item: FavouriteItemDTO; listName: string } | null {
  const nameLower = name.toLowerCase();
  const cityLower = city.toLowerCase();

  for (const list of lists) {
    for (const item of list.items) {
      if (sourcePlaceId && item.sourcePlaceId === sourcePlaceId) {
        return { item, listName: list.name };
      }
      if (
        item.name.toLowerCase() === nameLower &&
        item.city.toLowerCase() === cityLower
      ) {
        return { item, listName: list.name };
      }
    }
    for (const sub of list.sublists ?? []) {
      for (const item of sub.items) {
        if (sourcePlaceId && item.sourcePlaceId === sourcePlaceId) {
          return { item, listName: `${list.name} / ${sub.name}` };
        }
        if (
          item.name.toLowerCase() === nameLower &&
          item.city.toLowerCase() === cityLower
        ) {
          return { item, listName: `${list.name} / ${sub.name}` };
        }
      }
    }
  }
  return null;
}

// ── Resolved place type ──────────────────────────────────────────────────────

type ResolvedPlace = {
  name: string;
  latitude: number;
  longitude: number;
  city: string;
  country: string;
  address?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: number;
  photoUrl?: string;
  website?: string;
  phoneNumber?: string;
  openingHours?: string;
  editorialSummary?: string;
  sourcePlaceId?: string;
};

// ── Main component ───────────────────────────────────────────────────────────

function SharePageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const { activeUser } = useUser();
  const { lists, loading: listsLoading, refreshLists } = useFavourites();

  // State
  const [state, setState] = useState<
    "resolving" | "preview" | "saving" | "done" | "error"
  >("resolving");
  const [place, setPlace] = useState<ResolvedPlace | null>(null);
  const [error, setError] = useState<string>("");
  const [selectedListId, setSelectedListId] = useState<number | "">("");
  const [category, setCategory] = useState<Category | "">("");
  const [subcategory, setSubcategory] = useState("");
  const [duplicate, setDuplicate] = useState<{
    item: FavouriteItemDTO;
    listName: string;
  } | null>(null);
  const [showNewList, setShowNewList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [creatingList, setCreatingList] = useState(false);

  // Extract URL from share params
  const mapsUrl = useMemo(
    () =>
      extractGoogleMapsUrl(
        searchParams.get("title"),
        searchParams.get("text"),
        searchParams.get("url"),
      ),
    [searchParams],
  );

  // Resolve the Google Maps URL on mount
  useEffect(() => {
    if (!mapsUrl) {
      setState("error");
      setError("No Google Maps link found in the shared data.");
      return;
    }
    if (!activeUser) return; // wait for auth

    let cancelled = false;

    async function resolve() {
      try {
        const res = await fetch("/api/share/resolve-google-maps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: mapsUrl }),
        });

        if (cancelled) return;

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(data?.error || `Failed to resolve link (${res.status})`);
          setState("error");
          return;
        }

        const data = (await res.json()) as ResolvedPlace;
        setPlace(data);
        setState("preview");
      } catch {
        if (!cancelled) {
          setError("Network error — could not resolve the link.");
          setState("error");
        }
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [mapsUrl, activeUser]);

  // Check for duplicates when place + lists are ready
  useEffect(() => {
    if (!place || listsLoading || lists.length === 0) {
      setDuplicate(null);
      return;
    }
    const dup = findDuplicate(
      lists,
      place.sourcePlaceId,
      place.name,
      place.city,
    );
    setDuplicate(dup);
  }, [place, lists, listsLoading]);

  // Subcategory options based on selected category
  const subcatOptions = useMemo(() => {
    if (!category) return [];
    return getSubcatsForCategory(category);
  }, [category]);

  const subcatGroups = useMemo(() => {
    if (!category) return null;
    return getSubcatGroups(category);
  }, [category]);

  // Reset subcategory when category changes
  useEffect(() => {
    setSubcategory("");
  }, [category]);

  // Flatten lists for picker (root + sublists)
  const flatLists = useMemo(() => {
    const result: { id: number; name: string; indent: boolean }[] = [];
    for (const list of lists) {
      result.push({ id: list.id, name: list.name, indent: false });
      for (const sub of list.sublists ?? []) {
        result.push({
          id: sub.id,
          name: `${list.name} / ${sub.name}`,
          indent: true,
        });
      }
    }
    return result;
  }, [lists]);

  // ── Create new list handler ──────────────────────────────────────────────

  const handleCreateList = useCallback(async () => {
    if (!newListName.trim()) return;
    setCreatingList(true);
    try {
      const res = await fetch("/api/favourites/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newListName.trim() }),
      });
      if (res.ok) {
        const created = await res.json();
        await refreshLists();
        setSelectedListId(created.id);
        setNewListName("");
        setShowNewList(false);
        toast("List created!");
      } else {
        toast("Failed to create list", { variant: "error" });
      }
    } catch {
      toast("Failed to create list", { variant: "error" });
    } finally {
      setCreatingList(false);
    }
  }, [newListName, refreshLists, toast]);

  // ── Save handler ─────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!place || selectedListId === "" || !category) return;

    setState("saving");
    try {
      const res = await fetch("/api/favourites/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: place.name,
          category,
          subcategory: subcategory || null,
          country: place.country,
          city: place.city,
          address: place.address || null,
          latitude: place.latitude,
          longitude: place.longitude,
          description: place.editorialSummary || null,
          photoUrl: place.photoUrl || null,
          website: place.website || null,
          phoneNumber: place.phoneNumber || null,
          openingHours: place.openingHours || null,
          priceLevel: place.priceLevel ?? null,
          sourcePlaceId: place.sourcePlaceId || null,
          listId: selectedListId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(data?.error || "Failed to save", { variant: "error" });
        setState("preview");
        return;
      }

      await refreshLists();
      setState("done");
      toast(`${place.name} added to favourites!`);

      // Try to close the window (works in share target context)
      setTimeout(() => {
        window.close();
      }, 1000);
    } catch {
      toast("Network error", { variant: "error" });
      setState("preview");
    }
  }, [place, selectedListId, category, subcategory, refreshLists, toast]);

  // ── Overwrite handler ────────────────────────────────────────────────────

  const handleOverwrite = useCallback(async () => {
    if (!place || !duplicate) return;

    setState("saving");
    try {
      const res = await fetch(`/api/favourites/items/${duplicate.item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: place.name,
          category: category || duplicate.item.category,
          subcategory: subcategory || null,
          country: place.country,
          city: place.city,
          address: place.address || null,
          latitude: place.latitude,
          longitude: place.longitude,
          description: place.editorialSummary || null,
          photoUrl: place.photoUrl || null,
          website: place.website || null,
          phoneNumber: place.phoneNumber || null,
          openingHours: place.openingHours || null,
          priceLevel: place.priceLevel ?? null,
          sourcePlaceId: place.sourcePlaceId || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(data?.error || "Failed to update", { variant: "error" });
        setState("preview");
        return;
      }

      await refreshLists();
      setState("done");
      toast(`${place.name} updated in favourites!`);

      setTimeout(() => {
        window.close();
      }, 1000);
    } catch {
      toast("Network error", { variant: "error" });
      setState("preview");
    }
  }, [place, duplicate, category, subcategory, refreshLists, toast]);

  // ── Not logged in ────────────────────────────────────────────────────────

  if (!activeUser) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="text-4xl">🔒</div>
        <h1 className="text-lg font-semibold text-[hsl(var(--foreground))]">
          Sign in to continue
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Please select or create a user to save this place to your favourites.
          The link will be preserved.
        </p>
      </div>
    );
  }

  // ── Resolving state ──────────────────────────────────────────────────────

  if (state === "resolving") {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Resolving place from Google Maps...
        </p>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────

  if (state === "error") {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="text-4xl">😕</div>
        <h1 className="text-lg font-semibold text-[hsl(var(--foreground))]">
          Could not resolve link
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{error}</p>
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/")}
            className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium transition-colors hover:bg-[hsl(var(--muted))]"
          >
            Go to app
          </button>
          <button
            onClick={() => window.close()}
            className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:opacity-90"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // ── Done state ───────────────────────────────────────────────────────────

  if (state === "done") {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="text-4xl">✅</div>
        <h1 className="text-lg font-semibold text-[hsl(var(--foreground))]">
          Saved to favourites!
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          This window will close automatically.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/")}
            className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium transition-colors hover:bg-[hsl(var(--muted))]"
          >
            Open app
          </button>
          <button
            onClick={() => window.close()}
            className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:opacity-90"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // ── Preview state ────────────────────────────────────────────────────────

  const canSave = selectedListId !== "" && category !== "" && place != null;

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <h1 className="mb-4 text-lg font-semibold text-[hsl(var(--foreground))]">
        Add to Favourites
      </h1>

      {place && (
        <div className="space-y-4">
          {/* Place preview card */}
          <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            {place.photoUrl && (
              <div className="relative h-40 w-full overflow-hidden bg-[hsl(var(--muted))]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={place.photoUrl}
                  alt={place.name}
                  className="h-full w-full object-cover"
                />
              </div>
            )}
            <div className="space-y-1.5 p-4">
              <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
                {place.name}
              </h2>
              {(place.rating != null || place.userRatingCount != null) && (
                <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                  {place.rating != null && <span>⭐ {place.rating.toFixed(1)}</span>}
                  {place.userRatingCount != null && (
                    <span>({place.userRatingCount} reviews)</span>
                  )}
                  {place.priceLevel != null && (
                    <span className="ml-1">
                      {"$".repeat(Math.max(1, place.priceLevel))}
                    </span>
                  )}
                </div>
              )}
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                📍 {[place.address || place.city, place.country]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              {place.website && (
                <p className="truncate text-sm text-blue-600 dark:text-blue-400">
                  🌐 {place.website.replace(/^https?:\/\/(www\.)?/, "")}
                </p>
              )}
              {place.editorialSummary && (
                <p className="text-xs text-[hsl(var(--muted-foreground))] italic">
                  {place.editorialSummary}
                </p>
              )}
            </div>
          </div>

          {/* Duplicate warning */}
          {duplicate && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                ⚠️ This place already exists in your favourites
              </p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                &ldquo;{duplicate.item.name}&rdquo; in list &ldquo;{duplicate.listName}&rdquo;
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleOverwrite}
                  disabled={state === "saving"}
                  className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
                >
                  {state === "saving" ? "Updating..." : "Overwrite"}
                </button>
                <button
                  onClick={() => window.close()}
                  className="rounded-md border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-600 dark:text-amber-300 dark:hover:bg-amber-900/30"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* List picker */}
          {!duplicate && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]">
                  Save to list *
                </label>
                {listsLoading ? (
                  <div className="h-9 animate-pulse rounded-md bg-[hsl(var(--muted))]" />
                ) : (
                  <>
                    {flatLists.length > 0 && (
                      <select
                        value={selectedListId}
                        onChange={(e) =>
                          setSelectedListId(
                            e.target.value ? Number(e.target.value) : "",
                          )
                        }
                        className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))]"
                      >
                        <option value="">Select a list...</option>
                        {flatLists.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.indent ? "  " : ""}
                            {l.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {showNewList ? (
                      <div className="mt-1.5 flex items-center gap-2">
                        <input
                          type="text"
                          value={newListName}
                          onChange={(e) => setNewListName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateList(); } }}
                          placeholder="New list name…"
                          autoFocus
                          className="flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]"
                        />
                        <button
                          type="button"
                          onClick={handleCreateList}
                          disabled={creatingList || !newListName.trim()}
                          className="rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
                        >
                          {creatingList ? "…" : "Create"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowNewList(false); setNewListName(""); }}
                          className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowNewList(true)}
                        className="mt-1.5 text-sm font-medium text-[hsl(var(--primary))] hover:underline"
                      >
                        + Create new list
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Category picker */}
              <div>
                <label className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]">
                  Category *
                </label>
                <select
                  value={category}
                  onChange={(e) =>
                    setCategory(
                      e.target.value ? (e.target.value as Category) : "",
                    )
                  }
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))]"
                >
                  <option value="">— Choose category —</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subcategory picker (optional, shown when category selected) */}
              {category && subcatOptions.length > 0 && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]">
                    Subcategory{" "}
                    <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">
                      (optional)
                    </span>
                  </label>
                  <select
                    value={subcategory}
                    onChange={(e) => setSubcategory(e.target.value)}
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))]"
                  >
                    <option value="">-- No subcategory --</option>
                    {subcatGroups
                      ? subcatGroups.map((g) =>
                          g.type === "single" ? (
                            <option key={g.def.id} value={g.def.id}>
                              {g.def.emoji} {g.def.label}
                            </option>
                          ) : (
                            <optgroup key={g.groupId} label={g.groupLabel}>
                              {g.members.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.emoji} {m.label}
                                </option>
                              ))}
                            </optgroup>
                          ),
                        )
                      : subcatOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.emoji} {s.label}
                          </option>
                        ))}
                  </select>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => window.close()}
                  className="flex-1 rounded-lg border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!canSave || state === "saving"}
                  className="flex-1 rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:opacity-90 disabled:opacity-50"
                >
                  {state === "saving" ? "Saving..." : "❤️ Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Wrap in Suspense for useSearchParams
export default function SharePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      }
    >
      <SharePageContent />
    </Suspense>
  );
}
