import type { RecommendableCategory } from "./index";

export type SubcategoryDef = {
  id: string;
  label: string;
  emoji: string;
  apiValues: string[];
  /** Parent group ID — UI groups children under the same parent. */
  group?: string;
  /** Display label for the group (only needed on the first member). */
  groupLabel?: string;
  /** When true, this subcategory is manual-add only (no Geoapify tags, hidden from Discover). */
  manualOnly?: boolean;
};

export const SUBCATEGORIES: Record<RecommendableCategory, SubcategoryDef[]> = {
  CULTURE: [
    { id: "museums",        label: "Museums",               emoji: "🏛",  apiValues: [] },
    { id: "art",            label: "Art & Galleries",        emoji: "🎨",  apiValues: [] },
    { id: "historic",       label: "Historical Sites",       emoji: "🏰",  apiValues: [] },
    { id: "architecture",   label: "Architecture & Landmarks", emoji: "🏗", apiValues: [] },
    { id: "religion",       label: "Religious Sites",        emoji: "⛪",  apiValues: [] },
    { id: "theatre",        label: "Theatre & Performing Arts", emoji: "🎭", apiValues: [] },
  ],
  FOOD: [
    { id: "restaurant",  label: "Restaurants",    emoji: "🍽",  apiValues: [] },
    { id: "cafe",        label: "Cafés",           emoji: "☕",  apiValues: [] },
    { id: "fast_food",   label: "Fast Food",       emoji: "🥙",  apiValues: [] },
    { id: "ice_cream",   label: "Ice Cream",       emoji: "🍦",  apiValues: [] },
    { id: "food_markets",label: "Food Markets",    emoji: "🧺",  apiValues: [] },
    { id: "wineries",    label: "Wineries",        emoji: "🍷",  apiValues: ["production.winery"] },
    { id: "breweries_distilleries", label: "Breweries & Distilleries", emoji: "🍺", apiValues: [] },
  ],
  NATURE: [
    { id: "parks",       label: "Parks & Gardens",          emoji: "🌳",  apiValues: [] },
    { id: "beaches",     label: "Beaches",                  emoji: "🏖",  apiValues: [] },
    { id: "mountains",   label: "Mountains",                emoji: "⛰",  apiValues: [] },
    { id: "lakes_rivers",label: "Lakes & Rivers",           emoji: "💧",  apiValues: [] },
    { id: "waterfalls",  label: "Waterfalls",               emoji: "🌊",  apiValues: [] },
    { id: "reserves",    label: "Nature Reserves / National Parks", emoji: "🌿", apiValues: [] },
    { id: "viewpoints",  label: "Viewpoints",               emoji: "🔭",  apiValues: [] },
  ],
  ENTERTAINMENT: [
    { id: "theme_parks", label: "Theme & Amusement Parks",  emoji: "🎡",  apiValues: [] },
    { id: "water_parks", label: "Water Parks",              emoji: "💦",  apiValues: [] },
    { id: "zoos",        label: "Zoos & Aquariums",         emoji: "🦁",  apiValues: [] },
    { id: "sport",       label: "Sports & Recreation",      emoji: "⚽",  apiValues: [] },
    { id: "games",       label: "Escape Rooms / Bowling / Mini Golf", emoji: "🎳", apiValues: [] },
    { id: "cinema",      label: "Cinema",                  emoji: "🎬",  apiValues: [] },
    { id: "planetarium", label: "Planetarium",             emoji: "🔭",  apiValues: [] },
  ],
  NIGHTLIFE: [
    { id: "bars",         label: "Bars & Pubs",         emoji: "🍺",  apiValues: [] },
    { id: "clubs",        label: "Nightclubs",          emoji: "💃",  apiValues: [] },
    { id: "comedy_shows", label: "Comedy / Shows",      emoji: "🎤",  apiValues: [] },
    { id: "casino",       label: "Casinos",             emoji: "🎰",  apiValues: [] },
  ],
  SHOPPING: [
    { id: "shopping_malls",   label: "Shopping Malls",    emoji: "🏬",  apiValues: [] },
    { id: "local_markets",    label: "Local Markets",     emoji: "🧺",  apiValues: [] },
    { id: "boutiques",        label: "Boutiques",         emoji: "👗",  apiValues: [] },
    { id: "souvenirs",        label: "Souvenirs",         emoji: "🎁",  apiValues: [] },
    { id: "books_antiques",   label: "Books & Antiques",  emoji: "📚",  apiValues: [] },
  ],
  GROCERIES: [
    { id: "supermarket",      label: "Supermarket",       emoji: "🛒",  apiValues: [] },
    { id: "bakery",           label: "Bakery",            emoji: "🥖",  apiValues: [] },
    { id: "butcher",          label: "Butcher",           emoji: "🥩",  apiValues: [] },
    { id: "fishmonger",       label: "Fishmonger",        emoji: "🐟",  apiValues: [] },
    { id: "wine_shops",       label: "Wine & Liquor",     emoji: "🍾",  apiValues: [] },
    { id: "deli_specialty",   label: "Deli & Specialty",  emoji: "🧀",  apiValues: [] },
    { id: "organic_farm",     label: "Organic & Farm",    emoji: "🌱",  apiValues: [] },
  ],
  WELLNESS: [
    { id: "spas",            label: "Spas & Saunas",    emoji: "🧖",  apiValues: [] },
    { id: "fitness_yoga",    label: "Fitness / Yoga",   emoji: "🏃",  apiValues: [] },
  ],
  OUTDOORS: [
    // ── Ungrouped (activity-only, no rental counterpart) ──
    { id: "hiking",              label: "Hiking Trails",        emoji: "🥾",  apiValues: [], manualOnly: true },
    { id: "climbing_spots",      label: "Climbing Spots",       emoji: "🧗",  apiValues: [], manualOnly: true },
    { id: "golf",                label: "Golf Courses",         emoji: "⛳",  apiValues: [], manualOnly: true },

    // ── Cycling ──
    { id: "cycling_routes",      label: "Cycling Routes",       emoji: "🚴",  apiValues: [], manualOnly: true, group: "cycling", groupLabel: "Cycling" },
    { id: "bike_rental",         label: "Bike Rental & Shops",  emoji: "🚲",  apiValues: [], group: "cycling" },

    // ── Skiing ──
    { id: "ski_areas",           label: "Ski Areas",            emoji: "⛷️",  apiValues: [], manualOnly: true, group: "skiing", groupLabel: "Skiing" },
    { id: "ski_rental",          label: "Ski Rental",           emoji: "🎿",  apiValues: [], group: "skiing" },

    // ── Water Sports ──
    { id: "surf_spots",          label: "Surf Spots",           emoji: "🏄",  apiValues: [], manualOnly: true, group: "water_sports", groupLabel: "Water Sports" },
    { id: "dive_spots",          label: "Dive Spots",           emoji: "🤿",  apiValues: [], manualOnly: true, group: "water_sports" },
    { id: "kayak_spots",         label: "Kayaking Spots",       emoji: "🛶",  apiValues: [], manualOnly: true, group: "water_sports" },
    { id: "water_sports_rental", label: "Water Sports Rental",  emoji: "🚣",  apiValues: [], group: "water_sports" },

    // ── Sailing ──
    { id: "sailing_routes",      label: "Sailing Routes",       emoji: "⛵",  apiValues: [], manualOnly: true, group: "sailing", groupLabel: "Sailing" },
    { id: "marina",              label: "Marinas & Boat Rental",emoji: "🚢",  apiValues: [], group: "sailing" },

    // ── Fishing ──
    { id: "fishing_spots",       label: "Fishing Spots",        emoji: "🎣",  apiValues: [], manualOnly: true, group: "fishing", groupLabel: "Fishing" },
    { id: "fishing_services",    label: "Fishing Services",     emoji: "🐟",  apiValues: [], group: "fishing" },

    // ── Horseback ──
    { id: "horseback_trails",    label: "Horseback Trails",     emoji: "🐴",  apiValues: [], manualOnly: true, group: "horseback", groupLabel: "Horseback Riding" },
    { id: "horse_riding",        label: "Riding Schools",       emoji: "🏇",  apiValues: [], group: "horseback" },
  ],
};

// ─── Backward compatibility ──────────────────────────────────────────────────

/** Maps old (pre-split) subcategory IDs to their new equivalents. */
export const LEGACY_SUBCAT_MAP: Record<string, string> = {
  cycling:   "bike_rental",
  kayaking:  "kayak_spots",
  surfing:   "surf_spots",
  skiing:    "ski_areas",
  diving:    "dive_spots",
  horseback: "horseback_trails",
  sailing:   "sailing_routes",
  fishing:   "fishing_spots",
  climbing:  "climbing_spots",
};

/** Normalize a subcategory ID — maps legacy IDs to their new form. */
export function normalizeSubcategory(id: string | null | undefined): string | null {
  if (!id) return null;
  return LEGACY_SUBCAT_MAP[id] ?? id;
}

// ─── Grouping utility ────────────────────────────────────────────────────────

export type SubcategoryGroup =
  | { type: "single"; def: SubcategoryDef }
  | { type: "group"; groupId: string; groupLabel: string; members: SubcategoryDef[] };

/** Group a category's subcategories by their `group` field for UI rendering. */
export function groupSubcategories(category: RecommendableCategory): SubcategoryGroup[] {
  const defs = SUBCATEGORIES[category];
  const result: SubcategoryGroup[] = [];
  const seen = new Set<string>();

  for (const def of defs) {
    if (!def.group) {
      result.push({ type: "single", def });
    } else if (!seen.has(def.group)) {
      seen.add(def.group);
      const members = defs.filter((d) => d.group === def.group);
      const first = members.find((m) => m.groupLabel);
      result.push({
        type: "group",
        groupId: def.group,
        groupLabel: first?.groupLabel ?? def.group,
        members,
      });
    }
  }
  return result;
}

// ─── Existing utilities ──────────────────────────────────────────────────────

export function resolveApiValues(
  category: RecommendableCategory,
  selectedIds: string[],
): string[] {
  if (selectedIds.length === 0) return [];
  const defs = SUBCATEGORIES[category];
  const active = defs.filter((d) => selectedIds.includes(d.id));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of active.flatMap((d) => d.apiValues)) {
    if (!seen.has(v)) { seen.add(v); result.push(v); }
  }
  return result;
}

export function resolveSpecialFlags(
  category: RecommendableCategory,
  selectedIds: string[],
): Set<string> {
  if (selectedIds.length === 0) return new Set();
  const defs = SUBCATEGORIES[category];
  const specials = new Set<string>();
  for (const d of defs) {
    if (selectedIds.includes(d.id) && (d as SubcategoryDef & { special?: string }).special) {
      specials.add((d as SubcategoryDef & { special?: string }).special!);
    }
  }
  return specials;
}
