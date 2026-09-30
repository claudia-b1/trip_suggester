import { describe, it, expect } from "vitest";
import { nameSimilarity } from "@/lib/recommendations/scoring";

/**
 * These cases are drawn from real Rovinj data and encode a finding that is easy
 * to get backwards: **name similarity is the wrong primary guard for matching a
 * POI to a Google Places result.**
 *
 * POI names come from OSM in the local language while Google returns the
 * translated name, so correct matches routinely score 0.00. Meanwhile the worst
 * failure mode — a different branch of the same chain — scores a perfect 1.00.
 * Distance has to do the work; the name is only a tiebreaker.
 *
 * If someone later raises the name threshold in `re-enrich`, these tests explain
 * why that strips photos from correctly-matched POIs on a non-English trip.
 */
describe("nameSimilarity — why distance must be the primary guard", () => {
  it("scores a different branch of the same chain as a perfect match", () => {
    // A Lidl 2.4km away is indistinguishable by name from the right one.
    expect(nameSimilarity("Lidl", "Lidl")).toBe(1);
    expect(nameSimilarity("Kaufland", "Kaufland")).toBe(1);
  });

  it("scores correct translated matches near zero", () => {
    expect(nameSimilarity("Balbijev luk", "Balbi Arch")).toBeLessThan(0.2);
    expect(nameSimilarity("Rovinj Heritage Museum", "Zavičajni muzej Grada Rovinja")).toBeLessThan(0.2);
    expect(nameSimilarity("Zlatni Rt", "Golden Cape Forest Park")).toBeLessThan(0.2);
  });

  it("scores a near-identical local name below a naive 0.5 threshold", () => {
    // One transposed letter is enough to fall through a 0.5 gate.
    expect(nameSimilarity("Pekara Mrvisa", "Pekara Mrvica")).toBeLessThan(0.5);
  });

  it("still scores obvious same-name matches highly", () => {
    expect(nameSimilarity("Nothing to Sea", "Nothing to Sea Cocktail Bar")).toBeGreaterThan(0.8);
    expect(nameSimilarity("Grisia", "Grisia Street")).toBeGreaterThan(0.7);
    expect(nameSimilarity("St. Euphemia's Church", "Church of St. Euphemia")).toBeGreaterThan(0.7);
  });

  it("separates a genuinely different nearby place from the target", () => {
    // A beach and a hotel sharing a name — the case the name guard does earn.
    expect(nameSimilarity("Uvala Valdibora", "Villa Valdibora")).toBeLessThan(0.4);
  });

  it("is symmetric", () => {
    expect(nameSimilarity("Balbi Arch", "Balbijev luk"))
      .toBe(nameSimilarity("Balbijev luk", "Balbi Arch"));
  });
});

/**
 * The decision rule used by `findGooglePhoto` in the re-enrich route, restated
 * here so the thresholds are pinned by a test rather than only by a comment.
 */
const TRUST_DISTANCE_M = 150;
const MAX_MATCH_DISTANCE_M = 300;
const MIN_NAME_SIMILARITY = 0.4;

function accepts(poiName: string, googleName: string, distanceM: number): boolean {
  if (distanceM > MAX_MATCH_DISTANCE_M) return false;
  if (distanceM > TRUST_DISTANCE_M) {
    return nameSimilarity(poiName, googleName) >= MIN_NAME_SIMILARITY;
  }
  return true;
}

describe("re-enrich photo match rule", () => {
  it("rejects a distant branch of the same chain", () => {
    expect(accepts("Lidl", "Lidl", 2400)).toBe(false);
    expect(accepts("Kaufland", "Kaufland", 5100)).toBe(false);
  });

  it("accepts a translated name at the same coordinates", () => {
    expect(accepts("Balbijev luk", "Balbi Arch", 15)).toBe(true);
    expect(accepts("Rovinj Heritage Museum", "Zavičajni muzej Grada Rovinja", 8)).toBe(true);
    expect(accepts("Zlatni Rt", "Golden Cape Forest Park", 90)).toBe(true);
  });

  it("accepts a near-identical local name at the same coordinates", () => {
    expect(accepts("Pekara Mrvisa", "Pekara Mrvica", 30)).toBe(true);
    expect(accepts("Mesnica Serđo Rovinj", "Mesnica Serdo", 20)).toBe(true);
  });

  it("falls back to the name only in the ambiguous distance band", () => {
    expect(accepts("Uvala Valdibora", "Villa Valdibora", 220)).toBe(false);
    expect(accepts("Nothing to Sea", "Nothing to Sea Cocktail Bar", 200)).toBe(true);
  });

  it("treats the trust distance as inclusive", () => {
    // At or under 150m the name is not consulted at all.
    expect(accepts("Totally Different", "Nothing Alike", TRUST_DISTANCE_M)).toBe(true);
    expect(accepts("Totally Different", "Nothing Alike", TRUST_DISTANCE_M + 1)).toBe(false);
  });
});
