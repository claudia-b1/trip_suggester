import type { RecommendableCategory } from "./index";

export type SubcategoryDef = {
  id: string;
  label: string;
  emoji: string;
  /**
   * Geoapify category IDs (as strings) for this subcategory.
   * Used by geoapify.ts to narrow the search query.
   * If special behaviour is needed (vegetarian, fine_dining) the generator
   * handles it as a post-fetch filter; apiValues still points to the base IDs.
   */
  apiValues: string[];
  special?: "vegetarian" | "fine_dining";
};

export const SUBCATEGORIES: Record<RecommendableCategory, SubcategoryDef[]> = {
  CULTURE: [
    { id: "museums",      label: "Museums",          emoji: "🏛",  apiValues: ["10027"] },
    { id: "art",          label: "Art & galleries",   emoji: "🎨",  apiValues: ["10004"] },
    { id: "historic",     label: "Historic sites",    emoji: "🏰",  apiValues: ["16014", "16019"] },
    { id: "architecture", label: "Architecture",      emoji: "🏗",  apiValues: ["16012"] },
    { id: "religion",     label: "Religious",         emoji: "⛪",  apiValues: ["12048"] },
    { id: "theatre",      label: "Theatre & shows",   emoji: "🎭",  apiValues: ["10037", "10028"] },
  ],
  FOOD: [
    { id: "restaurant",  label: "Restaurants",         emoji: "🍽",  apiValues: ["13065"] },
    { id: "fine_dining", label: "Fine dining",          emoji: "🥂",  apiValues: ["13065"], special: "fine_dining" },
    { id: "cafe",        label: "Cafés",                emoji: "☕",  apiValues: ["13032"] },
    { id: "fast_food",   label: "Budget / street food", emoji: "🥙",  apiValues: ["13145"] },
    { id: "vegetarian",  label: "Vegetarian",           emoji: "🥗",  apiValues: ["13065"], special: "vegetarian" },
    { id: "bakery",      label: "Bakeries",             emoji: "🥐",  apiValues: ["13100"] },
    { id: "ice_cream",   label: "Ice cream",            emoji: "🍦",  apiValues: ["13237"] },
  ],
  NATURE: [
    { id: "parks",      label: "Parks & gardens",    emoji: "🌳",  apiValues: ["16032", "16017"] },
    { id: "beaches",    label: "Beaches",             emoji: "🏖",  apiValues: ["16010"] },
    { id: "mountains",  label: "Mountains & forests", emoji: "⛰",  apiValues: ["16020", "16383"] },
    { id: "water",      label: "Rivers & waterfalls", emoji: "💧",  apiValues: ["16042"] },
    { id: "reserves",   label: "Nature reserves",     emoji: "🌿",  apiValues: ["16020"] },
  ],
  NIGHTLIFE: [
    { id: "bars",          label: "Bars & pubs",    emoji: "🍺",  apiValues: ["13003", "13031"] },
    { id: "clubs",         label: "Night clubs",    emoji: "💃",  apiValues: ["13057"] },
    { id: "entertainment", label: "Entertainment",  emoji: "🎳",  apiValues: ["10035", "10036"] },
    { id: "casino",        label: "Casinos",        emoji: "🎰",  apiValues: ["10031"] },
  ],
  OUTDOORS: [
    { id: "viewpoints",     label: "Viewpoints",      emoji: "🔭",  apiValues: ["16046"] },
    { id: "sport",          label: "Sports venues",   emoji: "⚽",  apiValues: ["18000", "18021"] },
    { id: "amusements",     label: "Amusements",      emoji: "🎡",  apiValues: ["10035", "10036"] },
    { id: "water_parks",    label: "Water parks",     emoji: "💦",  apiValues: ["10041"] },
    { id: "zoos",           label: "Zoos & wildlife", emoji: "🦁",  apiValues: ["10056"] },
    { id: "national_parks", label: "National parks",  emoji: "🏕",  apiValues: ["16020"] },
  ],
};

/**
 * Resolve selected subcategory IDs → unique Geoapify category ID strings.
 * If selectedIds is empty, returns an empty array (caller uses defaults).
 */
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

/** Returns which special flags are active among the selected sub IDs. */
export function resolveSpecialFlags(
  category: RecommendableCategory,
  selectedIds: string[],
): Set<string> {
  if (selectedIds.length === 0) return new Set();
  const defs = SUBCATEGORIES[category];
  const specials = new Set<string>();
  for (const d of defs) {
    if (selectedIds.includes(d.id) && d.special) specials.add(d.special);
  }
  return specials;
}