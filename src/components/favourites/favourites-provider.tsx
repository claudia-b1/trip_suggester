"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { Category } from "@/lib/categories";

/* ── Shared types ──────────────────────────────────────────────────────── */

export type FavouriteItemDTO = {
  id: number;
  name: string;
  category: string;
  subcategory: string | null;
  country: string;
  city: string;
  address: string | null;
  latitude: number;
  longitude: number;
  description: string | null;
  notes: string | null;
  photoUrl: string | null;
  website: string | null;
  sourcePlaceId: string | null;
  visited: boolean;
  personalRating: number | null;
  extraFields: Record<string, unknown> | null;
  order: number;
  listId: number;
  list?: { id: number; name: string };
  createdAt: string;
};

export type FavouriteListDTO = {
  id: number;
  name: string;
  order: number;
  parentId: number | null;
  items: FavouriteItemDTO[];
  sublists: (FavouriteListDTO & { _count: { items: number } })[];
  _count: { items: number };
  createdAt: string;
};

export type NewFavouriteItemPrefill = {
  name?: string;
  category?: Category;
  subcategory?: string;
  country?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  description?: string;
  photoUrl?: string;
  website?: string;
  sourcePlaceId?: string;
  extraFields?: Record<string, unknown>;
  /** Pre-select this list in the modal */
  listId?: number;
};

/* ── Day plan option type (shared with pois-section) ──────────────────── */

export type DayPlanOption = {
  id: number;
  label: string;
};

export type CurrentCityContext = {
  id: number;
  name: string;
  country?: string;
  dayPlans: DayPlanOption[];
};

/* ── Context ───────────────────────────────────────────────────────────── */

type FavouritesContextType = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  lists: FavouriteListDTO[];
  loading: boolean;
  refreshLists: () => Promise<void>;
  /** Set of sourcePlaceId values that are favourited (for filled heart) */
  favouritedPlaceIds: Set<string>;
  /** Set of favourite item IDs (for matching POIs linked via favouriteItemId) */
  favouritedItemIds: Set<number>;
  /** Set of lowercased favourite names (for name-only matching) */
  favouritedNames: Set<string>;
  /** Open the add-to-favourites modal with pre-filled data */
  showAddModal: (prefill: NewFavouriteItemPrefill) => void;
  addModalPrefill: NewFavouriteItemPrefill | null;
  closeAddModal: () => void;
  /** Open the edit modal for an existing favourite item */
  showEditModal: (item: FavouriteItemDTO) => void;
  editModalItem: FavouriteItemDTO | null;
  closeEditModal: () => void;
  /** Current city context (set by city page, null elsewhere) */
  currentCity: CurrentCityContext | null;
  setCurrentCity: (city: CurrentCityContext | null) => void;
};

const FavouritesContext = createContext<FavouritesContextType | null>(null);

export function useFavourites() {
  const ctx = useContext(FavouritesContext);
  if (!ctx) throw new Error("useFavourites must be used within FavouritesProvider");
  return ctx;
}

/* ── Provider ──────────────────────────────────────────────────────────── */

export function FavouritesProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [lists, setLists] = useState<FavouriteListDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [addModalPrefill, setAddModalPrefill] = useState<NewFavouriteItemPrefill | null>(null);
  const [editModalItem, setEditModalItem] = useState<FavouriteItemDTO | null>(null);
  const [currentCity, setCurrentCity] = useState<CurrentCityContext | null>(null);

  const fetchLists = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/favourites/lists", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setLists(data);
      }
    } finally {
      setLoading(false);
      setHasFetched(true);
    }
  }, []);

  // Eagerly fetch favourites on mount so hearts show correct state immediately.
  // Also re-fetch when the active-user-id cookie changes (user switch).
  useEffect(() => {
    setHasFetched(false);
    fetchLists();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when cookie changes (detected via a custom event dispatched by switchUser)
  useEffect(() => {
    function onUserSwitch() {
      setHasFetched(false);
      fetchLists();
    }
    window.addEventListener("user-switched", onUserSwitch);
    return () => window.removeEventListener("user-switched", onUserSwitch);
  }, [fetchLists]);

  const open = useCallback(() => {
    setIsOpen(true);
    if (!hasFetched) fetchLists();
  }, [hasFetched, fetchLists]);

  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (next && !hasFetched) fetchLists();
      return next;
    });
  }, [hasFetched, fetchLists]);

  const refreshLists = useCallback(async () => {
    await fetchLists();
  }, [fetchLists]);

  const showAddModal = useCallback((prefill: NewFavouriteItemPrefill) => {
    setAddModalPrefill(prefill);
    if (!hasFetched) fetchLists();
  }, [hasFetched, fetchLists]);

  const closeAddModal = useCallback(() => setAddModalPrefill(null), []);

  const showEditModal = useCallback((item: FavouriteItemDTO) => {
    setEditModalItem(item);
    if (!hasFetched) fetchLists();
  }, [hasFetched, fetchLists]);

  const closeEditModal = useCallback(() => setEditModalItem(null), []);

  // Build set of favourited placeIds, name|city keys, names, and item IDs from all items across all lists
  const favouritedPlaceIds = new Set<string>();
  const favouritedItemIds = new Set<number>();
  const favouritedNames = new Set<string>();
  for (const list of lists) {
    for (const item of list.items) {
      favouritedItemIds.add(item.id);
      if (item.name) favouritedNames.add(item.name.toLowerCase());
      if (item.sourcePlaceId) favouritedPlaceIds.add(item.sourcePlaceId);
    }
    for (const sub of list.sublists) {
      for (const item of sub.items) {
        favouritedItemIds.add(item.id);
        if (item.name) favouritedNames.add(item.name.toLowerCase());
        if (item.sourcePlaceId) favouritedPlaceIds.add(item.sourcePlaceId);
      }
    }
  }

  // Close panel on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) close();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, close]);

  return (
    <FavouritesContext.Provider
      value={{
        isOpen,
        open,
        close,
        toggle,
        lists,
        loading,
        refreshLists,
        favouritedPlaceIds,
        favouritedItemIds,
        favouritedNames,
        showAddModal,
        addModalPrefill,
        closeAddModal,
        showEditModal,
        editModalItem,
        closeEditModal,
        currentCity,
        setCurrentCity,
      }}
    >
      {children}
    </FavouritesContext.Provider>
  );
}
