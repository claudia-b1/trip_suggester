"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORIES, CATEGORY_STYLES, type Category } from "@/lib/categories";
import { PoiMap } from "./poi-map";
import { DailyPlan, type DayPlanDTO } from "./daily-plan";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

export type PoiDTO = {
  id: number;
  name: string;
  category: Category;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
};

type View = "list" | "map" | "plan";

function CategoryBadge({ category }: { category: Category }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[category].badge}`}
    >
      {category}
    </span>
  );
}

export function PoisSection({
  cityId,
  pois,
  dayPlans,
}: {
  cityId: number;
  pois: PoiDTO[];
  dayPlans: DayPlanDTO[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<View>("list");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("CULTURE");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Filter state — applies to list + map views only.
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    () => new Set(),
  );
  const [search, setSearch] = useState("");

  function toggleCategory(c: Category) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }
  function clearFilters() {
    setActiveCategories(new Set());
    setSearch("");
  }
  const hasFilters = activeCategories.size > 0 || search.trim().length > 0;
  const searchLower = search.trim().toLowerCase();
  const filteredPois = pois.filter(
    (p) =>
      (activeCategories.size === 0 || activeCategories.has(p.category)) &&
      (searchLower === "" || p.name.toLowerCase().includes(searchLower)),
  );

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/cities/${cityId}/pois`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category, description }),
    });
    if (!res.ok) {
      setError("Failed to add POI");
      setSubmitting(false);
      return;
    }
    setName("");
    setCategory("CULTURE");
    setDescription("");
    setSubmitting(false);
    router.refresh();
  }

  async function onDelete(poi: PoiDTO) {
    const ok = await confirm({
      title: "Delete POI?",
      message: `Remove "${poi.name}" from this city?`,
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(poi.id);
    const res = await fetch(`/api/pois/${poi.id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) {
      toast("Failed to delete POI", { variant: "error" });
      return;
    }
    router.refresh();
  }

  const grouped = CATEGORIES.map((c) => ({
    category: c,
    items: filteredPois.filter((p) => p.category === c),
  })).filter((g) => g.items.length > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Points of interest</CardTitle>
        <div
          role="tablist"
          className="inline-flex rounded-md border border-[hsl(var(--border))] p-1"
        >
          {(
            [
              ["list", "List View"],
              ["map", "Map View"],
              ["plan", "Daily Plan"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`rounded px-3 py-1 text-sm ${
                view === key
                  ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "text-[hsl(var(--muted-foreground))]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {view !== "plan" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {CATEGORIES.map((c) => {
                const active = activeCategories.has(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleCategory(c)}
                    aria-pressed={active}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition ${
                      active
                        ? `${CATEGORY_STYLES[c].badge} ring-2 ring-offset-1 ring-[hsl(var(--ring))]`
                        : `${CATEGORY_STYLES[c].badge} opacity-50 hover:opacity-100`
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search POIs by name…"
                className="max-w-xs"
              />
              {hasFilters && (
                <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
              {hasFilters && (
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {filteredPois.length} of {pois.length}
                </span>
              )}
            </div>
          </div>
        )}

        {view === "map" ? (
          <PoiMap pois={filteredPois} />
        ) : view === "plan" ? (
          <DailyPlan cityId={cityId} pois={pois} dayPlans={dayPlans} />
        ) : grouped.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {pois.length === 0 ? "No POIs yet." : "No POIs match the current filters."}
          </p>
        ) : (
          <div className="space-y-4">
            {grouped.map(({ category: cat, items }) => (
              <div key={cat} className="space-y-2">
                <div className="flex items-center gap-2">
                  <CategoryBadge category={cat} />
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {items.length}
                  </span>
                </div>
                <ul className="divide-y divide-[hsl(var(--border))] rounded-md border border-[hsl(var(--border))]">
                  {items.map((poi) => (
                    <li key={poi.id} className="flex items-start justify-between gap-3 p-3">
                      <div className="space-y-1">
                        <div className="font-medium">{poi.name}</div>
                        {poi.description && (
                          <div className="text-sm text-[hsl(var(--muted-foreground))]">
                            {poi.description}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => onDelete(poi)}
                        disabled={deletingId === poi.id}
                      >
                        {deletingId === poi.id ? "…" : "Delete"}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={onAdd} className="space-y-4 border-t border-[hsl(var(--border))] pt-4">
          <h4 className="text-sm font-semibold">Add POI</h4>
          <div className="space-y-2">
            <Label htmlFor="poi-name">Name</Label>
            <Input
              id="poi-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Some museum"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="poi-category">Category</Label>
            <select
              id="poi-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="flex h-10 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="poi-description">Description</Label>
            <textarea
              id="poi-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              placeholder="Optional"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Adding…" : "Add POI"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
