import { describe, it, expect } from "vitest";
import { parseActivityResponse } from "@/lib/activity-recommendations";

/** Rovinj — the city these fixtures are written against. */
const CITY = { lat: 45.0810, lon: 13.6380 };

const wrap = (recommendations: unknown[]) =>
  JSON.stringify({ recommendations });

describe("parseActivityResponse — well-formed output", () => {
  it("keeps a valid recommendation intact", () => {
    const { recommendations } = parseActivityResponse(
      wrap([{
        title: "Climb the bell tower of St. Euphemia",
        description: "Panoramic views over the Adriatic.",
        linkedPlace: "Church of St. Euphemia",
        category: "CULTURE",
        latitude: 45.0832,
        longitude: 13.6310,
      }]),
      CITY,
    );

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      title: "Climb the bell tower of St. Euphemia",
      linkedPlace: "Church of St. Euphemia",
      category: "CULTURE",
      latitude: 45.0832,
      coordinateSource: "ai",
    });
  });

  it("extracts JSON even when the model adds prose around it", () => {
    const { recommendations } = parseActivityResponse(
      'Sure! Here you go:\n{"recommendations":[{"title":"Old Town","description":"Lovely."}]}',
      CITY,
    );
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].title).toBe("Old Town");
  });

  it("accepts the alternate key names the model uses", () => {
    const { recommendations } = parseActivityResponse(
      JSON.stringify({ must_do: [{ title: "Walk the walls", description: "Nice." }] }),
      CITY,
    );
    expect(recommendations).toHaveLength(1);
  });
});

describe("parseActivityResponse — hallucination guards", () => {
  it("strips a category the model invented", () => {
    const { recommendations } = parseActivityResponse(
      wrap([{ title: "Wine tasting", description: "Nice.", category: "GASTRONOMY_EXPERIENCE" }]),
      CITY,
    );
    expect(recommendations[0].category).toBeUndefined();
  });

  it("keeps a valid category regardless of case", () => {
    const { recommendations } = parseActivityResponse(
      wrap([{ title: "Dinner", description: "Nice.", category: "food" }]),
      CITY,
    );
    expect(recommendations[0].category).toBe("FOOD");
  });

  it("drops items whose title is an unfilled template placeholder", () => {
    const { recommendations } = parseActivityResponse(
      wrap([
        { title: "Short description of activity", description: "1-2 sentences here" },
        { title: "...", description: "x" },
        { title: "Real Place", description: "Real." },
      ]),
      CITY,
    );
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].title).toBe("Real Place");
  });

  it("treats the literal string 'null' as no linked place", () => {
    const { recommendations } = parseActivityResponse(
      wrap([{ title: "Walk", description: "d", linkedPlace: "null" }]),
      CITY,
    );
    expect(recommendations[0].linkedPlace).toBeUndefined();
  });

  it("truncates a runaway description rather than discarding it", () => {
    const { recommendations } = parseActivityResponse(
      wrap([{ title: "Museum", description: "x".repeat(50_000) }]),
      CITY,
    );
    // Dropping the field entirely loses more than clipping it does.
    expect(recommendations[0].description.length).toBe(1000);
    expect(recommendations[0].description.endsWith("…")).toBe(true);
  });
});

describe("parseActivityResponse — coordinate validation", () => {
  it("rejects coordinates on the wrong continent", () => {
    const { recommendations } = parseActivityResponse(
      // New York, while the city is in Croatia.
      wrap([{ title: "Somewhere", description: "d", latitude: 40.7128, longitude: -74.0060 }]),
      CITY,
    );
    expect(recommendations[0].latitude).toBeUndefined();
    expect(recommendations[0].longitude).toBeUndefined();
  });

  it("rejects null island", () => {
    const { recommendations } = parseActivityResponse(
      wrap([{ title: "Nowhere", description: "d", latitude: 0, longitude: 0 }]),
      CITY,
    );
    expect(recommendations[0].latitude).toBeUndefined();
  });

  it("rejects out-of-range coordinates", () => {
    const { recommendations } = parseActivityResponse(
      wrap([{ title: "Bad", description: "d", latitude: 999, longitude: 13.6 }]),
      CITY,
    );
    expect(recommendations[0].latitude).toBeUndefined();
  });

  it("keeps the item when only its coordinates are rejected", () => {
    // The card still renders; it's the UI's job to mark it unverified.
    const { recommendations } = parseActivityResponse(
      wrap([{ title: "Somewhere", description: "d", latitude: 40.7128, longitude: -74.0060 }]),
      CITY,
    );
    expect(recommendations).toHaveLength(1);
  });
});

describe("parseActivityResponse — malformed output", () => {
  it("returns nothing for truncated JSON", () => {
    const r = parseActivityResponse('{"recommendations":[{"title":"Old Town"', CITY);
    expect(r.recommendations).toHaveLength(0);
  });

  it("returns nothing when the model refuses", () => {
    const r = parseActivityResponse("I cannot help with that request.", CITY);
    expect(r.recommendations).toHaveLength(0);
  });

  it("returns nothing for an empty string", () => {
    const r = parseActivityResponse("", CITY);
    expect(r.recommendations).toHaveLength(0);
  });

  it("does not let one bad item discard the good ones", () => {
    const { recommendations } = parseActivityResponse(
      wrap([
        { title: "Good one", description: "d" },
        { notATitle: true },
        { title: "Another good one", description: "d" },
      ]),
      CITY,
    );
    expect(recommendations.map((r) => r.title)).toEqual(["Good one", "Another good one"]);
  });
});
