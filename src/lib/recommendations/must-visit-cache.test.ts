import { describe, it, expect } from "vitest";

/**
 * Cache-key rules for must-visit, mirrored from `must-visit.ts`.
 *
 * Both keys were wrong in ways that cost real money or gave wrong answers:
 *
 *  - The generated name list is scoped to the requested categories (they are in
 *    the prompt), but the cache was keyed on `(cityId, "must-visit")` alone. A
 *    CULTURE run served its list to a later FOOD run.
 *  - The name→place Google lookup had no cache at all, because it resolves a
 *    name and so has no placeId to key on. The same ~13-20 names were queried
 *    on every run, warm or cold.
 */

function listCacheType(categories: string[]): string {
  return `must-visit:${[...categories].sort().join(",")}`;
}

function mustVisitCacheKey(cityName: string, placeName: string): string {
  const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
  return `mv:${norm(cityName)}:${norm(placeName)}`;
}

describe("must-visit list cache key", () => {
  it("separates different category selections", () => {
    expect(listCacheType(["CULTURE"])).not.toBe(listCacheType(["FOOD"]));
    expect(listCacheType(["CULTURE", "FOOD"])).not.toBe(listCacheType(["CULTURE"]));
  });

  it("is order-independent, so the same selection hits the same entry", () => {
    expect(listCacheType(["FOOD", "CULTURE"])).toBe(listCacheType(["CULTURE", "FOOD"]));
  });

  it("is stable for a repeated selection", () => {
    expect(listCacheType(["CULTURE", "NATURE"])).toBe(listCacheType(["CULTURE", "NATURE"]));
  });
});

describe("must-visit name lookup cache key", () => {
  it("collapses casing and spacing variants onto one entry", () => {
    const a = mustVisitCacheKey("Bolzano", "Piazza Walther");
    expect(mustVisitCacheKey("bolzano", "piazza walther")).toBe(a);
    expect(mustVisitCacheKey(" Bolzano ", "Piazza  Walther")).toBe(a);
  });

  it("keeps different places apart", () => {
    expect(mustVisitCacheKey("Bolzano", "Piazza Walther"))
      .not.toBe(mustVisitCacheKey("Bolzano", "Stadtturm"));
  });

  it("keeps the same place name in different cities apart", () => {
    // "Stadtturm" exists in plenty of Alpine towns.
    expect(mustVisitCacheKey("Bolzano", "Stadtturm"))
      .not.toBe(mustVisitCacheKey("Merano", "Stadtturm"));
  });

  it("is namespaced so it cannot collide with a real Geoapify placeId", () => {
    expect(mustVisitCacheKey("Bolzano", "Piazza Walther").startsWith("mv:")).toBe(true);
  });
});
