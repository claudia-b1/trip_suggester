"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type {
  ActivityRecommendation,
  NearbyCityRecommendation,
  NearbyActivityRecommendation,
  HikeRecommendation,
  CyclingRecommendation,
  ActivityRecommendationsResult,
} from "@/lib/activity-recommendations";
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS, CATEGORY_STYLES, type Category } from "@/lib/categories";
import { DEFAULT_NEARBY_CITIES_KM, DEFAULT_NEARBY_ACTIVITIES_KM } from "@/lib/constants";
import { formatDistance } from "@/lib/use-settings";
import { haversineKm, bearingDeg, compassLabel } from "@/lib/geo";

/**
 * Parse a distance string from AI (e.g. "~30 km", "45 km") and re-format
 * it using the user's preferred unit. Falls back to the raw string if the
 * numeric value can't be extracted.
 */
function formatDistanceString(raw: string): string {
  const match = raw.match(/([\d.]+)\s*km/i);
  if (!match) return raw;
  const km = parseFloat(match[1]);
  if (isNaN(km)) return raw;
  const prefix = raw.startsWith("~") ? "~" : "";
  return `${prefix}${formatDistance(km)}`;
}

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
  cityLatitude,
  cityLongitude,
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
  /** City coordinates — used to compute distance to recommendation items */
  cityLatitude?: number | null;
  cityLongitude?: number | null;
  initialData: ActivityRecommendationsResult | null;
  /** Existing POIs — used to link recommendations to POIs and show their photos */
  pois?: { id: number; name: string; photoUrl?: string | null; isUnescoSite?: boolean | null }[];
  /** If this city is a subcity, its parentCityId; null for top-level */
  parentCityId?: number | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
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
  const [maxCitiesKm, setMaxCitiesKm] = useState(DEFAULT_NEARBY_CITIES_KM);
  const [maxActivitiesKm, setMaxActivitiesKm] = useState(DEFAULT_NEARBY_ACTIVITIES_KM);

  // "Generate more" panel
  const [showGenerateMore, setShowGenerateMore] = useState(false);
  const [genHikes, setGenHikes] = useState(false);
  const [genCycling, setGenCycling] = useState(false);

  // Custom section state
  const [customPrompt, setCustomPrompt] = useState("");
  const [customSectionOpenIds, setCustomSectionOpenIds] = useState<Set<string>>(new Set());
  /** Which custom section is being regenerated (shows inline prompt editor) */
  const [regenCustomId, setRegenCustomId] = useState<string | null>(null);
  const [regenCustomPrompt, setRegenCustomPrompt] = useState("");

  // Per-section regenerate settings (for sections with configurable distance)
  const [regenSettingsFor, setRegenSettingsFor] = useState<string | null>(null);

  // Abort controller for cancelling in-flight recommendation requests
  const abortRef = useRef<AbortController | null>(null);

  function cancelGeneration() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoadingSection(null);
    toast("Generation cancelled");
  }

  // ── Search, filter & batch-select state ──
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategories, setFilterCategories] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [selectedRecIds, setSelectedRecIds] = useState<Set<string>>(new Set());
  const [batchAdding, setBatchAdding] = useState(false);

  // Subsection collapse state (all open by default)
  const [mustDoOpen, setMustDoOpen] = useState(true);
  const [nearbyActivitiesOpen, setNearbyActivitiesOpen] = useState(true);
  const [nearbyCitiesOpen, setNearbyCitiesOpen] = useState(true);
  const [hikesOpen, setHikesOpen] = useState(true);
  const [cyclingOpen, setCyclingOpen] = useState(true);

  // Sync with server-provided initial data
  /** Compute distance in km from the city centre to a recommendation item.
   *  Returns undefined if either city or item coordinates are missing. */
  function distanceFromCity(rec: { latitude?: number; longitude?: number }): number | undefined {
    if (cityLatitude == null || cityLongitude == null) return undefined;
    if (rec.latitude == null || rec.longitude == null) return undefined;
    return haversineKm(cityLatitude, cityLongitude, rec.latitude, rec.longitude);
  }

  /** Compute compass direction label from city centre to a recommendation item. */
  function directionFromCity(rec: { latitude?: number; longitude?: number }): string | undefined {
    if (cityLatitude == null || cityLongitude == null) return undefined;
    if (rec.latitude == null || rec.longitude == null) return undefined;
    return compassLabel(bearingDeg(cityLatitude, cityLongitude, rec.latitude, rec.longitude));
  }

  /** Check if a recommendation item matches the current search/filter criteria */
  function matchesFilter(item: { title: string; description: string; linkedPlace?: string; category?: string }): boolean {
    // Category filter
    if (filterCategories.size > 0 && !filterCategories.has(item.category ?? "CULTURE")) return false;
    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const haystack = `${item.title} ${item.description} ${item.linkedPlace ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }

  /** Collect all unique categories present in the current recommendations data */
  function collectCategories(): string[] {
    if (!data) return [];
    const cats = new Set<string>();
    data.recommendations.forEach((r) => cats.add(r.category ?? "CULTURE"));
    data.nearbyActivities.forEach((r) => cats.add(r.category ?? "NATURE"));
    data.hikes.forEach(() => cats.add("NATURE"));
    data.cycling.forEach(() => cats.add("NATURE"));
    data.customSections?.forEach((s) => s.items.forEach((r) => cats.add(r.category ?? "CULTURE")));
    return Array.from(cats);
  }

  /** Toggle a recommendation in the selection set */
  function toggleSelection(recId: string) {
    setSelectedRecIds((prev) => {
      const next = new Set(prev);
      if (next.has(recId)) next.delete(recId);
      else next.add(recId);
      return next;
    });
  }

  /** Collect all selectable rec data keyed by ID — used for batch add */
  function collectRecDataById(): Map<string, { name: string; category: string; description: string; latitude: number | null; longitude: number | null }> {
    const map = new Map<string, { name: string; category: string; description: string; latitude: number | null; longitude: number | null }>();
    if (!data) return map;
    data.recommendations.forEach((rec, i) => {
      map.set(`rec-mustdo-${i}`, { name: rec.linkedPlace || rec.title, category: rec.category ?? "CULTURE", description: buildRecDescription(rec), latitude: rec.latitude ?? null, longitude: rec.longitude ?? null });
    });
    data.nearbyActivities.forEach((act, i) => {
      map.set(`rec-nearby-${i}`, { name: act.title, category: act.category ?? "NATURE", description: buildNearbyActivityDescription(act), latitude: act.latitude ?? null, longitude: act.longitude ?? null });
    });
    data.hikes.forEach((hike, i) => {
      map.set(`rec-hike-${i}`, { name: hike.title, category: "NATURE", description: buildRouteDescription(hike), latitude: hike.latitude ?? null, longitude: hike.longitude ?? null });
    });
    data.cycling.forEach((route, i) => {
      map.set(`rec-cycling-${i}`, { name: route.title, category: "NATURE", description: buildRouteDescription(route), latitude: route.latitude ?? null, longitude: route.longitude ?? null });
    });
    data.customSections?.forEach((section) => {
      section.items.forEach((rec, i) => {
        map.set(`rec-custom-${section.id}-${i}`, { name: rec.linkedPlace || rec.title, category: rec.category ?? "CULTURE", description: buildRecDescription(rec), latitude: rec.latitude ?? null, longitude: rec.longitude ?? null });
      });
    });
    return map;
  }

  /** Batch add all selected recommendations as POIs */
  async function batchAddSelectedAsPois() {
    const recDataById = collectRecDataById();
    const toAdd = Array.from(selectedRecIds).map((id) => recDataById.get(id)).filter(Boolean) as { name: string; category: string; description: string; latitude: number | null; longitude: number | null }[];
    if (toAdd.length === 0) return;

    setBatchAdding(true);
    let succeeded = 0;
    let failed = 0;

    const results = await Promise.allSettled(
      toAdd.map(async (poiData) => {
        // Verify location via geocoding
        let verifiedLat = poiData.latitude;
        let verifiedLng = poiData.longitude;
        const searchQueries = [
          `${poiData.name}, ${cityName}${country ? `, ${country}` : ""}`,
          country ? `${poiData.name}, ${country}` : null,
          poiData.name,
        ].filter(Boolean) as string[];

        for (const query of searchQueries) {
          const params = new URLSearchParams({ action: "geocode", address: query });
          if (country) params.set("country", country);
          try {
            const geoRes = await fetch(`/api/geocode?${params}`);
            if (geoRes.ok) {
              const geoData = (await geoRes.json()) as { lat?: number; lng?: number };
              if (typeof geoData.lat === "number" && typeof geoData.lng === "number" && (geoData.lat !== 0 || geoData.lng !== 0)) {
                verifiedLat = geoData.lat;
                verifiedLng = geoData.lng;
                break;
              }
            }
          } catch { /* try next */ }
        }
        if (verifiedLat === 0 && verifiedLng === 0) { verifiedLat = null; verifiedLng = null; }

        const res = await fetch(`/api/cities/${cityId}/pois`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...poiData, latitude: verifiedLat, longitude: verifiedLng }),
        });
        if (!res.ok) throw new Error("Failed");
        return res.json();
      }),
    );

    results.forEach((r) => { if (r.status === "fulfilled") succeeded++; else failed++; });
    const msg = failed > 0 ? `Added ${succeeded} of ${succeeded + failed} items (${failed} failed)` : `Added ${succeeded} items as POIs`;
    toast(msg, { variant: failed > 0 ? "error" : undefined });
    setSelectedRecIds(new Set());
    setSelectMode(false);
    setBatchAdding(false);
    router.refresh();
  }

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      // Auto-open any existing custom sections
      if (initialData.customSections?.length) {
        setCustomSectionOpenIds(new Set(initialData.customSections.map((s) => s.id)));
      }
    }
  }, [initialData]);

  // Emit preview markers to the map whenever recommendation data changes
  useEffect(() => {
    if (!data) {
      (window as any).__recommendationMarkers = [];
      window.dispatchEvent(new CustomEvent("recommendation-markers", { detail: { items: [] } }));
      return;
    }
    type MarkerItem = { id: string; title: string; description: string; category: string; latitude: number; longitude: number; sectionLabel: string; linkedPlace?: string; recData: { name: string; category: string; description: string; latitude: number; longitude: number } };
    const items: MarkerItem[] = [];

    // Client-side distance guard — defence in depth for old cached data
    const hasCity = cityLatitude != null && cityLongitude != null;
    const nearCity = (lat: number, lon: number, maxKm: number) =>
      !hasCity || haversineKm(cityLatitude!, cityLongitude!, lat, lon) <= maxKm;

    // Must-do recommendations — skip items already linked to a POI
    data.recommendations.forEach((rec, i) => {
      if (rec.latitude != null && rec.longitude != null && !findPoiLink(rec.linkedPlace) && nearCity(rec.latitude, rec.longitude, 50)) {
        items.push({
          id: `rec-mustdo-${i}`,
          title: rec.title,
          description: rec.description,
          category: rec.category ?? "CULTURE",
          latitude: rec.latitude,
          longitude: rec.longitude,
          sectionLabel: "Must-do",
          linkedPlace: rec.linkedPlace,
          recData: { name: rec.linkedPlace || rec.title, category: rec.category ?? "CULTURE", description: buildRecDescription(rec), latitude: rec.latitude, longitude: rec.longitude },
        });
      }
    });
    // Nearby activities
    data.nearbyActivities.forEach((act, i) => {
      if (act.latitude != null && act.longitude != null && nearCity(act.latitude, act.longitude, 150)) {
        items.push({
          id: `rec-nearby-${i}`,
          title: act.title,
          description: act.description,
          category: act.category ?? "NATURE",
          latitude: act.latitude,
          longitude: act.longitude,
          sectionLabel: "Nearby",
          recData: { name: act.title, category: act.category ?? "NATURE", description: buildNearbyActivityDescription(act), latitude: act.latitude, longitude: act.longitude },
        });
      }
    });
    // Hikes
    data.hikes.forEach((hike, i) => {
      if (hike.latitude != null && hike.longitude != null && nearCity(hike.latitude, hike.longitude, 100)) {
        items.push({
          id: `rec-hike-${i}`,
          title: hike.title,
          description: hike.description,
          category: "NATURE",
          latitude: hike.latitude,
          longitude: hike.longitude,
          sectionLabel: "Hike",
          recData: { name: hike.title, category: "NATURE", description: buildRouteDescription(hike), latitude: hike.latitude, longitude: hike.longitude },
        });
      }
    });
    // Cycling
    data.cycling.forEach((route, i) => {
      if (route.latitude != null && route.longitude != null && nearCity(route.latitude, route.longitude, 100)) {
        items.push({
          id: `rec-cycling-${i}`,
          title: route.title,
          description: route.description,
          category: "NATURE",
          latitude: route.latitude,
          longitude: route.longitude,
          sectionLabel: "Cycling",
          recData: { name: route.title, category: "NATURE", description: buildRouteDescription(route), latitude: route.latitude, longitude: route.longitude },
        });
      }
    });
    // Custom sections — skip items already linked to a POI
    data.customSections?.forEach((section) => {
      section.items.forEach((rec, i) => {
        if (rec.latitude != null && rec.longitude != null && !findPoiLink(rec.linkedPlace) && nearCity(rec.latitude, rec.longitude, 50)) {
          items.push({
            id: `rec-custom-${section.id}-${i}`,
            title: rec.title,
            description: rec.description,
            category: rec.category ?? "CULTURE",
            latitude: rec.latitude,
            longitude: rec.longitude,
            sectionLabel: section.title,
            linkedPlace: rec.linkedPlace,
            recData: { name: rec.linkedPlace || rec.title, category: rec.category ?? "CULTURE", description: buildRecDescription(rec), latitude: rec.latitude, longitude: rec.longitude },
          });
        }
      });
    });
    (window as any).__recommendationMarkers = items;
    window.dispatchEvent(new CustomEvent("recommendation-markers", { detail: { items } }));
  }, [data, cityName, country, pois, cityLatitude, cityLongitude]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for "add-recommendation-poi" from map preview popup
  useEffect(() => {
    function handleAddFromMap(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.recData) return;
      addPoiAndShowOnMap(detail.recData);
    }
    window.addEventListener("add-recommendation-poi", handleAddFromMap);
    return () => window.removeEventListener("add-recommendation-poi", handleAddFromMap);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId]);

  // Listen for "recommendation-focused" from map (when a preview marker is clicked on the map)
  // action: "highlight" = just highlight the card border (no scroll)
  // action: "scroll"    = scroll to the card and pulse it
  const [focusedRecId, setFocusedRecId] = useState<string | null>(null);
  useEffect(() => {
    function handleFocused(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail?.id) return;
      setFocusedRecId(detail.id);
      if (detail.action === "scroll") {
        const el = document.querySelector(`[data-rec-id="${detail.id}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("rec-card-pulse");
          setTimeout(() => el.classList.remove("rec-card-pulse"), 2000);
        }
      }
      // Clear after animation
      setTimeout(() => setFocusedRecId(null), 2000);
    }
    window.addEventListener("recommendation-focused", handleFocused);
    return () => window.removeEventListener("recommendation-focused", handleFocused);
  }, []);

  /** Initial generation — produces the three default sections */
  async function generate() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingSection("all");
    setError(null);
    try {
      const res = await fetch(`/api/cities/${cityId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          includeMustDo: genMustDo,
          includeNearbyCities: genNearbyCities,
          includeNearbyActivities: genNearbyActivities,
          includeHikes: genHikes,
          includeCycling: genCycling,
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
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      toast(msg, { variant: "error" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoadingSection((prev) => prev === "all" ? null : prev);
    }
  }

  /** Regenerate a single section, preserving all others via server-side merge */
  async function regenerateSection(section: "mustDo" | "nearbyCities" | "nearbyActivities" | "hikes" | "cycling") {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingSection(section);
    setError(null);
    try {
      const res = await fetch(`/api/cities/${cityId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
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
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      toast(msg, { variant: "error" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoadingSection((prev) => prev === section ? null : prev);
    }
  }

  /** Generate additional sections via "Generate other" */
  async function generateMore() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingSection("more");
    setError(null);
    try {
      const res = await fetch(`/api/cities/${cityId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          includeMustDo: !hasRecommendations && genMustDo,
          includeNearbyCities: !hasNearbyCities && genNearbyCities,
          includeNearbyActivities: !hasNearbyActivities && genNearbyActivities,
          includeHikes: !hasHikes && genHikes,
          includeCycling: !hasCycling && genCycling,
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
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      toast(msg, { variant: "error" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoadingSection((prev) => prev === "more" ? null : prev);
    }
  }

  /** Generate a custom section from a user prompt */
  async function generateCustomSection(prompt: string, existingSectionId?: string) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const sectionKey = existingSectionId ?? `generating-custom`;
    setLoadingSection(sectionKey);
    setError(null);
    try {
      const res = await fetch(`/api/cities/${cityId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          includeMustDo: false,
          includeNearbyCities: false,
          includeNearbyActivities: false,
          includeHikes: false,
          includeCycling: false,
          customPrompt: prompt,
          ...(existingSectionId && { customSectionId: existingSectionId }),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to generate custom recommendations");
      }
      const result: ActivityRecommendationsResult = await res.json();
      setData(result);
      setCustomPrompt("");
      setRegenCustomId(null);
      setRegenCustomPrompt("");
      // Auto-open the new section
      const newSection = (result.customSections ?? []).find((s) =>
        existingSectionId ? s.id === existingSectionId : !data?.customSections?.some((old) => old.id === s.id),
      );
      if (newSection) {
        setCustomSectionOpenIds((prev) => new Set([...prev, newSection.id]));
      }
      toast(existingSectionId ? "Regenerated custom section" : "Generated custom recommendations");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      toast(msg, { variant: "error" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoadingSection((prev) => prev === sectionKey ? null : prev);
    }
  }

  /** Delete a custom section from the cached data */
  /** Delete a custom section — update local state immediately, persist in background */
  async function deleteCustomSection(sectionId: string) {
    if (!data) return;
    // Optimistic local update
    setData({
      ...data,
      customSections: (data.customSections ?? []).filter((s) => s.id !== sectionId),
    });
    setRegenCustomId(null);
    setRegenCustomPrompt("");
    toast("Custom section removed");
    // Persist to server
    try {
      await fetch(`/api/cities/${cityId}/activities/custom/${sectionId}`, { method: "DELETE" });
    } catch { /* non-critical — local state is already updated */ }
  }

  /** Delete all recommendations — clears the cached data on the server */
  async function deleteAllRecommendations() {
    const ok = await confirm({
      message: "Delete all recommendations? This will remove all generated activity suggestions, nearby cities, hikes, cycling routes, and custom sections for this city.",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/cities/${cityId}/activities`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setData(null);
      setShowGenerateMore(false);
      setCustomPrompt("");
      toast("All recommendations deleted");
    } catch {
      toast("Failed to delete recommendations", { variant: "error" });
    }
  }

  // Try to find a matching POI for a linked place name
  function findPoiLink(linkedPlace?: string): { id: number; name: string; photoUrl?: string | null; isUnescoSite?: boolean | null } | null {
    if (!linkedPlace || !pois?.length) return null;
    const lower = linkedPlace.toLowerCase();
    const match = pois.find((p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()));
    if (!match) return null;
    return { id: match.id, name: match.name, photoUrl: match.photoUrl, isUnescoSite: match.isUnescoSite };
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
    // Scroll to POIs section immediately so the user sees the map
    document.getElementById("pois-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  /** Build a rich description for a POI created from a recommendation, including all metadata */
  function buildRecDescription(rec: ActivityRecommendation): string {
    const name = rec.linkedPlace || rec.title;
    // If POI name differs from rec title (e.g. using linkedPlace), prepend the title for context
    const parts: string[] = [];
    if (name !== rec.title) parts.push(rec.title);
    parts.push(rec.description);
    return parts.join("\n\n");
  }

  function buildNearbyActivityDescription(act: NearbyActivityRecommendation): string {
    const parts = [act.description];
    const meta: string[] = [];
    if (act.location) meta.push(`Location: ${act.location}`);
    if (act.distance) meta.push(`Distance from ${cityName}: ${act.distance}`);
    if (meta.length) parts.push(meta.join("\n"));
    return parts.join("\n\n");
  }

  function buildRouteDescription(route: HikeRecommendation | CyclingRecommendation): string {
    const parts = [route.description];
    const meta: string[] = [];
    if (route.distance) meta.push(`Distance: ${route.distance}`);
    if (route.duration) meta.push(`Duration: ${route.duration}`);
    if (route.difficulty) meta.push(`Difficulty: ${route.difficulty}`);
    if (route.startLocation) meta.push(`Start: ${route.startLocation}`);
    if (meta.length) parts.push(meta.join("\n"));
    return parts.join("\n\n");
  }

  function addPoiFromRecommendation(rec: ActivityRecommendation, categoryOverride?: string) {
    const name = rec.linkedPlace || rec.title;
    addPoiAndShowOnMap({
      name,
      category: categoryOverride ?? rec.category ?? "CULTURE",
      description: buildRecDescription(rec),
      latitude: rec.latitude ?? null,
      longitude: rec.longitude ?? null,
    });
  }

  function addNearbyActivityAsPoi(act: NearbyActivityRecommendation, categoryOverride?: string) {
    addPoiAndShowOnMap({
      name: act.title,
      category: categoryOverride ?? act.category ?? "NATURE",
      description: buildNearbyActivityDescription(act),
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
  const hasCustomSections = data && data.customSections && data.customSections.length > 0;
  const hasContent = hasRecommendations || hasNearbyCities || hasNearbyActivities || hasHikes || hasCycling || hasCustomSections;

  // Sections available for "generate more" — show any sections not already generated
  const generateMoreOptions = [
    ...(!hasRecommendations ? [{ key: "mustDo" as const, label: "Must-do activities", state: genMustDo, setState: setGenMustDo }] : []),
    ...(!hasNearbyCities ? [{ key: "nearbyCities" as const, label: "Nearby cities", state: genNearbyCities, setState: setGenNearbyCities }] : []),
    ...(!hasNearbyActivities ? [{ key: "nearbyActivities" as const, label: "Recommended activities nearby", state: genNearbyActivities, setState: setGenNearbyActivities }] : []),
    ...(!hasHikes ? [{ key: "hikes" as const, label: "🥾 Hikes & walks", state: genHikes, setState: setGenHikes }] : []),
    ...(!hasCycling ? [{ key: "cycling" as const, label: "🚴 Cycling routes", state: genCycling, setState: setGenCycling }] : []),
  ];

  return (
    <Card id="recommendations-section">
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
                {hasNearbyCities ? ` · ${data!.nearbyCities.length} cities` : ""}
                {hasCustomSections ? ` · ${data!.customSections.length} custom` : ""})
              </span>
            )}
          </CardTitle>
        </button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-5 overflow-hidden">
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
                        onBlur={() => { if (!maxCitiesKm) setMaxCitiesKm(DEFAULT_NEARBY_CITIES_KM); }}
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
                        onBlur={() => { if (!maxActivitiesKm) setMaxActivitiesKm(DEFAULT_NEARBY_ACTIVITIES_KM); }}
                        className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                        min={5}
                        max={200}
                      />
                      <span className="text-[10px] text-[hsl(var(--muted-foreground))]">km max</span>
                    </span>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={genHikes} onChange={(e) => setGenHikes(e.target.checked)} className="rounded" />
                  🥾 Hikes & walks
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={genCycling} onChange={(e) => setGenCycling(e.target.checked)} className="rounded" />
                  🚴 Cycling routes
                </label>
              </div>

              <div className="text-center">
                {loadingSection === "all" ? (
                  <Button
                    type="button"
                    onClick={cancelGeneration}
                    variant="outline"
                    className="min-w-[200px] border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    ✕ Cancel generation
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={generate}
                    disabled={isLoading || (!genMustDo && !genNearbyCities && !genNearbyActivities && !genHikes && !genCycling)}
                    className="min-w-[200px]"
                  >
                    {"✨"} Generate recommendations
                  </Button>
                )}
              </div>

              {/* Generate other — custom prompt section */}
              <div className="space-y-2 rounded-lg border border-dashed border-[hsl(var(--border))] p-3 bg-[hsl(var(--muted))]/20 max-w-md mx-auto">
                <p className="text-xs font-medium text-[hsl(var(--foreground))]">Or ask for something specific:</p>
                <div className="flex flex-wrap gap-1">
                  {[
                    "Best neighborhoods to explore",
                    "Local food & dishes to try",
                    "Best wine bars & cocktail bars",
                    "Live music & nightlife spots",
                    "Shopping streets & districts",
                    "Family-friendly activities",
                    "Free things to do",
                    "Rainy day activities",
                    "Best viewpoints & photo spots",
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      disabled={isLoading}
                      onClick={() => setCustomPrompt(chip)}
                      className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[11px] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition disabled:opacity-50"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Or type your own question..."
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1.5 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customPrompt.trim()) {
                      generateCustomSection(customPrompt.trim());
                    }
                  }}
                />
                <div className="flex items-center justify-center gap-2">
                  {loadingSection === "generating-custom" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={cancelGeneration}
                      className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      <span className="spinner !h-3 !w-3" /> Cancel
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => generateCustomSection(customPrompt.trim())}
                      disabled={isLoading || !customPrompt.trim()}
                    >
                      {"✨"} Generate
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {loadingSection === "all" && (
            <div className="flex flex-col items-center justify-center gap-3 py-6">
              <div className="flex items-center gap-2 text-sm text-[hsl(var(--primary))] animate-pulse">
                <span className="spinner" />
                Generating recommendations for {cityName}…
              </div>
              <button
                type="button"
                onClick={cancelGeneration}
                className="text-xs text-[hsl(var(--muted-foreground))] hover:text-red-600 transition-colors"
              >
                ✕ Cancel
              </button>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 text-center">{error}</p>
          )}

          {/* ── Search / Filter / Select bar ── */}
          {hasContent && (
            <div className="flex flex-wrap items-center gap-2">
              {/* Search input */}
              <div className="relative flex-1 min-w-[150px] max-w-xs">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search recommendations…"
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1 pl-7 text-xs focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                />
                <svg className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">✕</button>
                )}
              </div>
              {/* Category filter chips */}
              {collectCategories().map((cat) => {
                const isActive = filterCategories.has(cat);
                const style = CATEGORY_STYLES[cat as Category];
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setFilterCategories((prev) => {
                      const next = new Set(prev);
                      if (next.has(cat)) next.delete(cat); else next.add(cat);
                      return next;
                    })}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors ${isActive ? "border-transparent text-white" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}
                    style={isActive ? { backgroundColor: style?.dot ?? "hsl(var(--primary))" } : undefined}
                  >
                    {CATEGORY_ICONS[cat as Category]} {CATEGORY_LABELS[cat as Category] ?? cat}
                  </button>
                );
              })}
              {/* Clear filters */}
              {(searchQuery || filterCategories.size > 0) && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(""); setFilterCategories(new Set()); }}
                  className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:underline"
                >
                  Clear
                </button>
              )}
              {/* Select mode toggle */}
              <button
                type="button"
                onClick={() => { setSelectMode((v) => !v); if (selectMode) setSelectedRecIds(new Set()); }}
                className={`ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium border transition-colors ${selectMode ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]" : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"}`}
              >
                {selectMode ? "Cancel" : "Select"}
              </button>
            </div>
          )}

          {hasRecommendations && (
            <CollapsibleSubsection
              title="Must-do activities"
              count={data!.recommendations.length}
              filteredCount={(searchQuery || filterCategories.size > 0) ? data!.recommendations.filter((r) => matchesFilter(r)).length : undefined}
              open={mustDoOpen}
              onToggle={() => setMustDoOpen((v) => !v)}
              onRegenerate={() => regenerateSection("mustDo")}
              onCancel={cancelGeneration}
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
                      distanceKm={distanceFromCity(rec)}
                      directionLabel={directionFromCity(rec)}
                      recId={`rec-mustdo-${i}`}
                      isFocused={focusedRecId === `rec-mustdo-${i}`}
                      dimmed={!matchesFilter(rec)}
                      selectMode={selectMode}
                      selected={selectedRecIds.has(`rec-mustdo-${i}`)}
                      onToggleSelect={() => toggleSelection(`rec-mustdo-${i}`)}
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
              filteredCount={(searchQuery || filterCategories.size > 0) ? data!.nearbyActivities.filter((r) => matchesFilter(r)).length : undefined}
              open={nearbyActivitiesOpen}
              onToggle={() => setNearbyActivitiesOpen((v) => !v)}
              onRegenerate={() => setRegenSettingsFor((v) => v === "nearbyActivities" ? null : "nearbyActivities")}
              onCancel={cancelGeneration}
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
                      onBlur={() => { if (!maxActivitiesKm) setMaxActivitiesKm(DEFAULT_NEARBY_ACTIVITIES_KM); }}
                      className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                      min={5}
                      max={200}
                    />
                    km
                  </span>
                  <div className="ml-auto flex items-center gap-1.5">
                    {loadingSection === "nearbyActivities" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={cancelGeneration}
                        className="h-7 text-xs px-2.5 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        <span className="spinner !h-3 !w-3" /> Cancel
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => { setRegenSettingsFor(null); regenerateSection("nearbyActivities"); }}
                          disabled={isLoading}
                          className="h-7 text-xs px-2.5"
                        >
                          {"🔄"} Regenerate
                        </Button>
                        <button
                          type="button"
                          onClick={() => setRegenSettingsFor(null)}
                          className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                        >
                          Close
                        </button>
                      </>
                    )}
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
                    dimmed={!matchesFilter(act)}
                    recId={`rec-nearby-${i}`}
                    selectMode={selectMode}
                    selected={selectedRecIds.has(`rec-nearby-${i}`)}
                    onToggleSelect={() => toggleSelection(`rec-nearby-${i}`)}
                  />
                ))}
              </div>
            </CollapsibleSubsection>
          )}

          {hasHikes && (
            <CollapsibleSubsection
              title="🥾 Hikes & walks"
              count={data!.hikes.length}
              filteredCount={(searchQuery || filterCategories.size > 0) ? data!.hikes.filter((r) => matchesFilter({ ...r, category: "NATURE" })).length : undefined}
              open={hikesOpen}
              onToggle={() => setHikesOpen((v) => !v)}
              onRegenerate={() => regenerateSection("hikes")}
              onCancel={cancelGeneration}
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
                        description: buildRouteDescription(hike),
                        latitude: hike.latitude ?? null,
                        longitude: hike.longitude ?? null,
                      });
                    }}
                    addingPoi={addingPoiFor === hike.title}
                    dimmed={!matchesFilter({ ...hike, category: "NATURE" })}
                    recId={`rec-hike-${i}`}
                    selectMode={selectMode}
                    selected={selectedRecIds.has(`rec-hike-${i}`)}
                    onToggleSelect={() => toggleSelection(`rec-hike-${i}`)}
                  />
                ))}
              </div>
            </CollapsibleSubsection>
          )}

          {hasCycling && (
            <CollapsibleSubsection
              title="🚴 Cycling routes"
              count={data!.cycling.length}
              filteredCount={(searchQuery || filterCategories.size > 0) ? data!.cycling.filter((r) => matchesFilter({ ...r, category: "NATURE" })).length : undefined}
              open={cyclingOpen}
              onToggle={() => setCyclingOpen((v) => !v)}
              onRegenerate={() => regenerateSection("cycling")}
              onCancel={cancelGeneration}
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
                        description: buildRouteDescription(route),
                        latitude: route.latitude ?? null,
                        longitude: route.longitude ?? null,
                      });
                    }}
                    addingPoi={addingPoiFor === route.title}
                    dimmed={!matchesFilter({ ...route, category: "NATURE" })}
                    recId={`rec-cycling-${i}`}
                    selectMode={selectMode}
                    selected={selectedRecIds.has(`rec-cycling-${i}`)}
                    onToggleSelect={() => toggleSelection(`rec-cycling-${i}`)}
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
              onCancel={cancelGeneration}
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
                      onBlur={() => { if (!maxCitiesKm) setMaxCitiesKm(DEFAULT_NEARBY_CITIES_KM); }}
                      className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                      min={10}
                      max={500}
                    />
                    km
                  </span>
                  <div className="ml-auto flex items-center gap-1.5">
                    {loadingSection === "nearbyCities" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={cancelGeneration}
                        className="h-7 text-xs px-2.5 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        <span className="spinner !h-3 !w-3" /> Cancel
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => { setRegenSettingsFor(null); regenerateSection("nearbyCities"); }}
                          disabled={isLoading}
                          className="h-7 text-xs px-2.5"
                        >
                          {"🔄"} Regenerate
                        </Button>
                        <button
                          type="button"
                          onClick={() => setRegenSettingsFor(null)}
                          className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                        >
                          Close
                        </button>
                      </>
                    )}
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

          {/* Custom sections */}
          {hasCustomSections && data!.customSections.map((section) => {
            const isOpen = customSectionOpenIds.has(section.id);
            const isRegenerating = regenCustomId === section.id;
            return (
              <CollapsibleSubsection
                key={section.id}
                title={`🔍 ${section.title}`}
                count={section.items.length}
                filteredCount={(searchQuery || filterCategories.size > 0) ? section.items.filter((r) => matchesFilter(r)).length : undefined}
                open={isOpen}
                onToggle={() => setCustomSectionOpenIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(section.id)) next.delete(section.id);
                  else next.add(section.id);
                  return next;
                })}
                onRegenerate={() => {
                  if (isRegenerating) {
                    setRegenCustomId(null);
                    setRegenCustomPrompt("");
                  } else {
                    setRegenCustomId(section.id);
                    setRegenCustomPrompt(section.prompt);
                  }
                }}
                onCancel={cancelGeneration}
                regenerating={loadingSection === section.id}
                disabled={isLoading}
                settingsOpen={isRegenerating}
                settingsPanel={
                  <div className="space-y-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-2">
                    <label className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Edit prompt and regenerate:</label>
                    <input
                      type="text"
                      value={regenCustomPrompt}
                      onChange={(e) => setRegenCustomPrompt(e.target.value)}
                      className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1.5 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]"
                      placeholder="Update your prompt..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && regenCustomPrompt.trim()) {
                          generateCustomSection(regenCustomPrompt.trim(), section.id);
                        }
                      }}
                    />
                    <div className="flex items-center gap-1.5">
                      {loadingSection === section.id ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={cancelGeneration}
                          className="h-7 text-xs px-2.5 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          <span className="spinner !h-3 !w-3" /> Cancel
                        </Button>
                      ) : (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => generateCustomSection(regenCustomPrompt.trim(), section.id)}
                            disabled={isLoading || !regenCustomPrompt.trim()}
                            className="h-7 text-xs px-2.5"
                          >
                            {"🔄"} Regenerate
                          </Button>
                          <button
                            type="button"
                            onClick={() => deleteCustomSection(section.id)}
                            disabled={isLoading}
                            className="text-[10px] text-red-500 hover:text-red-600 hover:underline disabled:opacity-50"
                          >
                            Delete section
                          </button>
                          <button
                            type="button"
                            onClick={() => { setRegenCustomId(null); setRegenCustomPrompt(""); }}
                            className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                          >
                            Close
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                }
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {section.items.map((rec, i) => {
                    const poiLink = findPoiLink(rec.linkedPlace);
                    return (
                      <RecommendationCard
                        key={i}
                        rec={rec}
                        index={i}
                        poiLink={poiLink}
                        onAddPoi={(categoryOverride?: string) => addPoiFromRecommendation(rec, categoryOverride)}
                        addingPoi={addingPoiFor === (rec.linkedPlace || rec.title)}
                        distanceKm={distanceFromCity(rec)}
                        directionLabel={directionFromCity(rec)}
                        recId={`rec-custom-${section.id}-${i}`}
                        isFocused={focusedRecId === `rec-custom-${section.id}-${i}`}
                        dimmed={!matchesFilter(rec)}
                        selectMode={selectMode}
                        selected={selectedRecIds.has(`rec-custom-${section.id}-${i}`)}
                        onToggleSelect={() => toggleSelection(`rec-custom-${section.id}-${i}`)}
                      />
                    );
                  })}
                </div>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-2 italic">
                  Prompt: &ldquo;{section.prompt}&rdquo;
                </p>
              </CollapsibleSubsection>
            );
          })}

          {/* Ask AI section — always available after initial generation */}
          {hasContent && (
            !showGenerateMore ? (
              <div className="flex items-center justify-center gap-4 pt-1">
                <button
                  type="button"
                  onClick={() => setShowGenerateMore(true)}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50"
                >
                  + Generate other
                </button>
                <button
                  type="button"
                  onClick={deleteAllRecommendations}
                  disabled={isLoading}
                  className="inline-flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))] hover:text-red-600 disabled:opacity-50 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Delete all
                </button>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-dashed border-[hsl(var(--border))] p-3 bg-[hsl(var(--muted))]/20 max-w-sm mx-auto">
                {generateMoreOptions.length > 0 && (
                  <>
                    <p className="text-xs font-medium text-[hsl(var(--foreground))]">Add sections:</p>
                    {generateMoreOptions.map((opt) => (
                      <div key={opt.key} className="flex items-center gap-2 text-sm">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={opt.state} onChange={(e) => opt.setState(e.target.checked)} className="rounded" />
                          {opt.label}
                        </label>
                        {opt.key === "nearbyCities" && opt.state && (
                          <span className="inline-flex items-center gap-1 ml-1">
                            <input
                              type="number"
                              value={maxCitiesKm}
                              onChange={(e) => setMaxCitiesKm(e.target.value === "" ? 0 : Number(e.target.value))}
                              onBlur={() => { if (!maxCitiesKm) setMaxCitiesKm(DEFAULT_NEARBY_CITIES_KM); }}
                              className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                              min={10}
                              max={500}
                            />
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">km max</span>
                          </span>
                        )}
                        {opt.key === "nearbyActivities" && opt.state && (
                          <span className="inline-flex items-center gap-1 ml-1">
                            <input
                              type="number"
                              value={maxActivitiesKm}
                              onChange={(e) => setMaxActivitiesKm(e.target.value === "" ? 0 : Number(e.target.value))}
                              onBlur={() => { if (!maxActivitiesKm) setMaxActivitiesKm(DEFAULT_NEARBY_ACTIVITIES_KM); }}
                              className="w-14 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-1.5 py-0.5 text-xs"
                              min={5}
                              max={200}
                            />
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">km max</span>
                          </span>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center justify-center gap-2 pt-1">
                      {loadingSection === "more" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={cancelGeneration}
                          className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          <span className="spinner !h-3 !w-3" /> Cancel
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          onClick={generateMore}
                          disabled={isLoading || generateMoreOptions.every((o) => !o.state)}
                        >
                          {"✨"} Generate
                        </Button>
                      )}
                    </div>
                    <div className="border-t border-[hsl(var(--border))] my-1" />
                  </>
                )}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-[hsl(var(--foreground))]">Ask for something specific:</p>
                  <div className="flex flex-wrap gap-1">
                    {[
                      "Best neighborhoods to explore",
                      "Local food & dishes to try",
                      "Best wine bars & cocktail bars",
                      "Live music & nightlife spots",
                      "Shopping streets & districts",
                      "Family-friendly activities",
                      "Free things to do",
                      "Rainy day activities",
                      "Best viewpoints & photo spots",
                    ].map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        disabled={isLoading}
                        onClick={() => setCustomPrompt(chip)}
                        className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[11px] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition disabled:opacity-50"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Or type your own question..."
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1.5 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customPrompt.trim()) {
                        generateCustomSection(customPrompt.trim());
                      }
                    }}
                  />
                  <div className="flex items-center justify-center gap-2">
                    {loadingSection === "generating-custom" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={cancelGeneration}
                        className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        <span className="spinner !h-3 !w-3" /> Cancel
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => generateCustomSection(customPrompt.trim())}
                          disabled={isLoading || !customPrompt.trim()}
                        >
                          {"✨"} Generate
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => { setShowGenerateMore(false); setCustomPrompt(""); }}
                          disabled={isLoading}
                        >
                          Close
                        </Button>
                      </>
                    )}
                  </div>
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

      {/* Floating batch-add action bar */}
      {selectMode && selectedRecIds.size > 0 && (
        <div className="sticky bottom-4 z-20 mx-4 mb-4 flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 shadow-lg">
          <span className="text-xs font-medium">
            {selectedRecIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedRecIds(new Set())}
              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={batchAddSelectedAsPois}
              disabled={batchAdding}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              {batchAdding ? <span className="spinner !h-3 !w-3" /> : "+"}
              {batchAdding ? "Adding…" : `Add ${selectedRecIds.size} as POIs`}
            </button>
          </div>
        </div>
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
  filteredCount,
  open,
  onToggle,
  onRegenerate,
  onCancel,
  regenerating,
  disabled,
  settingsOpen,
  settingsPanel,
  children,
}: {
  title: string;
  count: number;
  /** When filters are active, the number of matching items in this section */
  filteredCount?: number;
  open: boolean;
  onToggle: () => void;
  onRegenerate?: () => void;
  /** Called when the user cancels an in-progress regeneration */
  onCancel?: () => void;
  regenerating?: boolean;
  disabled?: boolean;
  settingsOpen?: boolean;
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
            {filteredCount != null && filteredCount !== count ? `${filteredCount}/${count}` : count}
          </span>
        </button>
        {onRegenerate && (
          regenerating && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-red-500 hover:text-red-600 transition-colors"
              title="Cancel regeneration"
            >
              <span className="spinner !h-3 !w-3" /> Cancel
            </button>
          ) : (
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
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg> Regenerate
            </button>
          )
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
  distanceKm,
  directionLabel,
  recId,
  isFocused,
  dimmed,
  selectMode,
  selected,
  onToggleSelect,
}: {
  rec: ActivityRecommendation;
  index: number;
  poiLink: { id: number; name: string; photoUrl?: string | null; isUnescoSite?: boolean | null } | null;
  onAddPoi: (categoryOverride?: string) => void;
  addingPoi: boolean;
  distanceKm?: number;
  directionLabel?: string;
  recId?: string;
  isFocused?: boolean;
  /** When true, the card is visually dimmed (doesn't match filter) */
  dimmed?: boolean;
  /** Whether select mode is active */
  selectMode?: boolean;
  /** Whether this card is selected */
  selected?: boolean;
  /** Toggle selection */
  onToggleSelect?: () => void;
}) {
  const category = (rec.category ?? "CULTURE") as Category;
  const catStyle = CATEGORY_STYLES[category];
  const catIcon = CATEGORY_ICONS[category] ?? "";
  const [addOpen, setAddOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>(category);
  const [imgError, setImgError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const photoSrc = poiLink?.photoUrl ? `/api/pois/${poiLink.id}/photo` : null;
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const hasCoords = rec.latitude != null && rec.longitude != null;
  const staticMapUrl = hasCoords && mapboxToken
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+${(catStyle?.dot ?? "#666").replace("#", "")}(${rec.longitude},${rec.latitude})/${rec.longitude},${rec.latitude},13,0/220x120@2x?access_token=${mapboxToken}`
    : null;

  return (
    <div
      data-rec-id={recId}
      onMouseEnter={() => recId && window.dispatchEvent(new CustomEvent("highlight-recommendation", { detail: { id: recId, action: "hover" } }))}
      onMouseLeave={() => recId && window.dispatchEvent(new CustomEvent("highlight-recommendation", { detail: { id: recId, action: "unhover" } }))}
      className={`rounded-lg border bg-[hsl(var(--card))] overflow-hidden transition-all shadow-sm ${dimmed ? "opacity-40 grayscale" : "hover:bg-[hsl(var(--muted))]/50"} ${isFocused ? "border-[hsl(var(--primary))] ring-2 ring-[hsl(var(--primary))]/30" : selected ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5" : "border-[hsl(var(--border))]"}`}
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
        {selectMode ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-0.5 h-4 w-4 rounded border-[hsl(var(--border))] text-[hsl(var(--primary))] shrink-0"
          />
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))]/10 text-[10px] font-bold text-[hsl(var(--primary))]">
            {index + 1}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => selectMode ? onToggleSelect?.() : setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-left w-full group"
          >
            <span className="text-xs shrink-0">{catIcon}</span>
            <h4 className="text-sm font-semibold leading-tight group-hover:text-[hsl(var(--primary))] transition-colors truncate">{rec.title}</h4>
            {poiLink?.isUnescoSite && (
              <span className="shrink-0 rounded-full bg-indigo-700 px-1.5 py-0.5 text-[9px] font-bold text-white">UNESCO</span>
            )}
            {!selectMode && (
              <svg xmlns="http://www.w3.org/2000/svg" className={`ml-auto h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform ${expanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            )}
          </button>
          <p className={`text-xs text-[hsl(var(--muted-foreground))] leading-relaxed mt-1 ${expanded ? "" : "line-clamp-2"}`}>
            {rec.description}
          </p>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="pl-7 space-y-2 pt-1">
          {staticMapUrl && (
            <div className="rounded-md overflow-hidden border border-[hsl(var(--border))]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={staticMapUrl} alt={`Map: ${rec.title}`} className="w-full h-auto" loading="lazy" />
            </div>
          )}
        </div>
      )}

      <div className="pl-7 flex flex-wrap items-center gap-x-3 gap-y-1">
        {hasCoords && recId && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("highlight-recommendation", { detail: { id: recId, action: "click" } }))}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
          >
            🗺 Show on map
          </button>
        )}
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
        {!poiLink && rec.linkedPlace && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
            {"📍"} {rec.linkedPlace}
          </span>
        )}
        {distanceKm != null && distanceKm >= 1 && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
            📏 {formatDistance(Math.round(distanceKm))}{directionLabel ? ` ${directionLabel}` : ""}
          </span>
        )}
        {!selectMode && (
          <>
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
                  onClick={() => {
                    if (recId) window.dispatchEvent(new CustomEvent("highlight-recommendation", { detail: { id: recId, action: "click" } }));
                    onAddPoi(selectedCategory); setAddOpen(false);
                  }}
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
          </>
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
  dimmed,
  recId,
  selectMode,
  selected,
  onToggleSelect,
}: {
  activity: NearbyActivityRecommendation;
  onAddPoi: (categoryOverride?: string) => void;
  addingPoi: boolean;
  dimmed?: boolean;
  recId?: string;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const category = (activity.category ?? "NATURE") as Category;
  const catStyle = CATEGORY_STYLES[category];
  const catIcon = CATEGORY_ICONS[category] ?? "🏞️";
  const [addOpen, setAddOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>(category);
  const [expanded, setExpanded] = useState(false);
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const hasCoords = activity.latitude != null && activity.longitude != null;
  const staticMapUrl = hasCoords && mapboxToken
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+${(catStyle?.dot ?? "#666").replace("#", "")}(${activity.longitude},${activity.latitude})/${activity.longitude},${activity.latitude},12,0/220x120@2x?access_token=${mapboxToken}`
    : null;

  return (
    <div
      data-rec-id={recId}
      onMouseEnter={() => recId && window.dispatchEvent(new CustomEvent("highlight-recommendation", { detail: { id: recId, action: "hover" } }))}
      onMouseLeave={() => recId && window.dispatchEvent(new CustomEvent("highlight-recommendation", { detail: { id: recId, action: "unhover" } }))}
      className={`rounded-lg border bg-[hsl(var(--card))] overflow-hidden p-3 space-y-1.5 transition-all shadow-sm ${dimmed ? "opacity-40 grayscale" : "hover:bg-[hsl(var(--muted))]/50"} ${selected ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5" : "border-[hsl(var(--border))]"}`}
      style={{ borderLeftWidth: 3, borderLeftColor: catStyle?.dot ?? "hsl(var(--border))" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectMode && (
            <input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-4 w-4 rounded border-[hsl(var(--border))] text-[hsl(var(--primary))] shrink-0" />
          )}
          <button type="button" onClick={() => selectMode ? onToggleSelect?.() : setExpanded((v) => !v)} className="flex items-center gap-1.5 text-left group min-w-0 flex-1">
            <span className="text-xs shrink-0">{catIcon}</span>
            <h4 className="text-sm font-semibold leading-tight group-hover:text-[hsl(var(--primary))] transition-colors truncate">{activity.title}</h4>
            {!selectMode && (
              <svg xmlns="http://www.w3.org/2000/svg" className={`ml-auto h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform ${expanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            )}
          </button>
        </div>
        {activity.distance && (
          <span className="shrink-0 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
            {formatDistanceString(activity.distance)}
          </span>
        )}
      </div>
      <p className={`text-xs text-[hsl(var(--muted-foreground))] leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
        {activity.description}
      </p>
      {expanded && (
        <div className="space-y-2">
          {staticMapUrl && (
            <div className="rounded-md overflow-hidden border border-[hsl(var(--border))]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={staticMapUrl} alt={`Map: ${activity.title}`} className="w-full h-auto" loading="lazy" />
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {hasCoords && recId && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("highlight-recommendation", { detail: { id: recId, action: "click" } }))}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
          >
            🗺 Show on map
          </button>
        )}
        {activity.location && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
            {"📍"} {activity.location}
          </span>
        )}
        {!selectMode && (
          <>
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
                  onClick={() => {
                    if (recId) window.dispatchEvent(new CustomEvent("highlight-recommendation", { detail: { id: recId, action: "click" } }));
                    onAddPoi(selectedCategory); setAddOpen(false);
                  }}
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
          </>
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
    <div className="rounded-lg border border-[hsl(var(--border))] bg-gradient-to-br from-[hsl(var(--card))] to-[hsl(var(--muted))]/30 overflow-hidden p-4 space-y-1.5 transition-all hover:shadow-sm shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold flex items-center gap-1.5 min-w-0">
          <span className="text-xs shrink-0">{"🏘️"}</span>
          <span className="truncate">{city.name}</span>
        </h4>
        {city.distance && (
          <span className="shrink-0 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
            {formatDistanceString(city.distance)}
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
  dimmed,
  recId,
  selectMode,
  selected,
  onToggleSelect,
}: {
  route: HikeRecommendation | CyclingRecommendation;
  icon: string;
  onAddPoi: (categoryOverride?: string) => void;
  addingPoi: boolean;
  dimmed?: boolean;
  recId?: string;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("NATURE");
  const [expanded, setExpanded] = useState(false);
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const hasCoords = route.latitude != null && route.longitude != null;
  const staticMapUrl = hasCoords && mapboxToken
    ? `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/pin-s+16a34a(${route.longitude},${route.latitude})/${route.longitude},${route.latitude},12,0/220x120@2x?access_token=${mapboxToken}`
    : null;

  const difficultyColor = route.difficulty === "challenging"
    ? "text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400"
    : route.difficulty === "moderate"
      ? "text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-400"
      : "text-green-600 bg-green-50 dark:bg-green-950 dark:text-green-400";

  return (
    <div
      data-rec-id={recId}
      onMouseEnter={() => recId && window.dispatchEvent(new CustomEvent("highlight-recommendation", { detail: { id: recId, action: "hover" } }))}
      onMouseLeave={() => recId && window.dispatchEvent(new CustomEvent("highlight-recommendation", { detail: { id: recId, action: "unhover" } }))}
      className={`rounded-lg border bg-[hsl(var(--card))] overflow-hidden p-3 space-y-1.5 transition-all shadow-sm ${dimmed ? "opacity-40 grayscale" : "hover:bg-[hsl(var(--muted))]/50"} ${selected ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5" : "border-[hsl(var(--border))]"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectMode && (
            <input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-4 w-4 rounded border-[hsl(var(--border))] text-[hsl(var(--primary))] shrink-0" />
          )}
          <button type="button" onClick={() => selectMode ? onToggleSelect?.() : setExpanded((v) => !v)} className="flex items-center gap-1.5 text-left group min-w-0 flex-1">
            <span className="text-xs shrink-0">{icon}</span>
            <h4 className="text-sm font-semibold leading-tight group-hover:text-[hsl(var(--primary))] transition-colors truncate">{route.title}</h4>
            {!selectMode && (
              <svg xmlns="http://www.w3.org/2000/svg" className={`ml-auto h-3 w-3 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform ${expanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            )}
          </button>
        </div>
        {route.difficulty && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${difficultyColor}`}>
            {route.difficulty}
          </span>
        )}
      </div>
      <p className={`text-xs text-[hsl(var(--muted-foreground))] leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
        {route.description}
      </p>
      {expanded && (
        <div className="space-y-2">
          {staticMapUrl && (
            <div className="rounded-md overflow-hidden border border-[hsl(var(--border))]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={staticMapUrl} alt={`Map: ${route.title}`} className="w-full h-auto" loading="lazy" />
            </div>
          )}
        </div>
      )}
      {/* Route meta */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {hasCoords && recId && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("highlight-recommendation", { detail: { id: recId, action: "click" } }))}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
          >
            🗺 Show on map
          </button>
        )}
        {route.distance && (
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] flex items-center gap-0.5">
            📏 {formatDistanceString(route.distance)}
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
        {!selectMode && (
          <>
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
                  onClick={() => {
                    if (recId) window.dispatchEvent(new CustomEvent("highlight-recommendation", { detail: { id: recId, action: "click" } }));
                    onAddPoi(selectedCategory); setAddOpen(false);
                  }}
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
          </>
        )}
      </div>
    </div>
  );
}
