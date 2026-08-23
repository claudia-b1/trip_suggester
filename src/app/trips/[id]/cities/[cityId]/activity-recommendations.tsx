"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type {
  ActivityRecommendation,
  NearbyCityRecommendation,
  NearbyActivityRecommendation,
  ActivityRecommendationsResult,
} from "@/lib/activity-recommendations";

/** Geocode a place name to get verified lat/lng via our geocode API */
async function verifyLocation(
  name: string,
  country?: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const query = country ? `${name}, ${country}` : name;
    const params = new URLSearchParams({ action: "geocode", address: query });
    if (country) params.set("country", country);
    const res = await fetch(`/api/geocode?${params}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { lat?: number; lng?: number };
    if (typeof data.lat === "number" && typeof data.lng === "number") {
      return { lat: data.lat, lng: data.lng };
    }
    return null;
  } catch {
    return null;
  }
}

export function ActivityRecommendations({
  cityId,
  cityName,
  country,
  tripId,
  tripStartDate,
  tripEndDate,
  initialData,
  pois,
}: {
  cityId: number;
  cityName: string;
  country?: string;
  tripId: number;
  tripStartDate: string;
  tripEndDate: string;
  initialData: ActivityRecommendationsResult | null;
  /** Existing POI names — used to link recommendations to POIs */
  pois?: { id: number; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<ActivityRecommendationsResult | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingPoiFor, setAddingPoiFor] = useState<string | null>(null);

  // Generation options
  const [genMustDo, setGenMustDo] = useState(true);
  const [genNearbyCities, setGenNearbyCities] = useState(true);
  const [genNearbyActivities, setGenNearbyActivities] = useState(true);
  const [maxCitiesKm, setMaxCitiesKm] = useState(150);
  const [maxActivitiesKm, setMaxActivitiesKm] = useState(50);

  // Regenerate settings panel
  const [showSettings, setShowSettings] = useState(false);

  // Subsection collapse state (all open by default)
  const [mustDoOpen, setMustDoOpen] = useState(true);
  const [nearbyActivitiesOpen, setNearbyActivitiesOpen] = useState(true);
  const [nearbyCitiesOpen, setNearbyCitiesOpen] = useState(true);

  // Sync with server-provided initial data
  useEffect(() => {
    if (initialData) setData(initialData);
  }, [initialData]);

  async function generate() {
    setLoading(true);
    setError(null);
    setShowSettings(false);
    try {
      const res = await fetch(`/api/cities/${cityId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeMustDo: genMustDo,
          includeNearbyCities: genNearbyCities,
          includeNearbyActivities: genNearbyActivities,
          maxNearbyCitiesKm: maxCitiesKm,
          maxNearbyActivitiesKm: maxActivitiesKm,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to generate recommendations");
      }
      const result: ActivityRecommendationsResult = await res.json();
      setData(result);
      toast(`Generated recommendations for ${cityName}`);
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

  /** Verify a POI's location via geocoding, then create it and show on map */
  async function addPoiAndShowOnMap(poiData: {
    name: string;
    category: string;
    description: string;
    latitude: number | null;
    longitude: number | null;
  }) {
    const key = poiData.name;
    setAddingPoiFor(key);
    try {
      // Verify location via geocoding — try multiple queries
      let verifiedLat = poiData.latitude;
      let verifiedLng = poiData.longitude;

      // Try geocoding with the place name + country for verification
      const searchQueries = [
        // Most specific: name + city + country
        `${poiData.name}, ${cityName}${country ? `, ${country}` : ""}`,
        // Name + country
        country ? `${poiData.name}, ${country}` : null,
        // Just the name
        poiData.name,
      ].filter(Boolean) as string[];

      for (const query of searchQueries) {
        const params = new URLSearchParams({ action: "geocode", address: query });
        if (country) params.set("country", country);
        try {
          const geoRes = await fetch(`/api/geocode?${params}`);
          if (geoRes.ok) {
            const geoData = (await geoRes.json()) as { lat?: number; lng?: number };
            if (typeof geoData.lat === "number" && typeof geoData.lng === "number") {
              // Basic sanity: lat/lng should not be 0,0 and should be reasonable
              if (geoData.lat !== 0 || geoData.lng !== 0) {
                verifiedLat = geoData.lat;
                verifiedLng = geoData.lng;
                break; // Use first successful geocode result
              }
            }
          }
        } catch {
          // Try next query
        }
      }

      // If we still have no coordinates or (0,0), warn but proceed
      if (verifiedLat === 0 && verifiedLng === 0) {
        verifiedLat = null;
        verifiedLng = null;
      }

      const res = await fetch(`/api/cities/${cityId}/pois`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...poiData,
          latitude: verifiedLat,
          longitude: verifiedLng,
        }),
      });
      if (!res.ok) throw new Error("Failed to add POI");
      const newPoi = await res.json();
      toast(`Added "${poiData.name}" — showing on map`);

      // Tell PoisSection to switch to map view and focus the new POI
      window.dispatchEvent(
        new CustomEvent("focus-poi-on-map", { detail: { poiId: newPoi.id } }),
      );
      router.refresh();
    } catch {
      toast("Failed to add POI", { variant: "error" });
    } finally {
      setAddingPoiFor(null);
    }
  }

  function addPoiFromRecommendation(rec: ActivityRecommendation) {
    if (!rec.linkedPlace) return;
    addPoiAndShowOnMap({
      name: rec.linkedPlace,
      category: rec.category ?? "CULTURE",
      description: rec.description,
      latitude: rec.latitude ?? null,
      longitude: rec.longitude ?? null,
    });
  }

  function addNearbyActivityAsPoi(act: NearbyActivityRecommendation) {
    addPoiAndShowOnMap({
      name: act.title,
      category: act.category ?? "NATURE",
      description: `${act.description}${act.location ? ` (${act.location})` : ""}`,
      latitude: act.latitude ?? null,
      longitude: act.longitude ?? null,
    });
  }

  function addCityToTrip(city: NearbyCityRecommendation) {
    // Navigate to the trip page with query params to pre-fill the add city form
    const params = new URLSearchParams();
    params.set("addCity", "1");
    params.set("cityName", city.name);
    if (city.country) params.set("cityCountry", city.country);
    if (city.latitude != null) params.set("cityLat", String(city.latitude));
    if (city.longitude != null) params.set("cityLng", String(city.longitude));
    router.push(`/trips/${tripId}?${params.toString()}`);
  }

  const hasRecommendations = data && data.recommendations.length > 0;
  const hasNearbyCities = data && data.nearbyCities && data.nearbyCities.length > 0;
  const hasNearbyActivities = data && data.nearbyActivities && data.nearbyActivities.length > 0;
  const hasContent = hasRecommendations || hasNearbyCities || hasNearbyActivities;

  // Generation options UI (shared between initial and regenerate)
  function renderOptions() {
    return (
      <div className="space-y-2 rounded-lg border border-[hsl(var(--border))] p-3 bg-[hsl(var(--muted))]/30 max-w-md mx-auto">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={genMustDo} onChange={(e) => setGenMustDo(e.target.checked)} className="rounded" />
          Must-do activities
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={genNearbyCities} onChange={(e) => setGenNearbyCities(e.target.checked)} className="rounded" />
          Nearby cities
          {genNearbyCities && (
            <span className="inline-flex items-center gap-1 ml-1">
              <input
                type="number"
                value={maxCitiesKm}
                onChange={(e) => setMaxCitiesKm(Number(e.target.value) || 150)}
                className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                min={10}
                max={500}
              />
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">km max</span>
            </span>
          )}
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={genNearbyActivities} onChange={(e) => setGenNearbyActivities(e.target.checked)} className="rounded" />
          Recommended activities nearby
          {genNearbyActivities && (
            <span className="inline-flex items-center gap-1 ml-1">
              <input
                type="number"
                value={maxActivitiesKm}
                onChange={(e) => setMaxActivitiesKm(Number(e.target.value) || 50)}
                className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                min={5}
                max={200}
              />
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">km max</span>
            </span>
          )}
        </label>
      </div>
    );
  }

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
            {"\u{1F3AF}"} Recommendations
            {hasContent && !open && (
              <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">
                ({data!.recommendations.length} activities
                {hasNearbyActivities ? ` · ${data!.nearbyActivities.length} nearby` : ""}
                {hasNearbyCities ? ` · ${data!.nearbyCities.length} cities` : ""})
              </span>
            )}
          </CardTitle>
        </button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-5">
          {!hasContent && !loading && (
            <div className="py-4 space-y-4">
              <p className="text-sm text-[hsl(var(--muted-foreground))] text-center">
                Get AI-generated activity recommendations and must-do experiences for {cityName}.
              </p>

              {/* Generation options */}
              {renderOptions()}

              <div className="text-center">
                <Button
                  type="button"
                  onClick={generate}
                  disabled={loading || (!genMustDo && !genNearbyCities && !genNearbyActivities)}
                  className="min-w-[200px]"
                >
                  {"✨"} Generate recommendations
                </Button>
              </div>
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
            <CollapsibleSubsection
              title="Must-do activities"
              count={data!.recommendations.length}
              open={mustDoOpen}
              onToggle={() => setMustDoOpen((v) => !v)}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {data!.recommendations.map((rec, i) => {
                  const poiLink = findPoiLink(rec.linkedPlace);
                  return (
                    <RecommendationCard
                      key={i}
                      rec={rec}
                      index={i}
                      poiLink={poiLink}
                      onAddPoi={() => addPoiFromRecommendation(rec)}
                      addingPoi={addingPoiFor === rec.linkedPlace}
                    />
                  );
                })}
              </div>
            </CollapsibleSubsection>
          )}

          {hasNearbyActivities && (
            <CollapsibleSubsection
              title="Recommended activities nearby"
              count={data!.nearbyActivities.length}
              open={nearbyActivitiesOpen}
              onToggle={() => setNearbyActivitiesOpen((v) => !v)}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {data!.nearbyActivities.map((act, i) => (
                  <NearbyActivityCard
                    key={i}
                    activity={act}
                    onAddPoi={() => addNearbyActivityAsPoi(act)}
                    addingPoi={addingPoiFor === act.title}
                  />
                ))}
              </div>
            </CollapsibleSubsection>
          )}

          {hasNearbyCities && (
            <CollapsibleSubsection
              title="Nearby cities to visit"
              count={data!.nearbyCities.length}
              open={nearbyCitiesOpen}
              onToggle={() => setNearbyCitiesOpen((v) => !v)}
            >
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data!.nearbyCities.map((city, i) => (
                  <NearbyCityCard
                    key={i}
                    city={city}
                    onAddToTrip={() => addCityToTrip(city)}
                  />
                ))}
              </div>
            </CollapsibleSubsection>
          )}

          {hasContent && (
            <div className="space-y-3">
              {/* Regenerate settings panel */}
              {showSettings && (
                <div className="space-y-3 py-2">
                  {renderOptions()}
                  <div className="flex items-center justify-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={generate}
                      disabled={loading || (!genMustDo && !genNearbyCities && !genNearbyActivities)}
                    >
                      {"🔄"} Regenerate
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShowSettings(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-center gap-3">
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  Generated {new Date(data!.generatedAt).toLocaleDateString()} · {data!.model}
                </p>
                {!showSettings && (
                  <button
                    type="button"
                    onClick={() => setShowSettings(true)}
                    className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    Regenerate
                  </button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function CollapsibleSubsection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 group w-full text-left"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3 w-3 text-[hsl(var(--muted-foreground))] transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] transition-colors">
          {title}
        </span>
        <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
          ({count})
        </span>
      </button>
      {open && children}
    </div>
  );
}

function RecommendationCard({
  rec,
  index,
  poiLink,
  onAddPoi,
  addingPoi,
}: {
  rec: ActivityRecommendation;
  index: number;
  poiLink: { id: number; name: string } | null;
  onAddPoi: () => void;
  addingPoi: boolean;
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
        <div className="pl-7 flex items-center gap-2">
          {poiLink ? (
            <a
              href={`#poi-${poiLink.id}`}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
            >
              {"📍"} {rec.linkedPlace}
            </a>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
                {"📍"} {rec.linkedPlace}
              </span>
              <button
                type="button"
                onClick={onAddPoi}
                disabled={addingPoi}
                className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50"
              >
                {addingPoi ? <span className="spinner !h-3 !w-3" /> : "+"}
                {addingPoi ? "Adding…" : "Add as POI"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NearbyActivityCard({
  activity,
  onAddPoi,
  addingPoi,
}: {
  activity: NearbyActivityRecommendation;
  onAddPoi: () => void;
  addingPoi: boolean;
}) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 space-y-1.5 transition-colors hover:bg-[hsl(var(--muted))]/50">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold leading-tight flex items-center gap-1.5">
          <span className="text-xs">{"🏞️"}</span>
          {activity.title}
        </h4>
        {activity.distance && (
          <span className="shrink-0 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
            {activity.distance}
          </span>
        )}
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
        {activity.description}
      </p>
      <div className="flex items-center justify-between gap-2">
        {activity.location && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
            {"📍"} {activity.location}
          </span>
        )}
        <button
          type="button"
          onClick={onAddPoi}
          disabled={addingPoi}
          className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50 ml-auto"
        >
          {addingPoi ? <span className="spinner !h-3 !w-3" /> : "+"}
          {addingPoi ? "Adding…" : "Add as POI"}
        </button>
      </div>
    </div>
  );
}

function NearbyCityCard({
  city,
  onAddToTrip,
}: {
  city: NearbyCityRecommendation;
  onAddToTrip: () => void;
}) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 space-y-1 transition-colors hover:bg-[hsl(var(--muted))]/50">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <span className="text-xs">{"🏘️"}</span>
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
      <div className="pt-1">
        <button
          type="button"
          onClick={onAddToTrip}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
        >
          + Add to trip
        </button>
      </div>
    </div>
  );
}
