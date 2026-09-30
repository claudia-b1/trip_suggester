import { describe, it, expect } from "vitest";

/**
 * The prescan's "should I refetch this cached google-meta entry?" rule.
 *
 * Mirrors the condition in `recommendations/route.ts`. It lives in a test
 * because getting it wrong is expensive and silent — each wrong `true` is an
 * extra paid Google Text Search on every discover run, and this condition has
 * already been wrong twice in opposite directions:
 *
 *   1. `!primaryType` alone → refetched forever, since Google legitimately
 *      omits primaryType and the refetch never produced one either.
 *   2. `_schemaVersion < CURRENT` alone → refetched every pre-versioning entry,
 *      including the ~85% that already had primaryType and gained nothing,
 *      roughly doubling Google calls and pushing runs past the 60s function
 *      limit.
 */
type CachedMeta = { primaryType?: string; _schemaVersion?: number } | null;

function needsRefetch(meta: CachedMeta, currentVersion: number): boolean {
  if (meta == null) return false;
  return meta._schemaVersion == null
    ? !meta.primaryType
    : meta._schemaVersion < currentVersion;
}

const CURRENT = 2;

describe("google-meta cache refetch rule", () => {
  it("leaves a legacy entry that already has primaryType alone", () => {
    // The regression that made discover slow enough to time out.
    expect(needsRefetch({ primaryType: "museum" }, CURRENT)).toBe(false);
  });

  it("refetches a legacy entry missing primaryType, exactly once", () => {
    const legacy = { primaryType: undefined };
    expect(needsRefetch(legacy, CURRENT)).toBe(true);

    // After the refetch the entry is stamped, even if Google still returned no
    // primaryType — so it must not come back for another round.
    const afterRefetch = { primaryType: undefined, _schemaVersion: CURRENT };
    expect(needsRefetch(afterRefetch, CURRENT)).toBe(false);
  });

  it("leaves a current stamped entry alone", () => {
    expect(needsRefetch({ primaryType: "cafe", _schemaVersion: CURRENT }, CURRENT)).toBe(false);
    expect(needsRefetch({ _schemaVersion: CURRENT }, CURRENT)).toBe(false);
  });

  it("refetches when the field mask version moved ahead", () => {
    // e.g. GOOGLE_PLACES_RICH_SUMMARY flipped on: v2 entries lack the summary.
    expect(needsRefetch({ primaryType: "museum", _schemaVersion: 2 }, 3)).toBe(true);
  });

  it("accepts a newer entry than the current version", () => {
    // Rich (v3) data is a superset, so a lean (v2) run must not discard it.
    expect(needsRefetch({ primaryType: "museum", _schemaVersion: 3 }, 2)).toBe(false);
  });

  it("never refetches a cached null", () => {
    // Null caching has its own shorter TTL; this path must not touch it.
    expect(needsRefetch(null, CURRENT)).toBe(false);
  });
});
