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
    { id: "theatre",        label: "Theatre & Performing Arts", emoji: "🎭", apiValues: [] },
  ],
  FOOD: [
    { id: "restaurant",  label: "Restaurants",    emoji: "🍽",  apiValues: [] },
    { id: "fine_dining", label: "Fine Dining",     emoji: "🥂",  apiValues: [], special: "fine_dining" },
    { id: "cafe",        label: "Cafés",           emoji: "☕",  apiValues: [] },
    { id: "fast_food",   label: "Fast Food",       emoji: "🥙",  apiValues: [] },
    { id: "bakery",      label: "Bakeries",        emoji: "🥐",  apiValues: [] },
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
    { id: "shop_bakery",      label: "Bakery",            emoji: "🥖",  apiValues: [] },
    { id: "butcher",          label: "Butcher",           emoji: "🥩",  apiValues: [] },
    { id: "fishmonger",       label: "Fishmonger",        emoji: "🐟",  apiValues: [] },
    { id: "wine_shops",       label: "Wine & Liquor",     emoji: "🍾",  apiValues: [] },
    { id: "deli_specialty",   label: "Deli & Specialty",  emoji: "🧀",  apiValues: [] },
    { id: "organic_farm",     label: "Organic & Farm",    emoji: "🌱",  apiValues: [] },
  ],
  WELLNESS: [
    { id: "spas",            label: "Spas & Saunas",    emoji: "🧖",  apiValues: [] },
    { id: "yoga_fitness",    label: "Yoga / Fitness",   emoji: "🏃",  apiValues: [] },
  ],
  OUTDOORS: [
    { id: "hiking",          label: "Hiking",            emoji: "🥾",  apiValues: [] },
    { id: "cycling",         label: "Cycling",           emoji: "🚴",  apiValues: [] },
    { id: "kayaking",        label: "Kayaking / Canoeing", emoji: "🛶", apiValues: [] },
    { id: "climbing",        label: "Climbing",          emoji: "🧗",  apiValues: [] },
    { id: "surfing",         label: "Surfing / Water Sports", emoji: "🏄", apiValues: [] },
    { id: "skiing",          label: "Skiing / Snowboarding", emoji: "⛷️", apiValues: [] },
    { id: "diving",          label: "Diving / Snorkeling", emoji: "🤿", apiValues: [] },
    { id: "horseback",       label: "Horseback Riding",  emoji: "🐴",  apiValues: [] },
    { id: "sailing",         label: "Sailing / Boating", emoji: "⛵",  apiValues: [] },
    { id: "fishing",         label: "Fishing",           emoji: "🎣",  apiValues: [] },
    { id: "golf",            label: "Golf",              emoji: "⛳",  apiValues: [] },
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
