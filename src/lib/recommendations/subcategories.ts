import type { RecommendableCategory } from "./index";

export type SubcategoryDef = {
  id: string;
  label: string;
  emoji: string;
  apiValues: string[];
  special?: "vegetarian" | "fine_dining";
};

export const SUBCATEGORIES: Record<RecommendableCategory, SubcategoryDef[]> = {
  CULTURE: [
    { id: "museums",        label: "Museums",               emoji: "🏛",  apiValues: [] },
    { id: "art",            label: "Art & Galleries",        emoji: "🎨",  apiValues: [] },
    { id: "historic",       label: "Historical Sites",       emoji: "🏰",  apiValues: [] },
    { id: "architecture",   label: "Architecture & Landmarks", emoji: "🏗", apiValues: [] },
    { id: "religion",       label: "Religious Sites",        emoji: "⛪",  apiValues: [] },
    { id: "theatre_cinema", label: "Theatre & Cinema",       emoji: "🎭",  apiValues: [] },
  ],
  FOOD: [
    { id: "restaurant",  label: "Restaurants",    emoji: "🍽",  apiValues: [] },
    { id: "fine_dining", label: "Fine Dining",     emoji: "🥂",  apiValues: [], special: "fine_dining" },
    { id: "cafe",        label: "Cafés",           emoji: "☕",  apiValues: [] },
    { id: "fast_food",   label: "Fast Food",       emoji: "🥙",  apiValues: [] },
    { id: "bakery",      label: "Bakeries",        emoji: "🥐",  apiValues: [] },
    { id: "ice_cream",   label: "Ice Cream",       emoji: "🍦",  apiValues: [] },
    { id: "food_markets",label: "Food Markets",    emoji: "🧺",  apiValues: [] },
    { id: "wineries",    label: "Wineries",        emoji: "🍷",  apiValues: ["craft.winery", "tourism.winery"] },
    { id: "wine_shops",  label: "Wine Shops",      emoji: "🍾",  apiValues: ["commercial.food_and_drink.wine"] },
    { id: "wine_bars",   label: "Wine Bars",       emoji: "🥂",  apiValues: ["catering.wine_bar"] },
  ],
  NATURE: [
    { id: "parks",       label: "Parks & Gardens",          emoji: "🌳",  apiValues: [] },
    { id: "beaches",     label: "Beaches",                  emoji: "🏖",  apiValues: [] },
    { id: "mountains",   label: "Mountains",                emoji: "⛰",  apiValues: [] },
    { id: "lakes_rivers",label: "Lakes & Rivers",           emoji: "💧",  apiValues: [] },
    { id: "waterfalls",  label: "Waterfalls",               emoji: "🌊",  apiValues: [] },
    { id: "reserves",    label: "Nature Reserves / National Parks", emoji: "🌿", apiValues: [] },
    { id: "viewpoints",  label: "Viewpoints",               emoji: "🔭",  apiValues: [] },
    { id: "scenic",      label: "Scenic Spots",             emoji: "📸",  apiValues: [] },
  ],
  ENTERTAINMENT: [
    { id: "theme_parks", label: "Theme & Amusement Parks",  emoji: "🎡",  apiValues: [] },
    { id: "water_parks", label: "Water Parks",              emoji: "💦",  apiValues: [] },
    { id: "zoos",        label: "Zoos & Aquariums",         emoji: "🦁",  apiValues: [] },
    { id: "sport",       label: "Sports & Recreation",      emoji: "⚽",  apiValues: [] },
    { id: "games",       label: "Escape Rooms / Bowling / Mini Golf", emoji: "🎳", apiValues: [] },
  ],
  NIGHTLIFE: [
    { id: "bars",         label: "Bars & Pubs",         emoji: "🍺",  apiValues: [] },
    { id: "clubs",        label: "Nightclubs",          emoji: "💃",  apiValues: [] },
    { id: "live_music",   label: "Live Music Venues",   emoji: "🎵",  apiValues: [] },
    { id: "comedy_shows", label: "Comedy / Shows",      emoji: "🎤",  apiValues: [] },
    { id: "casino",       label: "Casinos",             emoji: "🎰",  apiValues: [] },
  ],
  SHOPPING: [
    { id: "shopping_malls",   label: "Shopping Malls",    emoji: "🏬",  apiValues: [] },
    { id: "local_markets",    label: "Local Markets",     emoji: "🧺",  apiValues: [] },
    { id: "boutiques",        label: "Boutiques",         emoji: "👗",  apiValues: [] },
    { id: "souvenirs",        label: "Souvenirs",         emoji: "🎁",  apiValues: [] },
    { id: "shopping_streets", label: "Shopping Streets",  emoji: "🛤",  apiValues: [] },
  ],
  WELLNESS: [
    { id: "spas",            label: "Spas & Saunas",    emoji: "🧖",  apiValues: [] },
    { id: "wellness_centres",label: "Wellness Centers", emoji: "🌸",  apiValues: [] },
    { id: "yoga_fitness",    label: "Yoga / Fitness",   emoji: "🏃",  apiValues: [] },
  ],
};

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
    if (selectedIds.includes(d.id) && d.special) specials.add(d.special);
  }
  return specials;
}
