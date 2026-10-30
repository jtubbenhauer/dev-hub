import { describe, expect, it } from "vitest";
import { createRecentIdSet } from "@/lib/attention/recent-id-set";

describe("createRecentIdSet", () => {
  it("returns true on first add and false on repeat add", () => {
    const recentIds = createRecentIdSet(3);

    expect(recentIds.add("a")).toBe(true);
    expect(recentIds.add("a")).toBe(false);
    expect(recentIds.has("a")).toBe(true);
  });

  it("evicts the oldest id when capacity is exceeded", () => {
    const recentIds = createRecentIdSet(3);
    recentIds.add("a");
    recentIds.add("b");
    recentIds.add("c");

    expect(recentIds.add("d")).toBe(true);

    expect(recentIds.has("a")).toBe(false);
    expect(recentIds.has("b")).toBe(true);
    expect(recentIds.has("c")).toBe(true);
    expect(recentIds.has("d")).toBe(true);
  });

  it("allows an evicted id to be added again", () => {
    const recentIds = createRecentIdSet(1);
    recentIds.add("a");
    recentIds.add("b");

    expect(recentIds.add("a")).toBe(true);
  });

  it("forgets all ids after clear", () => {
    const recentIds = createRecentIdSet(3);
    recentIds.add("a");

    recentIds.clear();

    expect(recentIds.has("a")).toBe(false);
    expect(recentIds.add("a")).toBe(true);
  });
});
