import { describe, it, expect, beforeAll } from "vitest";
import { serializeSession, parseSession } from "@/lib/session";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-session-signing";
});

describe("session cookie signing", () => {
  it("round-trips a user id", () => {
    expect(parseSession(serializeSession(42))).toBe(42);
  });

  it("rejects the old unsigned format", () => {
    // The whole point: `active-user-id=3` used to be enough.
    expect(parseSession("3")).toBeNull();
    expect(parseSession("42")).toBeNull();
  });

  it("rejects a forged id with no signature", () => {
    expect(parseSession("999.")).toBeNull();
    expect(parseSession("999.notasignature")).toBeNull();
  });

  it("rejects a valid signature reused for a different id", () => {
    // Swapping the id while keeping someone else's signature must not work.
    const signature = serializeSession(1).split(".")[1];
    expect(parseSession(`2.${signature}`)).toBeNull();
  });

  it("rejects a tampered signature of the right length", () => {
    const token = serializeSession(7);
    const [id, sig] = token.split(".");
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(parseSession(`${id}.${flipped}`)).toBeNull();
  });

  it("rejects malformed and empty values", () => {
    expect(parseSession(undefined)).toBeNull();
    expect(parseSession("")).toBeNull();
    expect(parseSession(".")).toBeNull();
    expect(parseSession(".abc")).toBeNull();
    expect(parseSession("abc.def")).toBeNull();
  });

  it("rejects non-positive and non-integer ids", () => {
    expect(parseSession(serializeSession(0))).toBeNull();
    expect(parseSession(serializeSession(-1))).toBeNull();
    expect(parseSession("1.5." + serializeSession(1).split(".")[1])).toBeNull();
  });

  it("produces a different signature per id", () => {
    const a = serializeSession(1).split(".")[1];
    const b = serializeSession(2).split(".")[1];
    expect(a).not.toBe(b);
  });
});
