"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CATEGORIES,
  CATEGORY_STYLES,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  isCategory,
  type Category,
} from "@/lib/categories";
import { useFavourites, type FavouriteListDTO } from "./favourites-provider";
import { FavouriteItemCard } from "./favourite-item-card";
import { CreateListForm } from "./create-list-form";
import { useToast } from "@/components/ui/toast";
import { useUndoableDelete } from "@/hooks/use-undoable-delete";
import {
  getExtraFieldDefs,
  matchesExtraFieldFilters,
  ACCOMMODATION_SUBCATEGORIES,
  PROXIMITY_OPTIONS,
  type ExtraFieldFilter,
  type ExtraFieldDef,
} from "@/lib/favourite-fields";
import dynamic from "next/dynamic";

const FavouritesMap = dynamic(
  () => import("./favourites-map").then((m) => m.FavouritesMap),
  { ssr: false, loading: () => <p className="p-4 text-sm text-[hsl(var(--muted-foreground))] animate-pulse">Loading map...</p> },
);

export function FavouritesPanel() {
  const { isOpen, close, lists, loading, refreshLists, showAddModal } = useFavourites();
  const { toast } = useToast();
  const undoableDelete = useUndoableDelete();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | null>(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<number | null>(null);
  const [visitedFilter, setVisitedFilter] = useState<"all" | "visited" | "unvisited">("all");
  const [extraFieldFilters, setExtraFieldFilters] = useState<ExtraFieldFilter[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [expandedLists, setExpandedLists] = useState<Set<number>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [renamingList, setRenamingList] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Batch select state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Lists hidden by pending undoable deletes (optimistic removal)
  const [hiddenListIds, setHiddenListIds] = useState<Set<number>>(new Set());

  // Drag-and-drop state
  const [dragType, setDragType] = useState<"list" | "item" | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);

  function handleListDragStart(e: React.DragEvent, listId: number) {
    setDragType("list");
    setDragId(listId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-fav-list-id", String(listId));
  }

  function handleItemDragStart(e: React.DragEvent, itemId: number) {
    setDragType("item");
    setDragId(itemId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-fav-item-id", String(itemId));
  }

  function handleDragOver(e: React.DragEvent, targetId: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetId(targetId);
  }

  function handleDragLeave() {
    setDropTargetId(null);
  }

  function handleDragEnd() {
    setDragType(null);
    setDragId(null);
    setDropTargetId(null);
  }

  async function handleListDrop(e: React.DragEvent, targetIndex: number, parentId: number | null) {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    const listId = Number(e.dataTransfer.getData("application/x-fav-list-id"));
    if (!listId) return;

    // Get siblings at this level
    const siblings = parentId === null
      ? lists
      : lists.find((l) => l.id === parentId)?.sublists ?? [];
    const currentIndex = siblings.findIndex((l) => l.id === listId);
    if (currentIndex === -1 || currentIndex === targetIndex) return;

    const newOrder = siblings.map((l) => l.id).filter((id) => id !== listId);
    newOrder.splice(targetIndex, 0, listId);

    await fetch("/api/favourites/lists/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: newOrder }),
    });
    await refreshLists();
  }

  async function handleItemDrop(e: React.DragEvent, targetIndex: number, listId: number) {
    e.preventDefault();
    e.stopPropagation();
    setDropTargetId(null);
    const itemId = Number(e.dataTransfer.getData("application/x-fav-item-id"));
    if (!itemId) return;

    // Find items in this list
    const allListItems = (() => {
      for (const l of lists) {
        if (l.id === listId) return l.items;
        for (const sub of l.sublists) {
          if (sub.id === listId) return sub.items;
        }
      }
      return [];
    })();

    const newOrder = allListItems.map((i) => i.id).filter((id) => id !== itemId);
    newOrder.splice(targetIndex, 0, itemId);

    await fetch("/api/favourites/items/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: newOrder }),
    });
    await refreshLists();
  }

  function toggleExpanded(id: number) {
    setExpandedLists((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Visible lists (excluding pending deletes)
  const visibleLists = useMemo(
    () => hiddenListIds.size === 0 ? lists : lists.filter((l) => !hiddenListIds.has(l.id)),
    [lists, hiddenListIds],
  );

  // Flatten all items for filtering
  const allItems = useMemo(() => {
    const items: Array<{ item: typeof lists[0]["items"][0]; listName: string }> = [];
    for (const list of visibleLists) {
      for (const item of list.items) {
        items.push({ item, listName: list.name });
      }
      for (const sub of list.sublists) {
        for (const item of sub.items) {
          items.push({ item, listName: `${list.name} / ${sub.name}` });
        }
      }
    }
    return items;
  }, [visibleLists]);

  const isFiltering = search.trim() !== "" || categoryFilter !== null || subcategoryFilter !== null || listFilter !== null || visitedFilter !== "all" || extraFieldFilters.length > 0;

  // Derive available extra field defs — when a category is selected use its fields,
  // otherwise aggregate all field defs from categories+subcategories present in items
  const activeExtraFieldDefs = useMemo(() => {
    if (categoryFilter) {
      return getExtraFieldDefs(categoryFilter, subcategoryFilter);
    }
    // Collect unique extra field defs across all items
    const seen = new Set<string>();
    const allDefs: ExtraFieldDef[] = [];
    for (const { item } of allItems) {
      const defs = getExtraFieldDefs(item.category, item.subcategory);
      for (const def of defs) {
        if (!seen.has(def.key)) {
          seen.add(def.key);
          allDefs.push(def);
        }
      }
    }
    return allDefs;
  }, [categoryFilter, subcategoryFilter, allItems]);

  // Split field defs into groups for organized filter rendering
  const dropdownDefs = useMemo(
    () => activeExtraFieldDefs.filter((d) => d.type === "select" || d.type === "proximity" || d.type === "stars"),
    [activeExtraFieldDefs],
  );
  const booleanDefs = useMemo(
    () => activeExtraFieldDefs.filter((d) => d.type === "boolean"),
    [activeExtraFieldDefs],
  );

  const filteredItems = useMemo(() => {
    if (!isFiltering) return [];
    return allItems.filter(({ item }) => {
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (subcategoryFilter && item.subcategory !== subcategoryFilter) return false;
      if (listFilter && item.listId !== listFilter) return false;
      if (visitedFilter === "visited" && !item.visited) return false;
      if (visitedFilter === "unvisited" && item.visited) return false;
      if (extraFieldFilters.length > 0) {
        if (!matchesExtraFieldFilters(item.extraFields as Record<string, unknown> | null, extraFieldFilters)) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const basicMatch =
          item.name.toLowerCase().includes(q) ||
          item.city.toLowerCase().includes(q) ||
          item.country.toLowerCase().includes(q) ||
          (item.subcategory && item.subcategory.toLowerCase().includes(q));
        if (basicMatch) return true;
        // Search through extra field labels and values
        if (item.extraFields && typeof item.extraFields === "object") {
          const ef = item.extraFields as Record<string, unknown>;
          const defs = getExtraFieldDefs(item.category, item.subcategory);
          for (const def of defs) {
            const val = ef[def.key];
            if (val === null || val === undefined || val === false || val === "-" || val === "") continue;
            if (def.label.toLowerCase().includes(q)) return true;
            if (typeof val === "string" && val.toLowerCase().includes(q)) return true;
            if (def.type === "select" && "options" in def) {
              const opt = def.options.find((o) => o.value === val);
              if (opt && opt.label.toLowerCase().includes(q)) return true;
            }
          }
        }
        return false;
      }
      return true;
    });
  }, [allItems, search, categoryFilter, subcategoryFilter, listFilter, visitedFilter, extraFieldFilters, isFiltering]);

  // Excel export
  async function handleExcelExport() {
    const { utils, writeFile } = await import("xlsx");
    const { getExtraFieldDefs, PROXIMITY_OPTIONS } = await import("@/lib/favourite-fields");
    const rows: Record<string, unknown>[] = [];
    for (const { item, listName } of allItems) {
      const row: Record<string, unknown> = {
        List: listName,
        Name: item.name,
        Category: CATEGORY_LABELS[item.category as Category] ?? item.category,
        Subcategory: item.subcategory ?? "",
        Country: item.country,
        City: item.city,
        Latitude: item.latitude,
        Longitude: item.longitude,
        Description: item.description ?? "",
        Notes: item.notes ?? "",
        Website: item.website ?? "",
        Visited: item.visited ? "Yes" : "No",
        Rating: item.personalRating ?? "",
      };
      // Add extra fields with human-readable column names and values
      if (item.extraFields && typeof item.extraFields === "object") {
        const fieldDefs = getExtraFieldDefs(item.category, item.subcategory);
        for (const [key, val] of Object.entries(item.extraFields as Record<string, unknown>)) {
          if (val === null || val === undefined || val === "" || val === false || val === "-") continue;
          const def = fieldDefs.find((d) => d.key === key);
          const colName = def?.label ?? key;
          let displayValue: unknown = val;
          if (val === true) {
            displayValue = "Yes";
          } else if (def?.type === "proximity") {
            const opt = PROXIMITY_OPTIONS.find((o) => o.value === val);
            displayValue = opt?.label ?? val;
          } else if (def?.type === "stars") {
            displayValue = val;
          } else if (def?.type === "select" && "options" in def) {
            const opt = def.options.find((o) => o.value === val);
            displayValue = opt?.label ?? val;
          }
          row[colName] = displayValue;
        }
      }
      rows.push(row);
    }
    const ws = utils.json_to_sheet(rows);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Favourites");
    writeFile(wb, "favourites.xlsx");
    toast("Exported to favourites.xlsx");
  }

  function toggleBooleanFilter(key: string) {
    setExtraFieldFilters((prev) => {
      const exists = prev.find((f) => f.key === key);
      if (exists) return prev.filter((f) => f.key !== key);
      return [...prev, { key, value: true }];
    });
  }

  function setExtraFieldDropdown(key: string, value: string, type: string) {
    setExtraFieldFilters((prev) => {
      const without = prev.filter((f) => f.key !== key);
      if (!value) return without;
      if (type === "stars") return [...without, { key, value: Number(value), type: "stars" }];
      if (type === "proximity") return [...without, { key, value, type: "proximity" }];
      return [...without, { key, value, type: "select" }];
    });
  }

  function getFilterDropdownValue(key: string): string {
    const f = extraFieldFilters.find((ef) => ef.key === key);
    if (!f) return "";
    return String(f.value);
  }

  function handleDeleteList(id: number, name: string) {
    // Optimistic removal — hide from UI immediately
    setHiddenListIds((prev) => new Set(prev).add(id));

    undoableDelete({
      label: name,
      onDelete: async () => {
        await fetch(`/api/favourites/lists/${id}`, { method: "DELETE" });
        setHiddenListIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
        await refreshLists();
      },
      onRestore: () => {
        setHiddenListIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      },
    });
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBatchDelete() {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const count = ids.length;
    setSelectedIds(new Set());
    setSelectMode(false);
    undoableDelete({
      label: `${count} item${count > 1 ? "s" : ""}`,
      onDelete: async () => {
        await fetch("/api/favourites/items/batch", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        await refreshLists();
      },
      onRestore: () => {
        refreshLists();
      },
    });
    refreshLists();
  }

  async function handleBatchMove(targetListId: number) {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setSelectedIds(new Set());
    setSelectMode(false);
    await fetch("/api/favourites/items/batch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, data: { listId: targetListId } }),
    });
    toast(`Moved ${ids.length} item${ids.length > 1 ? "s" : ""}`);
    await refreshLists();
  }

  async function handleRename(id: number) {
    if (!renameValue.trim()) return;
    const res = await fetch(`/api/favourites/lists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    if (res.ok) {
      setRenamingList(null);
      setRenameValue("");
      await refreshLists();
    }
  }

  function handleAddItemToList(listId: number) {
    showAddModal({ listId });
    close(); // close panel so modal is visible
  }

  function renderList(list: FavouriteListDTO, indent = false, listIndex = 0) {
    const isExpanded = expandedLists.has(list.id);
    const totalItems =
      list.items.length +
      list.sublists.reduce((sum, s) => sum + s.items.length, 0);
    const isDragTarget = dropTargetId === list.id && dragType === "list";

    return (
      <div
        key={list.id}
        className={`${indent ? "ml-4" : ""} ${isDragTarget ? "ring-2 ring-dashed ring-[hsl(var(--primary))]/40 rounded" : ""}`}
        draggable={!selectMode}
        onDragStart={(e) => handleListDragStart(e, list.id)}
        onDragOver={(e) => handleDragOver(e, list.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleListDrop(e, listIndex, list.parentId)}
        onDragEnd={handleDragEnd}
      >
        <div className="flex items-center gap-1 py-1.5">
          {/* Drag handle */}
          {!selectMode && (
            <span className="cursor-grab text-[10px] text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 hover:opacity-100 active:cursor-grabbing select-none" title="Drag to reorder">
              ⋮⋮
            </span>
          )}
          <button
            onClick={() => toggleExpanded(list.id)}
            className="flex flex-1 items-center gap-2 text-left"
          >
            <span
              className="text-xs text-[hsl(var(--muted-foreground))] transition-transform"
              style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ▶
            </span>
            {renamingList === list.id ? (
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => handleRename(list.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(list.id);
                  if (e.key === "Escape") { setRenamingList(null); setRenameValue(""); }
                }}
                className="flex-1 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-0.5 text-sm text-[hsl(var(--foreground))] focus:outline-none"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                {indent ? "📁" : "📂"} {list.name}
              </span>
            )}
            <span className="ml-auto text-[10px] text-[hsl(var(--muted-foreground))]">
              {totalItems}
            </span>
          </button>

          {/* List actions */}
          <div className="flex items-center gap-0.5">
            {/* Add favourite item — prominent button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleAddItemToList(list.id);
              }}
              className="rounded-md border border-pink-300/40 bg-pink-500/10 px-1.5 py-0.5 text-[10px] font-medium text-pink-400 hover:bg-pink-500/20 hover:text-pink-300 transition-colors"
              title="Add favourite item to this list"
            >
              + Add
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setRenamingList(list.id);
                setRenameValue(list.name);
              }}
              className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              title="Rename"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteList(list.id, list.name);
              }}
              className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:text-red-500"
              title="Delete list"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14H6L5 6"/>
                <path d="M5 6l1-3h12l1 3"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="space-y-1 pb-2">
            {/* Sublists */}
            {list.sublists.map((sub, idx) => renderList(sub as unknown as FavouriteListDTO, true, idx))}
            {/* Items */}
            {list.items.length === 0 && list.sublists.length === 0 && (
              <p className="ml-6 text-xs text-[hsl(var(--muted-foreground))] italic">
                No items yet
              </p>
            )}
            {list.items.map((item, idx) => (
              <div
                key={item.id}
                className={`ml-4 ${dropTargetId === item.id && dragType === "item" ? "ring-2 ring-dashed ring-[hsl(var(--primary))]/40 rounded" : ""}`}
                draggable={!selectMode}
                onDragStart={(e) => { e.stopPropagation(); handleItemDragStart(e, item.id); }}
                onDragOver={(e) => { e.stopPropagation(); handleDragOver(e, item.id); }}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleItemDrop(e, idx, list.id)}
                onDragEnd={handleDragEnd}
              >
                <FavouriteItemCard
                  item={item}
                  selectMode={selectMode}
                  isSelected={selectedIds.has(item.id)}
                  onToggleSelect={toggleSelect}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/30"
            onClick={close}
          />

          {/* Panel */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
              <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
                ❤️ Favourites
              </h2>
              <div className="flex items-center gap-1.5">
                {allItems.length > 0 && (
                  <>
                    <button
                      onClick={() => setViewMode((v) => (v === "list" ? "map" : "list"))}
                      className="rounded-md px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                      title={viewMode === "list" ? "Show map" : "Show list"}
                    >
                      {viewMode === "list" ? "🗺️ Map" : "📋 List"}
                    </button>
                    <button
                      onClick={handleExcelExport}
                      className="rounded-md px-2 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                      title="Export to Excel"
                    >
                      Export
                    </button>
                    {viewMode === "list" && (
                      <button
                        onClick={() => {
                          setSelectMode((v) => !v);
                          if (selectMode) setSelectedIds(new Set());
                        }}
                        className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          selectMode
                            ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                            : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                        }`}
                      >
                        {selectMode ? "Cancel" : "Select"}
                      </button>
                    )}
                  </>
                )}
                <button
                  onClick={close}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Search + filters — hidden in map mode (map has its own) */}
            <div className={`space-y-2 border-b border-[hsl(var(--border))] px-4 py-3 ${viewMode === "map" ? "hidden" : ""}`}>
              <div className="flex gap-2">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search favourites..."
                  className="flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                />
                <button
                  type="button"
                  onClick={() => setShowFilters(!showFilters)}
                  className={`relative flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all ${
                    showFilters
                      ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                      : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                  }`}
                  title={showFilters ? "Hide filters" : "Show filters"}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                  </svg>
                  {/* Active filter count badge */}
                  {!showFilters && (categoryFilter !== null || subcategoryFilter !== null || listFilter !== null || visitedFilter !== "all" || extraFieldFilters.length > 0) && (
                    <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-[9px] font-bold text-[hsl(var(--primary-foreground))]">
                      {(categoryFilter ? 1 : 0) + (subcategoryFilter ? 1 : 0) + (listFilter ? 1 : 0) + (visitedFilter !== "all" ? 1 : 0) + extraFieldFilters.length}
                    </span>
                  )}
                </button>
              </div>

              {showFilters && (
                <>
                  {/* Category pills */}
                  <div className="flex flex-wrap gap-1">
                    {CATEGORIES.map((cat) => {
                      const active = categoryFilter === cat;
                      const styles = CATEGORY_STYLES[cat];
                      return (
                        <button
                          key={cat}
                          onClick={() => {
                            setCategoryFilter(active ? null : cat);
                            setSubcategoryFilter(null);
                            setExtraFieldFilters([]);
                          }}
                          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all ${
                            active
                              ? `${styles.badge} border-transparent`
                              : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-60 hover:opacity-100"
                          }`}
                        >
                          {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
                        </button>
                      );
                    })}
                  </div>

                  {/* Subcategory filter — only when ACCOMMODATION is selected */}
                  {categoryFilter === "ACCOMMODATION" && (
                    <div className="flex flex-wrap gap-1">
                      <button
                        onClick={() => { setSubcategoryFilter(null); setExtraFieldFilters([]); }}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all ${
                          !subcategoryFilter
                            ? "border-indigo-400 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                            : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-60 hover:opacity-100"
                        }`}
                      >
                        All
                      </button>
                      {ACCOMMODATION_SUBCATEGORIES.map((sub) => (
                        <button
                          key={sub.id}
                          onClick={() => {
                            setSubcategoryFilter(subcategoryFilter === sub.id ? null : sub.id);
                            setExtraFieldFilters([]);
                          }}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all ${
                            subcategoryFilter === sub.id
                              ? "border-indigo-400 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                              : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-60 hover:opacity-100"
                          }`}
                        >
                          {sub.emoji} {sub.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* List + Visited — compact row */}
                  <div className="flex items-center gap-2">
                    {visibleLists.length > 1 && (
                      <select
                        value={listFilter ?? ""}
                        onChange={(e) => setListFilter(e.target.value ? Number(e.target.value) : null)}
                        className="max-w-[180px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs text-[hsl(var(--foreground))]"
                      >
                        <option value="">All lists</option>
                        {visibleLists.map((l) => (
                          <optgroup key={l.id} label={l.name}>
                            <option value={l.id}>{l.name}</option>
                            {l.sublists.map((sub) => (
                              <option key={sub.id} value={sub.id}>&nbsp;&nbsp;{sub.name}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    )}
                    <div className="flex gap-1 ml-auto">
                      {(["all", "visited", "unvisited"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setVisitedFilter(v)}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all ${
                            visitedFilter === v
                              ? "border-emerald-400 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-60 hover:opacity-100"
                          }`}
                        >
                          {v === "all" ? "All" : v === "visited" ? "✓ Visited" : "○ Unvisited"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Extra field filters — shown when relevant defs exist (category selected or items have fields) */}
                  {activeExtraFieldDefs.length > 0 && (
                    <div className="space-y-1.5 border-t border-dashed border-[hsl(var(--border))]/50 pt-2">
                      {/* Dropdown filters: select, proximity, stars */}
                      {dropdownDefs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {dropdownDefs.map((def) => {
                            const isActive = !!extraFieldFilters.find((f) => f.key === def.key);
                            if (def.type === "proximity") {
                              return (
                                <select
                                  key={def.key}
                                  value={getFilterDropdownValue(def.key)}
                                  onChange={(e) => setExtraFieldDropdown(def.key, e.target.value, "proximity")}
                                  className={`rounded-md border px-2 py-1 text-[11px] transition-all ${
                                    isActive
                                      ? "border-violet-400 bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium"
                                      : "border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))]"
                                  }`}
                                >
                                  <option value="">{def.label}</option>
                                  {PROXIMITY_OPTIONS.filter((o) => o.value !== "-").map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label} or closer</option>
                                  ))}
                                </select>
                              );
                            }
                            if (def.type === "stars") {
                              return (
                                <select
                                  key={def.key}
                                  value={getFilterDropdownValue(def.key)}
                                  onChange={(e) => setExtraFieldDropdown(def.key, e.target.value, "stars")}
                                  className={`rounded-md border px-2 py-1 text-[11px] transition-all ${
                                    isActive
                                      ? "border-violet-400 bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium"
                                      : "border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))]"
                                  }`}
                                >
                                  <option value="">{def.label}</option>
                                  {[1, 2, 3, 4, 5].map((n) => (
                                    <option key={n} value={n}>{"★".repeat(n)}+</option>
                                  ))}
                                </select>
                              );
                            }
                            if (def.type === "select" && "options" in def) {
                              return (
                                <select
                                  key={def.key}
                                  value={getFilterDropdownValue(def.key)}
                                  onChange={(e) => setExtraFieldDropdown(def.key, e.target.value, "select")}
                                  className={`rounded-md border px-2 py-1 text-[11px] transition-all ${
                                    isActive
                                      ? "border-violet-400 bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium"
                                      : "border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--muted-foreground))]"
                                  }`}
                                >
                                  <option value="">{def.label}</option>
                                  {def.options.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                  ))}
                                </select>
                              );
                            }
                            return null;
                          })}
                        </div>
                      )}

                      {/* Boolean toggle pills */}
                      {booleanDefs.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {booleanDefs.map((def) => {
                            const isActive = extraFieldFilters.some((f) => f.key === def.key);
                            return (
                              <button
                                key={def.key}
                                onClick={() => toggleBooleanFilter(def.key)}
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all ${
                                  isActive
                                    ? "border-violet-400 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                                    : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] opacity-60 hover:opacity-100"
                                }`}
                              >
                                {isActive ? "✓ " : ""}{def.label}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Clear active extra filters */}
                      {extraFieldFilters.length > 0 && (
                        <button
                          onClick={() => setExtraFieldFilters([])}
                          className="text-[10px] font-medium text-red-400 hover:text-red-500 transition-colors"
                        >
                          ✕ Clear {extraFieldFilters.length} filter{extraFieldFilters.length > 1 ? "s" : ""}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Content — list or map */}
            {viewMode === "map" ? (
              <div className="flex-1 min-h-0">
                <FavouritesMap lists={visibleLists} onClose={() => setViewMode("list")} />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {loading && (
                  <p className="text-center text-sm text-[hsl(var(--muted-foreground))] animate-pulse">
                    Loading...
                  </p>
                )}

                {/* Filtered results mode */}
                {isFiltering && !loading && (
                  <div className="space-y-2">
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {filteredItems.length} result{filteredItems.length !== 1 ? "s" : ""}
                    </p>
                    {filteredItems.map(({ item, listName }) => (
                      <div key={item.id}>
                        <p className="mb-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                          {listName}
                        </p>
                        <FavouriteItemCard
                          item={item}
                          selectMode={selectMode}
                          isSelected={selectedIds.has(item.id)}
                          onToggleSelect={toggleSelect}
                        />
                      </div>
                    ))}
                    {filteredItems.length === 0 && (
                      <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
                        No matching favourites
                      </p>
                    )}
                  </div>
                )}

                {/* Normal list mode */}
                {!isFiltering && !loading && (
                  <div className="space-y-1">
                    {/* New list button */}
                    {showCreateForm ? (
                      <div className="mb-3">
                        <CreateListForm onDone={() => setShowCreateForm(false)} />
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowCreateForm(true)}
                        className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[hsl(var(--border))] py-2 text-xs font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        New list
                      </button>
                    )}

                    {visibleLists.map((list, idx) => renderList(list, false, idx))}

                    {visibleLists.length === 0 && !showCreateForm && (
                      <div className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
                        <p className="text-2xl mb-2">❤️</p>
                        <p>No favourites yet.</p>
                        <p className="mt-1 text-xs">
                          Click the heart icon on any POI to save it here.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* Batch action bar */}
            {selectMode && selectedIds.size > 0 && (
              <div className="border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[hsl(var(--foreground))]">
                    {selectedIds.size} selected
                  </span>
                  <div className="flex items-center gap-2">
                    {/* Move to list */}
                    <select
                      onChange={(e) => {
                        const targetId = Number(e.target.value);
                        if (targetId) handleBatchMove(targetId);
                        e.target.value = "";
                      }}
                      className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs text-[hsl(var(--foreground))]"
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Move to...
                      </option>
                      {visibleLists.map((l) => (
                        <optgroup key={l.id} label={l.name}>
                          <option value={l.id}>{l.name}</option>
                          {l.sublists.map((sub) => (
                            <option key={sub.id} value={sub.id}>
                              &nbsp;&nbsp;{sub.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {/* Delete */}
                    <button
                      onClick={handleBatchDelete}
                      className="rounded-md border border-red-300/40 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-500/20 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
