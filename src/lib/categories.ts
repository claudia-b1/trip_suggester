export const CATEGORIES = [
  "CULTURE",
  "FOOD",
  "NATURE",
  "NIGHTLIFE",
  "SHOPPING",
  "OUTDOORS",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_STYLES: Record<Category, { badge: string; dot: string }> = {
  CULTURE: { badge: "bg-amber-100 text-amber-800", dot: "#d97706" },
  FOOD: { badge: "bg-red-100 text-red-800", dot: "#dc2626" },
  NATURE: { badge: "bg-green-100 text-green-800", dot: "#16a34a" },
  NIGHTLIFE: { badge: "bg-purple-100 text-purple-800", dot: "#9333ea" },
  SHOPPING: { badge: "bg-pink-100 text-pink-800", dot: "#db2777" },
  OUTDOORS: { badge: "bg-sky-100 text-sky-800", dot: "#0284c7" },
};

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}
