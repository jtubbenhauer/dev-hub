import { describe, it, expect } from "vitest";
import {
  filterSessionsByAge,
  getSessionAgeCutoff,
  parseSessionAgeFilter,
  type SessionAgeFilter,
} from "@/lib/session-filters";

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeSession(id: string, ageHours: number) {
  return { id, time: { updated: NOW - ageHours * HOUR } };
}

describe("parseSessionAgeFilter", () => {
  it("returns the value when valid", () => {
    expect(parseSessionAgeFilter("1d")).toBe("1d");
    expect(parseSessionAgeFilter("1w")).toBe("1w");
    expect(parseSessionAgeFilter("all")).toBe("all");
  });

  it("defaults to 'all' for null or invalid values", () => {
    expect(parseSessionAgeFilter(null)).toBe("all");
    expect(parseSessionAgeFilter("")).toBe("all");
    expect(parseSessionAgeFilter("garbage")).toBe("all");
    expect(parseSessionAgeFilter("2d")).toBe("all");
  });
});

describe("getSessionAgeCutoff", () => {
  it("returns null for 'all'", () => {
    expect(getSessionAgeCutoff("all", NOW)).toBeNull();
  });

  it("returns 24h ago for '1d'", () => {
    expect(getSessionAgeCutoff("1d", NOW)).toBe(NOW - DAY);
  });

  it("returns 7 days ago for '1w'", () => {
    expect(getSessionAgeCutoff("1w", NOW)).toBe(NOW - 7 * DAY);
  });
});

describe("filterSessionsByAge", () => {
  const sessions = [
    makeSession("recent", 1),
    makeSession("yesterday", 23),
    makeSession("two-days", 48),
    makeSession("last-week", 6 * 24),
    makeSession("old", 30 * 24),
  ];

  it("returns all sessions when filter is 'all'", () => {
    const result = filterSessionsByAge(sessions, "all", undefined, NOW);
    expect(result.map((s) => s.id)).toEqual([
      "recent",
      "yesterday",
      "two-days",
      "last-week",
      "old",
    ]);
  });

  it("keeps only sessions within the last day for '1d'", () => {
    const result = filterSessionsByAge(sessions, "1d", undefined, NOW);
    expect(result.map((s) => s.id)).toEqual(["recent", "yesterday"]);
  });

  it("keeps only sessions within the last week for '1w'", () => {
    const result = filterSessionsByAge(sessions, "1w", undefined, NOW);
    expect(result.map((s) => s.id)).toEqual([
      "recent",
      "yesterday",
      "two-days",
      "last-week",
    ]);
  });

  it("preserves pinned sessions even when they fall outside the window", () => {
    const pinned = new Set(["old"]);
    const result = filterSessionsByAge(sessions, "1d", pinned, NOW);
    expect(result.map((s) => s.id)).toEqual(["recent", "yesterday", "old"]);
  });

  it("does not mutate the input array", () => {
    const input = [...sessions];
    filterSessionsByAge(input, "1d", undefined, NOW);
    expect(input.map((s) => s.id)).toEqual([
      "recent",
      "yesterday",
      "two-days",
      "last-week",
      "old",
    ]);
  });

  it("returns a fresh array copy when filter is 'all'", () => {
    const result = filterSessionsByAge(sessions, "all", undefined, NOW);
    expect(result).not.toBe(sessions);
  });

  it("respects the boundary exactly at the cutoff", () => {
    const filter: SessionAgeFilter = "1d";
    const exactlyAtCutoff = { id: "boundary", time: { updated: NOW - DAY } };
    const justBeforeCutoff = {
      id: "outside",
      time: { updated: NOW - DAY - 1 },
    };
    const result = filterSessionsByAge(
      [exactlyAtCutoff, justBeforeCutoff],
      filter,
      undefined,
      NOW,
    );
    expect(result.map((s) => s.id)).toEqual(["boundary"]);
  });
});
