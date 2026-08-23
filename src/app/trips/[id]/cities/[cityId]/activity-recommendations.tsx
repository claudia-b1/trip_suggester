"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type {
  ActivityRecommendation,
  NearbyCityRecommendation,
  ActivityRecommendationsResult,
} from "@/lib/activity-recommendations";

export function ActivityRecommendations({
  cityId,
  cityName,
  country,
  initialData,
  pois,
}: {
  cityId: number;
  cityName: string;
  country?: string;
  initialData: ActivityRecommendationsResult | null;
  /** Existing POI names — used to link recommendations to POIs */
  pois?: { id: number; name: string }[];
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<ActivityRecommendationsResult | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync with server-provided initial data
  useEffect(() => {
    if (initialData) setData(initialData);
  }, [initialData]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cities/${cityId}/activities`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to generate recommendations");
      }
      const result: ActivityRecommendationsResult = await res.json();
      setData(result);
      toast(`Generated ${result.recommendations.length} recommendations for ${cityName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      toast(msg, { variant: "error" });
    } finally {
      setLoading(false);
    }
  }

  // Try to find a matching POI for a linked place name
  function findPoiLink(linkedPlace?: string): { id: number; name: string } | null {
    if (!linkedPlace || !pois?.length) return null;
    const lower = linkedPlace.toLowerCase();
    return pois.find((p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase())) ?? null;
  }

  const hasRecommendations = data && data.recommendations.length > 0;
  const hasNearbyCities = data && data.nearbyCities && data.nearbyCities.length > 0;
  const hasContent = hasRecommendations || hasNearbyCities;

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between"
        >
          <CardTitle className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 text-[hsl(var(--muted-foreground))] transition-transform ${open ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            🎯 Recommendations
            {hasContent && !open && (
              <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">
                ({data!.recommendations.length} activities{hasNearbyCities ? ` · ${data!.nearbyCities.length} nearby` : ""})
              </span>
            )}
          </CardTitle>
        </button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-5">
          {!hasContent && !loading && (
            <div className="text-center py-4 space-y-3">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Get AI-generated activity recommendations and must-do experiences for {cityName}.
              </p>
              <Button
                type="button"
                onClick={generate}
                disabled={loading}
                className="min-w-[200px]"
              >
                {loading && <span className="spinner mr-1.5" />}
                ✨ Generate recommendations
              </Button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-[hsl(var(--primary))] animate-pulse">
              <span className="spinner" />
              Generating recommendations for {cityName}…
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 text-center">{error}</p>
          )}

          {hasRecommendations && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Must-do activities
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {data!.recommendations.map((rec, i) => (
                  <RecommendationCard
                    key={i}
                    rec={rec}
                    index={i}
                    poiLink={findPoiLink(rec.linkedPlace)}
                  />
                ))}
              </div>
            </div>
          )}

          {hasNearbyCities && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Nearby cities to visit
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data!.nearbyCities.map((city, i) => (
                  <NearbyCityCard key={i} city={city} />
                ))}
              </div>
            </div>
          )}

          {hasContent && (
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] text-center">
              Generated {new Date(data!.generatedAt).toLocaleDateString()} · {data!.model}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function RecommendationCard({
  rec,
  index,
  poiLink,
}: {
  rec: ActivityRecommendation;
  index: number;
  poiLink: { id: number; name: string } | null;
}) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 space-y-1.5 transition-colors hover:bg-[hsl(var(--muted))]/50">
      <div className="flex items-start gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))]/10 text-[10px] font-bold text-[hsl(var(--primary))]">
          {index + 1}
        </span>
        <h4 className="text-sm font-semibold leading-tight">{rec.title}</h4>
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed pl-7">
        {rec.description}
      </p>
      {rec.linkedPlace && (
        <div className="pl-7">
          {poiLink ? (
            <a
              href={`#poi-${poiLink.id}`}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
            >
              📍 {rec.linkedPlace}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
              📍 {rec.linkedPlace}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function NearbyCityCard({ city }: { city: NearbyCityRecommendation }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 space-y-1 transition-colors hover:bg-[hsl(var(--muted))]/50">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <span className="text-xs">🏘️</span>
          {city.name}
        </h4>
        {city.distance && (
          <span className="shrink-0 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
            {city.distance}
          </span>
        )}
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
        {city.description}
      </p>
    </div>
  );
}
