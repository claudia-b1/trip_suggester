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
  HikeRecommendation,
  CyclingRecommendation,
  ActivityRecommendationsResult,
} from "@/lib/activity-recommendations";
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS, CATEGORY_STYLES, type Category } from "@/lib/categories";

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
  cityStartDate,
  cityEndDate,
  initialData,
  pois,
  parentCityId,
}: {
  cityId: number;
  cityName: string;
  country?: string;
  tripId: number;
  tripStartDate: string;
  tripEndDate: string;
  /** The current city's own date range — used for sub-destination date picker */
  cityStartDate: string;
  cityEndDate: string;
  initialData: ActivityRecommendationsResult | null;
  /** Existing POIs — used to link recommendations to POIs and show their photos */
  pois?: { id: number; name: string; photoUrl?: string | null }[];
  /** If this city is a subcity, its parentCityId; null for top-level */
  parentCityId?: number | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(true);
  const [data, setData] = useState<ActivityRecommendationsResult | null>(initialData);
  const [loadingSection, setLoadingSection] = useState<string | null>(null);
  const isLoading = loadingSection !== null;
  const [error, setError] = useState<string | null>(null);
  const [addingPoiFor, setAddingPoiFor] = useState<string | null>(null);

  // Generation options (initial generation)
  const [genMustDo, setGenMustDo] = useState(true);
  const [genNearbyCities, setGenNearbyCities] = useState(true);
  const [genNearbyActivities, setGenNearbyActivities] = useState(true);
  const [maxCitiesKm, setMaxCitiesKm] = useState(150);
  const [maxActivitiesKm, setMaxActivitiesKm] = useState(50);

  // "Generate more" panel
  const [showGenerateMore, setShowGenerateMore] = useState(false);
  const [genHikes, setGenHikes] = useState(true);
  const [genCycling, setGenCycling] = useState(true);

  // Per-section regenerate settings (for sections with configurable distance)
  const [regenSettingsFor, setRegenSettingsFor] = useState<string | null>(null);

  // Subsection collapse state (all open by default)
  const [mustDoOpen, setMustDoOpen] = useState(true);
  const [nearbyActivitiesOpen, setNearbyActivitiesOpen] = useState(true);
  const [nearbyCitiesOpen, setNearbyCitiesOpen] = useState(true);
  const [hikesOpen, setHikesOpen] = useState(true);
  const [cyclingOpen, setCyclingOpen] = useState(true);

  // Sync with server-provided initial data
  useEffect(() => {
    if (initialData) setData(initialData);
  }, [initialData]);

  /** Initial generation — produces the three default sections */
  async function generate() {
    setLoadingSection("all");
    setError(null);
    try {
      const res = await fetch(`/api/cities/${cityId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeMustDo: genMustDo,
          includeNearbyCities: genNearbyCities,
          includeNearbyActivities: genNearbyActivities,
          includeHikes: false,
          includeCycling: false,
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
      setLoadingSection(null);
    }
  }

  /** Regenerate a single section, preserving all others via server-side merge */
  async function regenerateSection(section: "mustDo" | "nearbyCities" | "nearbyActivities" | "hikes" | "cycling") {
    setLoadingSection(section);
    setError(null);
    try {
      const res = await fetch(`/api/cities/${cityId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeMustDo: section === "mustDo",
          includeNearbyCities: section === "nearbyCities",
          includeNearbyActivities: section === "nearbyActivities",
          includeHikes: section === "hikes",
          includeCycling: section === "cycling",
          maxNearbyCitiesKm: maxCitiesKm,
          maxNearbyActivitiesKm: maxActivitiesKm,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to regenerate");
      }
      const result: ActivityRecommendationsResult = await res.json();
      setData(result);
      toast("Regenerated successfully");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      toast(msg, { variant: "error" });
    } finally {
      setLoadingSection(null);
    }
  }

  /** Generate additional sections (hikes, cycling) via "Generate more" */
  async function generateMore() {
    setLoadingSection("more");
    setError(null);
    try {
      const res = await fetch(`/api/cities/${cityId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeMustDo: false,
          includeNearbyCities: false,
          includeNearbyActivities: false,
          includeHikes: genHikes,
          includeCycling: genCycling,
          maxNearbyCitiesKm: maxCitiesKm,
          maxNearbyActivitiesKm: maxActivitiesKm,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to generate");
      }
      const result: ActivityRecommendationsResult = await res.json();
      setData(result);
      setShowGenerateMore(false);
      toast("Generated additional recommendations");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      toast(msg, { variant: "error" });
    } finally {
      setLoadingSection(null);
    }
  }

  // Try to find a matching POI for a linked place name
  function findPoiLink(linkedPlace?: string): { id: number; name: string; photoUrl?: string | null } | null {
    if (!linkedPlace || !pois?.length) return null;
    const lower = linkedPlace.toLowerCase();
    const match = pois.find((p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()));
    if (!match) return null;
    return { id: match.id, name: match.name, photoUrl: match.photoUrl };
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

  function addPoiFromRecommendation(rec: ActivityRecommendation, categoryOverride?: string) {
    const name = rec.linkedPlace || rec.title;
    addPoiAndShowOnMap({
      name,
      category: categoryOverride ?? rec.category ?? "CULTURE",
      description: rec.description,
      latitude: rec.latitude ?? null,
      longitude: rec.longitude ?? null,
    });
  }

  function addNearbyActivityAsPoi(act: NearbyActivityRecommendation, categoryOverride?: string) {
    addPoiAndShowOnMap({
      name: act.title,
      category: categoryOverride ?? act.category ?? "NATURE",
      description: `${act.description}${act.location ? ` (${act.location})` : ""}`,
      latitude: act.latitude ?? null,
      longitude: act.longitude ?? null,
    });
  }

  // The parent for sub-destinations: use current city if top-level, or its parent if subcity
  const subcityParentId = parentCityId ?? cityId;

  const [addingCityName, setAddingCityName] = useState<string | null>(null);

  // Date picker state for sub-destination
  const [pendingSubdestCity, setPendingSubdestCity] = useState<NearbyCityRecommendation | null>(null);
  const [subdestStartDate, setSubdestStartDate] = useState(cityStartDate.slice(0, 10));
  const [subdestEndDate, setSubdestEndDate] = useState(cityEndDate.slice(0, 10));

  function promptSubdestinationDates(city: NearbyCityRecommendation) {
    setSubdestStartDate(cityStartDate.slice(0, 10));
    setSubdestEndDate(cityEndDate.slice(0, 10));
    setPendingSubdestCity(city);
  }

  async function confirmAddSubdestination() {
    const city = pendingSubdestCity;
    if (!city) return;
    setPendingSubdestCity(null);
    setAddingCityName(city.name);
    try {
      // First verify coordinates via geocoding
      let lat = city.latitude ?? null;
      let lng = city.longitude ?? null;
      const verified = await verifyLocation(city.name, city.country);
      if (verified) {
        lat = verified.lat;
        lng = verified.lng;
      }

      const res = await fetch(`/api/trips/${tripId}/cities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: city.name,
          startDate: new Date(subdestStartDate).toISOString(),
          endDate: new Date(subdestEndDate).toISOString(),
          parentCityId: subcityParentId,
          ...(city.country && { country: city.country }),
          ...(lat != null && { latitude: lat }),
          ...(lng != null && { longitude: lng }),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to add sub-destination");
      }
      toast(`Added ${city.name} as sub-destination`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to add sub-destination", { variant: "error" });
    } finally {
      setAddingCityName(null);
    }
  }

  function addCityAsDestination(city: NearbyCityRecommendation) {
    // Navigate to trip page with query params to pre-fill the add form
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
  const hasHikes = data && data.hikes && data.hikes.length > 0;
  const hasCycling = data && data.cycling && data.cycling.length > 0;
  const hasContent = hasRecommendations || hasNearbyCities || hasNearbyActivities || hasHikes || hasCycling;

  // Sections available for "generate more" (not yet generated)
  const generateMoreOptions = [
    ...(!hasHikes ? [{ key: "hikes" as const, label: "🥾 Hikes & walks", state: genHikes, setState: setGenHikes }] : []),
    ...(!hasCycling ? [{ key: "cycling" as const, label: "🚴 Cycling routes", state: genCycling, setState: setGenCycling }] : []),
  ];

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
          {!hasContent && !isLoading && (
            <div className="py-4 space-y-4">
              <p className="text-sm text-[hsl(var(--muted-foreground))] text-center">
                Get AI-generated activity recommendations and must-do experiences for {cityName}.
              </p>

              {/* Initial generation options */}
              <div className="space-y-2 rounded-lg border border-[hsl(var(--border))] p-3 bg-[hsl(var(--muted))]/30 max-w-md mx-auto">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={genMustDo} onChange={(e) => setGenMustDo(e.target.checked)} className="rounded" />
                  Must-do activities
                </label>
                <div className="flex items-center gap-2 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={genNearbyCities} onChange={(e) => setGenNearbyCities(e.target.checked)} className="rounded" />
                    Nearby cities
                  </label>
                  {genNearbyCities && (
                    <span className="inline-flex items-center gap-1 ml-1">
                      <input
                        type="number"
                        value={maxCitiesKm}
                        onChange={(e) => setMaxCitiesKm(e.target.value === "" ? 0 : Number(e.target.value))}
                        onBlur={() => { if (!maxCitiesKm) setMaxCitiesKm(150); }}
                        className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                        min={10}
                        max={500}
                      />
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">km max</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={genNearbyActivities} onChange={(e) => setGenNearbyActivities(e.target.checked)} className="rounded" />
                    Recommended activities nearby
                  </label>
                  {genNearbyActivities && (
                    <span className="inline-flex items-center gap-1 ml-1">
                      <input
                        type="number"
                        value={maxActivitiesKm}
                        onChange={(e) => setMaxActivitiesKm(e.target.value === "" ? 0 : Number(e.target.value))}
                        onBlur={() => { if (!maxActivitiesKm) setMaxActivitiesKm(50); }}
                        className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                        min={5}
                        max={200}
                      />
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">km max</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="text-center">
                <Button
                  type="button"
                  onClick={generate}
                  disabled={isLoading || (!genMustDo && !genNearbyCities && !genNearbyActivities)}
                  className="min-w-[200px]"
                >
                  {"✨"} Generate recommendations
                </Button>
              </div>
            </div>
          )}

          {loadingSection === "all" && (
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
              onRegenerate={() => regenerateSection("mustDo")}
              regenerating={loadingSection === "mustDo"}
              disabled={isLoading}
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
                      onAddPoi={(categoryOverride?: string) => addPoiFromRecommendation(rec, categoryOverride)}
                      addingPoi={addingPoiFor === (rec.linkedPlace || rec.title)}
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
              onRegenerate={() => setRegenSettingsFor((v) => v === "nearbyActivities" ? null : "nearbyActivities")}
              regenerating={loadingSection === "nearbyActivities"}
              disabled={isLoading}
              settingsOpen={regenSettingsFor === "nearbyActivities"}
              settingsPanel={
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                    Max distance
                    <input
                      type="number"
                      value={maxActivitiesKm}
                      onChange={(e) => setMaxActivitiesKm(e.target.value === "" ? 0 : Number(e.target.value))}
                      onBlur={() => { if (!maxActivitiesKm) setMaxActivitiesKm(50); }}
                      className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                      min={5}
                      max={200}
                    />
                    km
                  </span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => { setRegenSettingsFor(null); regenerateSection("nearbyActivities"); }}
                      disabled={isLoading}
                      className="h-7 text-xs px-2.5"
                    >
                      {loadingSection === "nearbyActivities" ? <><span className="spinner !h-3 !w-3" /> Regenerating…</> : <>{"🔄"} Regenerate</>}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setRegenSettingsFor(null)}
                      className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {data!.nearbyActivities.map((act, i) => (
                  <NearbyActivityCard
                    key={i}
                    activity={act}
                    onAddPoi={(categoryOverride?: string) => addNearbyActivityAsPoi(act, categoryOverride)}
                    addingPoi={addingPoiFor === act.title}
                  />
                ))}
              </div>
            </CollapsibleSubsection>
          )}

          {hasHikes && (
            <CollapsibleSubsection
              title="🥾 Hikes & walks"
              count={data!.hikes.length}
              open={hikesOpen}
              onToggle={() => setHikesOpen((v) => !v)}
              onRegenerate={() => regenerateSection("hikes")}
              regenerating={loadingSection === "hikes"}
              disabled={isLoading}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {data!.hikes.map((hike, i) => (
                  <RouteCard
                    key={i}
                    route={hike}
                    icon="🥾"
                    onAddPoi={(categoryOverride?: string) => {
                      addPoiAndShowOnMap({
                        name: hike.title,
                        category: categoryOverride ?? "NATURE",
                        description: hike.description,
                        latitude: hike.latitude ?? null,
                        longitude: hike.longitude ?? null,
                      });
                    }}
                    addingPoi={addingPoiFor === hike.title}
                  />
                ))}
              </div>
            </CollapsibleSubsection>
          )}

          {hasCycling && (
            <CollapsibleSubsection
              title="🚴 Cycling routes"
              count={data!.cycling.length}
              open={cyclingOpen}
              onToggle={() => setCyclingOpen((v) => !v)}
              onRegenerate={() => regenerateSection("cycling")}
              regenerating={loadingSection === "cycling"}
              disabled={isLoading}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {data!.cycling.map((route, i) => (
                  <RouteCard
                    key={i}
                    route={route}
                    icon="🚴"
                    onAddPoi={(categoryOverride?: string) => {
                      addPoiAndShowOnMap({
                        name: route.title,
                        category: categoryOverride ?? "NATURE",
                        description: route.description,
                        latitude: route.latitude ?? null,
                        longitude: route.longitude ?? null,
                      });
                    }}
                    addingPoi={addingPoiFor === route.title}
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
              onRegenerate={() => setRegenSettingsFor((v) => v === "nearbyCities" ? null : "nearbyCities")}
              regenerating={loadingSection === "nearbyCities"}
              disabled={isLoading}
              settingsOpen={regenSettingsFor === "nearbyCities"}
              settingsPanel={
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
                    Max distance
                    <input
                      type="number"
                      value={maxCitiesKm}
                      onChange={(e) => setMaxCitiesKm(e.target.value === "" ? 0 : Number(e.target.value))}
                      onBlur={() => { if (!maxCitiesKm) setMaxCitiesKm(150); }}
                      className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                      min={10}
                      max={500}
                    />
                    km
                  </span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => { setRegenSettingsFor(null); regenerateSection("nearbyCities"); }}
                      disabled={isLoading}
                      className="h-7 text-xs px-2.5"
                    >
                      {loadingSection === "nearbyCities" ? <><span className="spinner !h-3 !w-3" /> Regenerating…</> : <>{"🔄"} Regenerate</>}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setRegenSettingsFor(null)}
                      className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              }
            >
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {[...data!.nearbyCities].sort((a, b) => {
                  const numA = parseFloat((a.distance ?? "").replace(/[^0-9.]/g, "")) || 0;
                  const numB = parseFloat((b.distance ?? "").replace(/[^0-9.]/g, "")) || 0;
                  return numA - numB;
                }).map((city, i) => (
                  <NearbyCityCard
                    key={i}
                    city={city}
                    onAddAsSubdestination={() => promptSubdestinationDates(city)}
                    onAddAsDestination={() => addCityAsDestination(city)}
                    adding={addingCityName === city.name}
                  />
                ))}
              </div>
            </CollapsibleSubsection>
          )}

          {/* Generate more panel — shown when there are ungenerated optional sections */}
          {hasContent && generateMoreOptions.length > 0 && (
            !showGenerateMore ? (
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setShowGenerateMore(true)}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50"
                >
                  + Generate more
                </button>
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-dashed border-[hsl(var(--border))] p-3 bg-[hsl(var(--muted))]/20 max-w-sm mx-auto">
                <p className="text-xs font-medium text-[hsl(var(--foreground))]">Generate additional sections:</p>
                {generateMoreOptions.map((opt) => (
                  <label key={opt.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={opt.state} onChange={(e) => opt.setState(e.target.checked)} className="rounded" />
                    {opt.label}
                  </label>
                ))}
                <div className="flex items-center justify-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    onClick={generateMore}
                    disabled={isLoading || generateMoreOptions.every((o) => !o.state)}
                  >
                    {loadingSection === "more" ? (
                      <><span className="spinner !h-3 !w-3" /> Generating…</>
                    ) : (
                      <>{"✨"} Generate</>
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setShowGenerateMore(false)}
                    disabled={isLoading}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )
          )}

          {hasContent && (
            <p className="text-[10px] text-center text-[hsl(var(--muted-foreground))]">
              Generated {new Date(data!.generatedAt).toLocaleDateString()} · {data!.model}
            </p>
          )}
        </CardContent>
      )}

      {/* Date picker modal for sub-destination */}
      {pendingSubdestCity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setPendingSubdestCity(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">
              Add {pendingSubdestCity.name} as sub-destination
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[hsl(var(--foreground))]">Start date</label>
                <input
                  type="date"
                  value={subdestStartDate}
                  min={cityStartDate.slice(0, 10)}
                  max={subdestEndDate}
                  onChange={(e) => setSubdestStartDate(e.target.value)}
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm text-[hsl(var(--foreground))]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[hsl(var(--foreground))]">End date</label>
                <input
                  type="date"
                  value={subdestEndDate}
                  min={subdestStartDate}
                  max={cityEndDate.slice(0, 10)}
                  onChange={(e) => setSubdestEndDate(e.target.value)}
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm text-[hsl(var(--foreground))]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setPendingSubdestCity(null)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={confirmAddSubdestination}>
                Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function CollapsibleSubsection({
  title,
  count,
  open,
  onToggle,
  onRegenerate,
  regenerating,
  disabled,
  settingsOpen,
  settingsPanel,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
  disabled?: boolean;
  /** When true, settingsPanel is rendered between header and children */
  settingsOpen?: boolean;
  /** Panel shown when settingsOpen is true (e.g. distance input + confirm) */
  settingsPanel?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 group text-left"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] transition-transform duration-150 ${open ? "rotate-90" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-sm font-bold text-[hsl(var(--foreground))] group-hover:text-[hsl(var(--primary))] transition-colors">
            {title}
          </span>
          <span className="rounded-full bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">
            {count}
          </span>
        </button>
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={disabled || regenerating}
            className={`inline-flex items-center gap-1 text-[10px] font-medium transition-colors disabled:opacity-40 ${
              settingsOpen
                ? "text-[hsl(var(--primary))]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"
            }`}
            title="Regenerate this section"
          >
            {regenerating ? (
              <><span className="spinner !h-3 !w-3" /> Regenerating…</>
            ) : (
              <><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg> Regenerate</>
            )}
          </button>
        )}
      </div>
      {settingsOpen && settingsPanel}
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
  poiLink: { id: number; name: string; photoUrl?: string | null } | null;
  onAddPoi: (categoryOverride?: string) => void;
  addingPoi: boolean;
}) {
  const category = (rec.category ?? "CULTURE") as Category;
  const catStyle = CATEGORY_STYLES[category];
  const catIcon = CATEGORY_ICONS[category] ?? "";
  const [addOpen, setAddOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>(category);
  const [imgError, setImgError] = useState(false);
  const photoSrc = poiLink?.photoUrl ? `/api/pois/${poiLink.id}/photo` : null;

  return (
    <div
      className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden transition-all hover:bg-[hsl(var(--muted))]/50 shadow-sm"
      style={{ borderLeftWidth: 3, borderLeftColor: catStyle?.dot ?? "hsl(var(--border))" }}
    >
      {/* Photo banner */}
      {photoSrc && !imgError && (
        <div className="h-28 w-full overflow-hidden bg-[hsl(var(--muted))]/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoSrc} alt={rec.title} className="h-full w-full object-cover" onError={() => setImgError(true)} />
        </div>
      )}
      <div className="p-3 space-y-1.5">
      <div className="flex items-start gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))]/10 text-[10px] font-bold text-[hsl(var(--primary))]">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs shrink-0">{catIcon}</span>
            <h4 className="text-sm font-semibold leading-tight">{rec.title}</h4>
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed mt-1">
            {rec.description}
          </p>
        </div>
      </div>
      <div className="pl-7 flex flex-wrap items-center gap-x-3 gap-y-1">
        {/* Show linked place link if POI exists */}
        {poiLink && rec.linkedPlace && (
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("focus-poi-on-map", { detail: { poiId: poiLink.id } }),
              );
            }}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
          >
            {"📍"} {rec.linkedPlace}
          </button>
        )}
        {/* Show place name if linked but no POI yet */}
        {!poiLink && rec.linkedPlace && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
            {"📍"} {rec.linkedPlace}
          </span>
        )}
        {/* Add as POI — toggle inline category picker */}
        {!addOpen ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            disabled={addingPoi}
            className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50 ml-auto"
          >
            {addingPoi ? <span className="spinner !h-3 !w-3" /> : "+"}
            {addingPoi ? "Adding…" : "Add as POI"}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 ml-auto">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-[10px]"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { onAddPoi(selectedCategory); setAddOpen(false); }}
              disabled={addingPoi}
              className="rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-2 py-0.5 text-[10px] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {addingPoi ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function NearbyActivityCard({
  activity,
  onAddPoi,
  addingPoi,
}: {
  activity: NearbyActivityRecommendation;
  onAddPoi: (categoryOverride?: string) => void;
  addingPoi: boolean;
}) {
  const category = (activity.category ?? "NATURE") as Category;
  const catStyle = CATEGORY_STYLES[category];
  const catIcon = CATEGORY_ICONS[category] ?? "🏞️";
  const [addOpen, setAddOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>(category);

  return (
    <div
      className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 space-y-1.5 transition-all hover:bg-[hsl(var(--muted))]/50 shadow-sm"
      style={{ borderLeftWidth: 3, borderLeftColor: catStyle?.dot ?? "hsl(var(--border))" }}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold leading-tight flex items-center gap-1.5">
          <span className="text-xs">{catIcon}</span>
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {activity.location && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
            {"📍"} {activity.location}
          </span>
        )}
        {/* Add as POI — toggle inline category picker */}
        {!addOpen ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            disabled={addingPoi}
            className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50 ml-auto"
          >
            {addingPoi ? <span className="spinner !h-3 !w-3" /> : "+"}
            {addingPoi ? "Adding…" : "Add as POI"}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 ml-auto">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-[10px]"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { onAddPoi(selectedCategory); setAddOpen(false); }}
              disabled={addingPoi}
              className="rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-2 py-0.5 text-[10px] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {addingPoi ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function NearbyCityCard({
  city,
  onAddAsSubdestination,
  onAddAsDestination,
  adding,
}: {
  city: NearbyCityRecommendation;
  onAddAsSubdestination: () => void;
  onAddAsDestination: () => void;
  adding?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-gradient-to-br from-[hsl(var(--card))] to-[hsl(var(--muted))]/30 p-4 space-y-1.5 transition-all hover:shadow-sm shadow-sm">
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
      <div className="pt-1 flex items-center gap-3">
        <button
          type="button"
          onClick={onAddAsSubdestination}
          disabled={adding}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50"
        >
          {adding ? <span className="spinner !h-3 !w-3" /> : "+"}
          {adding ? "Adding…" : "Add as sub-destination"}
        </button>
        <button
          type="button"
          onClick={onAddAsDestination}
          disabled={adding}
          className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:underline disabled:opacity-50"
        >
          or add as destination
        </button>
      </div>
    </div>
  );
}

function RouteCard({
  route,
  icon,
  onAddPoi,
  addingPoi,
}: {
  route: HikeRecommendation | CyclingRecommendation;
  icon: string;
  onAddPoi: (categoryOverride?: string) => void;
  addingPoi: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("NATURE");

  const difficultyColor = route.difficulty === "challenging"
    ? "text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400"
    : route.difficulty === "moderate"
      ? "text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-400"
      : "text-green-600 bg-green-50 dark:bg-green-950 dark:text-green-400";

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 space-y-1.5 transition-all hover:bg-[hsl(var(--muted))]/50 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold leading-tight flex items-center gap-1.5">
          <span className="text-xs">{icon}</span>
          {route.title}
        </h4>
        {route.difficulty && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${difficultyColor}`}>
            {route.difficulty}
          </span>
        )}
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
        {route.description}
      </p>
      {/* Route meta */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {route.distance && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] flex items-center gap-0.5">
            📏 {route.distance}
          </span>
        )}
        {route.duration && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] flex items-center gap-0.5">
            ⏱ {route.duration}
          </span>
        )}
        {route.startLocation && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] flex items-center gap-0.5">
            📍 {route.startLocation}
          </span>
        )}
        {/* Add as POI */}
        {!addOpen ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            disabled={addingPoi}
            className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50 ml-auto"
          >
            {addingPoi ? <span className="spinner !h-3 !w-3" /> : "+"}
            {addingPoi ? "Adding…" : "Add as POI"}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 ml-auto">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-[10px]"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => { onAddPoi(selectedCategory); setAddOpen(false); }}
              disabled={addingPoi}
              className="rounded bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-2 py-0.5 text-[10px] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {addingPoi ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
