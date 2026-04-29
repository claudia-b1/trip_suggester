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

type Failure = { category: RecommendableCategory; error: string };

export function RecommendationsPanel({ cityId }: { cityId: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<RecommendableCategory>>(
    () => new Set(RECOMMENDABLE_CATEGORIES),
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { created: number; failures: Failure[] } | null
  >(null);

  function toggle(cat: RecommendableCategory) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  async function onGenerate() {
    if (selected.size === 0 || generating) return;
    setGenerating(true);
    setError(null);
    setResult(null);
    const res = await fetch(`/api/cities/${cityId}/recommendations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories: Array.from(selected) }),
    });
    setGenerating(false);
    if (!res.ok) {
      const body: { error?: string } = await res.json().catch(() => ({}));
      const msg = body.error ?? "Failed to generate recommendations";
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
        <CardTitle>AI recommendations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Pick categories. Each runs an independent Claude call in parallel.
        </p>
        <div className="flex flex-wrap gap-3">
          {RECOMMENDABLE_CATEGORIES.map((cat) => (
            <label
              key={cat}
              className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm"
            >
              <input
                type="checkbox"
                checked={selected.has(cat)}
                onChange={() => toggle(cat)}
                disabled={generating}
              />
              {cat}
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            onClick={onGenerate}
            disabled={generating || selected.size === 0}
          >
            {generating
              ? `Generating ${selected.size}…`
              : "Generate Recommendations"}
          </Button>
          {error && <span className="text-sm text-red-600">{error}</span>}
          {result && !error && (
            <span className="text-sm text-[hsl(var(--muted-foreground))]">
              Added {result.created} POI{result.created === 1 ? "" : "s"}
              {result.failures.length > 0
                ? ` · ${result.failures.length} failed`
                : ""}
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
