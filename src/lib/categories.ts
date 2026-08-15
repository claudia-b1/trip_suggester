export const CATEGORIES = [
  "CULTURE",
  "FOOD",
  "NATURE",
  "ENTERTAINMENT",
  "NIGHTLIFE",
  "SHOPPING",
  "WELLNESS",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Human-readable display labels for each category. FOOD shows as "Food & Drinks". */
export const CATEGORY_LABELS: Record<Category, string> = {
  CULTURE:       "Culture",
  FOOD:          "Food & Drinks",
  NATURE:        "Nature",
  ENTERTAINMENT: "Entertainment",
  NIGHTLIFE:     "Nightlife",
  SHOPPING:      "Shopping",
  WELLNESS:      "Wellness",
};

export const CATEGORY_STYLES: Record<Category, { badge: string; dot: string }> = {
  CULTURE:    { badge: "bg-amber-100 text-amber-800",   dot: "#d97706" },
  FOOD:       { badge: "bg-red-100 text-red-800",       dot: "#dc2626" },
  NATURE:     { badge: "bg-green-100 text-green-800",   dot: "#16a34a" },
  ENTERTAINMENT: { badge: "bg-sky-100 text-sky-800",       dot: "#0284c7" },
  NIGHTLIFE:  { badge: "bg-purple-100 text-purple-800", dot: "#9333ea" },
  SHOPPING:   { badge: "bg-pink-100 text-pink-800",     dot: "#db2777" },
  WELLNESS:   { badge: "bg-teal-100 text-teal-800",     dot: "#0d9488" },
};

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}
