import { generateCulture } from "./culture";
import { generateFood } from "./food";
import { generateNature } from "./nature";
import { generateNightlife } from "./nightlife";
import type { GenerateInput, RecommendedPoi } from "./_shared";

export type { GenerateInput, RecommendedPoi } from "./_shared";

export const GENERATORS = {
  CULTURE: generateCulture,
  FOOD: generateFood,
  NATURE: generateNature,
  NIGHTLIFE: generateNightlife,
} satisfies Record<string, (input: GenerateInput) => Promise<RecommendedPoi[]>>;

export type RecommendableCategory = keyof typeof GENERATORS;

export const RECOMMENDABLE_CATEGORIES: RecommendableCategory[] = [
  "CULTURE",
  "FOOD",
  "NATURE",
  "NIGHTLIFE",
];

export function isRecommendableCategory(v: unknown): v is RecommendableCategory {
  return (
    typeof v === "string" &&
    (RECOMMENDABLE_CATEGORIES as readonly string[]).includes(v)
  );
}
