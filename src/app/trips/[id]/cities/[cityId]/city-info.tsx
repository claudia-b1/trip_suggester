"use client";

import { useState } from "react";
import type { ConfidenceLevel, ParsedCategory, GeneratedCityInfo } from "@/lib/city-info";

// ── Public types ───────────────────────────────────────────────────────────────

export type CityWikiInfo = {
  extract: string;
  description?: string;
  thumbnailUrl?: string;
  wikiUrl?: string;
};

// ── Confidence badge ───────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const cls: Record<ConfidenceLevel, string> = {
    HIGH:    "bg-emerald-100 text-emerald-700",
    MEDIUM:  "bg-amber-100 text-amber-700",
    LOW:     "bg-gray-100 text-gray-500",
    UNKNOWN: "bg-gray-100 text-gray-400",
  };
  return (
    <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${cls[level]}`}>
      {level === "UNKNOWN" ? "?" : level}
    </span>
  );
}

// ── Generated info panel ───────────────────────────────────────────────────────

function GeneratedInfoPanel({
  generated,
  thumbnailUrl,
}: {
  generated: GeneratedCityInfo;
  thumbnailUrl?: string;
}) {
  const [selectedName, setSelectedName] = useState(
    () => generated.categories[0]?.name ?? "",
  );

  const selectedCat = generated.categories.find((c) => c.name === selectedName);

  const daysAgo = Math.floor(
    (Date.now() - new Date(generated.generatedAt).getTime()) / (1000 * 60 * 60 * 24),
  );
  const ageLabel =
    daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;

  return (
    <div className="flex min-h-0">
      {/* Left: image — stretches to match right column height */}
      {thumbnailUrl && (
        <div className="hidden sm:block w-56 shrink-0 self-stretch">
          <img
            src={thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Right: pills + content + footer */}
      <div className={`flex flex-col flex-1 min-w-0 ${thumbnailUrl ? "sm:border-l border-[hsl(var(--border))]" : ""}`}>
        {/* Mobile-only image */}
        {thumbnailUrl && (
          <div className="sm:hidden w-full aspect-[16/7] overflow-hidden border-b border-[hsl(var(--border))]">
            <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        {/* Category pills */}
        <div className="flex flex-wrap gap-1.5 px-4 pt-3 pb-2.5">
          {generated.categories.map((cat) => {
            const active = cat.name === selectedName;
            return (
              <button
                key={cat.name}
                type="button"
                onClick={() => setSelectedName(cat.name)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "border border-[hsl(var(--border))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.name}</span>
              </button>
            );
          })}
        </div>

        {/* Selected category content */}
        {selectedCat && (
          <div className="flex-1 px-4 pt-2 pb-4 border-t border-[hsl(var(--border))]">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">{selectedCat.icon}</span>
              <span className="text-sm font-semibold">{selectedCat.name}</span>
              <span className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                confidence: <ConfidenceBadge level={selectedCat.confidence} />
              </span>
            </div>
            <p className="text-sm leading-relaxed text-[hsl(var(--foreground))]">
              {selectedCat.summary}
            </p>
            {selectedCat.dishes && selectedCat.dishes.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {selectedCat.dishes.map((d, idx) => (
                  <li key={idx} className="text-sm flex gap-1.5">
                    <span className="text-[hsl(var(--muted-foreground))] shrink-0">•</span>
                    <span>
                      <span className="font-medium">{d.name}</span>
                      <span className="text-[hsl(var(--muted-foreground))]"> — {d.description}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 mt-auto">
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            Generated {ageLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CityInfoSection({
  cityId,
  cityName,
  info,
  initialGenerated = null,
}: {
  cityId: number;
  cityName: string;
  info: CityWikiInfo | null;
  initialGenerated?: GeneratedCityInfo | null;
}) {
  const [open, setOpen] = useState(false);
  const [generated, setGenerated] = useState<GeneratedCityInfo | null>(initialGenerated);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch(`/api/cities/${cityId}/city-info`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const result = (await res.json()) as GeneratedCityInfo;
      setGenerated(result);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setGenerating(false);
    }
  }

  if (!info && !generated) return null;

  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      {/* Header / toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[hsl(var(--muted))]/40 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🌍</span>
          <span className="font-semibold text-base">About {cityName}</span>
          {info?.description && (
            <span className="hidden sm:inline text-sm text-[hsl(var(--muted-foreground))] truncate max-w-[280px]">
              — {info.description}
            </span>
          )}
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 text-[hsl(var(--muted-foreground))] transition-transform duration-200 shrink-0 ${
            open ? "rotate-180" : ""
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Body */}
      {open && (
        <div className="border-t border-[hsl(var(--border))]">
          {generated ? (
            <GeneratedInfoPanel
              generated={generated}
              thumbnailUrl={info?.thumbnailUrl}
            />
          ) : (
            /* Not yet generated */
            <div className="px-5 py-4 space-y-3">
              {info?.thumbnailUrl && (
                <div className="w-full aspect-[16/7] overflow-hidden rounded-lg">
                  <img
                    src={info.thumbnailUrl}
                    alt={cityName}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  Generate AI-powered insights about {cityName}.
                </p>
                <button
                  type="button"
                  onClick={generate}
                  disabled={generating}
                  className="shrink-0 inline-flex items-center gap-1.5 text-xs bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] rounded-full px-3 py-1.5 font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {generating ? (
                    <><span className="spinner" />Generating…</>
                  ) : (
                    <>✨ Generate more information</>
                  )}
                </button>
              </div>
              {genError && <p className="text-xs text-red-600">{genError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
