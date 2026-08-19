"use client";

import { useState } from "react";
import { CATEGORY_STYLES, CATEGORY_LABELS, CATEGORY_ICONS, isCategory, type Category } from "@/lib/categories";
import { useFavourites, type FavouriteItemDTO } from "./favourites-provider";
import { FavouriteDayPlanAssigner } from "./favourite-day-plan-assigner";
import { useToast } from "@/components/ui/toast";
import { useUndoableDelete } from "@/hooks/use-undoable-delete";
import { getExtraFieldDefs, PROXIMITY_OPTIONS, ACCOMMODATION_SUBCATEGORIES } from "@/lib/favourite-fields";

export function FavouriteItemCard({
  item,
  selectMode,
  isSelected,
  onToggleSelect,
}: {
  item: FavouriteItemDTO;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: number) => void;
}) {
  const { refreshLists, currentCity, showEditModal, close } = useFavourites();
  const { toast } = useToast();
  const undoableDelete = useUndoableDelete();
  const [expanded, setExpanded] = useState(false);
  const [visited, setVisited] = useState(item.visited);
  const [personalRating, setPersonalRating] = useState<number | null>(
    item.personalRating,
  );
  const [hoverStar, setHoverStar] = useState<number | null>(null);
  const cat = isCategory(item.category) ? item.category : null;

  function handleDelete() {
    // Optimistically remove from UI
    undoableDelete({
      label: item.name,
      onDelete: async () => {
        const res = await fetch(`/api/favourites/items/${item.id}`, {
          method: "DELETE",
        });
        if (res.ok) await refreshLists();
      },
      onRestore: () => {
        // Restore by refreshing
        refreshLists();
      },
    });
    // Trigger immediate UI removal
    refreshLists();
  }

  async function toggleVisited() {
    const newVal = !visited;
    setVisited(newVal);
    await fetch(`/api/favourites/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visited: newVal }),
    });
    // Notify POI section so it can update its local state
    window.dispatchEvent(new CustomEvent("favourite-sync", {
      detail: { name: item.name, city: item.city, sourcePlaceId: item.sourcePlaceId, visited: newVal },
    }));
  }

  async function handleRate(star: number) {
    const newRating = personalRating === star ? null : star;
    setPersonalRating(newRating);
    await fetch(`/api/favourites/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personalRating: newRating }),
    });
    // Notify POI section so it can update its local state
    window.dispatchEvent(new CustomEvent("favourite-sync", {
      detail: { name: item.name, city: item.city, sourcePlaceId: item.sourcePlaceId, rating: newRating },
    }));
  }

  const styles = cat ? CATEGORY_STYLES[cat] : null;
  const displayRating = hoverStar ?? personalRating ?? 0;

  // In select mode, clicking the card toggles selection
  if (selectMode) {
    return (
      <div
        onClick={() => onToggleSelect?.(item.id)}
        className={`group cursor-pointer rounded-lg border p-3 transition-colors ${
          isSelected
            ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5"
            : "border-[hsl(var(--border))] bg-[hsl(var(--background))] hover:bg-[hsl(var(--muted))]"
        }`}
      >
        <div className="flex items-center gap-2">
          <div
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
              isSelected
                ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                : "border-[hsl(var(--border))]"
            }`}
          >
            {isSelected && (
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <span className="text-sm font-medium truncate text-[hsl(var(--foreground))]">
            {item.name}
          </span>
          {cat && styles && (
            <span
              className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${styles.badge}`}
            >
              {CATEGORY_ICONS[cat]}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 transition-colors hover:bg-[hsl(var(--muted))] ${
        visited ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Visited toggle */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleVisited();
          }}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            visited
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-[hsl(var(--border))] text-transparent hover:border-emerald-400"
          }`}
          title={visited ? "Mark as not visited" : "Mark as visited"}
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>

        {/* Icon + info */}
        <div className="flex-1 min-w-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-left w-full"
          >
            <span
              className={`text-sm font-medium truncate text-[hsl(var(--foreground))] ${
                visited ? "line-through" : ""
              }`}
            >
              {item.name}
            </span>
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {cat && styles && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${styles.badge}`}
              >
                {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
              </span>
            )}
            {item.subcategory && (() => {
              const accomSub = cat === "ACCOMMODATION" ? ACCOMMODATION_SUBCATEGORIES.find((s) => s.id === item.subcategory) : null;
              return (
                <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                  {accomSub ? `${accomSub.emoji} ${accomSub.label}` : item.subcategory}
                </span>
              );
            })()}
          </div>
          {/* Star rating */}
          <div className="mt-1.5 flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                title={`Rate ${star} star${star > 1 ? "s" : ""}`}
                onMouseEnter={() => setHoverStar(star)}
                onMouseLeave={() => setHoverStar(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRate(star);
                }}
                className={`text-sm leading-none transition-colors ${
                  star <= displayRating ? "text-amber-400" : "text-gray-300"
                }`}
              >
                ★
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))] truncate">
            {item.city}, {item.country}
          </p>
        </div>

        {/* Edit + Delete buttons */}
        <div className="mt-0.5 flex shrink-0 gap-0.5 opacity-100 sm:opacity-0 transition-opacity sm:group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              showEditModal(item);
              close(); // close panel so modal is visible
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"
            title="Edit"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button
            onClick={handleDelete}
            className="flex h-6 w-6 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-red-500"
            title="Remove"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M5 6l1-3h12l1 3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 space-y-1 border-t border-[hsl(var(--border))] pt-2 text-xs text-[hsl(var(--muted-foreground))]">
          {item.description && <p>{item.description}</p>}
          {item.notes && (
            <p className="italic text-[hsl(var(--foreground))]">
              💬 {item.notes}
            </p>
          )}
          {item.website && (
            <a
              href={item.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[hsl(var(--primary))] hover:underline"
            >
              🔗 Website
            </a>
          )}

          {/* Extra fields display — ordered by field definition */}
          {item.extraFields && Object.keys(item.extraFields).length > 0 && (() => {
            const ef = item.extraFields as Record<string, unknown>;
            const fieldDefs = getExtraFieldDefs(item.category, item.subcategory);
            // Iterate in definition order, then show any extra keys not in defs
            const defKeys = new Set(fieldDefs.map((d) => d.key));
            const orderedDefs = [
              ...fieldDefs,
              ...Object.keys(ef)
                .filter((k) => !defKeys.has(k))
                .map((k) => ({ type: "text" as const, key: k, label: k })),
            ];
            const displayFields = orderedDefs.filter((def) => {
              const v = ef[def.key];
              return v !== null && v !== undefined && v !== "" && v !== false && v !== "-";
            });
            if (displayFields.length === 0) return null;
            return (
              <div className="mt-1.5 space-y-0.5">
                {displayFields.map((def) => {
                  const value = ef[def.key];
                  let displayValue: string;

                  if (def.type === "proximity") {
                    const opt = PROXIMITY_OPTIONS.find((o) => o.value === value);
                    displayValue = opt?.label ?? String(value);
                  } else if (def.type === "stars") {
                    displayValue = "★".repeat(value as number) + "☆".repeat(5 - (value as number));
                  } else if (def.type === "boolean") {
                    displayValue = "Yes";
                  } else if (def.type === "select" && "options" in def) {
                    const opt = def.options.find((o: { value: string }) => o.value === value);
                    displayValue = opt?.label ?? String(value);
                  } else {
                    displayValue = String(value);
                  }
                  return (
                    <p key={def.key} className="flex items-center gap-1">
                      <span className="text-[hsl(var(--muted-foreground))]">{def.label}:</span>
                      <span className="text-[hsl(var(--foreground))]">{displayValue}</span>
                    </p>
                  );
                })}
              </div>
            );
          })()}

          {/* Day plan assigner — connected mode on matching city page, standalone otherwise */}
          {currentCity &&
            currentCity.name.toLowerCase() === item.city.toLowerCase() ? (
              <FavouriteDayPlanAssigner
                item={item}
                cityId={currentCity.id}
                dayPlans={currentCity.dayPlans}
              />
            ) : (
              <FavouriteDayPlanAssigner item={item} />
            )}
        </div>
      )}
    </div>
  );
}
