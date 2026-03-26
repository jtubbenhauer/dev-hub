import { describe, it, expect } from "vitest";
import { parseDiffHunkLines } from "@/lib/github-diff";

describe("parseDiffHunkLines", () => {
  it("returns empty set for undefined patch", () => {
    expect(parseDiffHunkLines(undefined)).toEqual(new Set());
  });

  it("returns empty set for empty string", () => {
    expect(parseDiffHunkLines("")).toEqual(new Set());
  });

  it("parses a single hunk with additions and context", () => {
    const patch = [
      "@@ -10,4 +10,5 @@ function foo() {",
      "   const a = 1;",
      "   const b = 2;",
      "+  const c = 3;",
      "   return a + b;",
      " }",
    ].join("\n");

    const result = parseDiffHunkLines(patch);
    expect(result).toEqual(new Set([10, 11, 12, 13, 14]));
  });

  it("parses multiple hunks", () => {
    const patch = [
      "@@ -1,3 +1,3 @@ header1",
      " line1",
      "-old",
      "+new",
      " line3",
      "@@ -20,2 +20,3 @@ header2",
      " existing",
      "+added1",
      "+added2",
    ].join("\n");

    const result = parseDiffHunkLines(patch);
    expect(result).toEqual(new Set([1, 2, 3, 20, 21, 22]));
  });

  it("handles additions-only hunk (new file)", () => {
    const patch = ["@@ -0,0 +1,3 @@", "+line1", "+line2", "+line3"].join("\n");

    const result = parseDiffHunkLines(patch);
    expect(result).toEqual(new Set([1, 2, 3]));
  });

  it("handles deletions-only hunk", () => {
    const patch = [
      "@@ -1,3 +1,0 @@",
      "-deleted1",
      "-deleted2",
      "-deleted3",
    ].join("\n");

    const result = parseDiffHunkLines(patch);
    expect(result).toEqual(new Set([1]));
  });

  it("skips deletion lines and does not increment modified line counter", () => {
    const patch = [
      "@@ -5,5 +5,3 @@ context",
      " keep1",
      "-removed1",
      "-removed2",
      " keep2",
      " keep3",
    ].join("\n");

    const result = parseDiffHunkLines(patch);
    expect(result).toEqual(new Set([5, 6, 7]));
  });

  it("handles hunk with count of 1 (implicit)", () => {
    const patch = ["@@ -10,1 +10 @@", " unchanged"].join("\n");

    const result = parseDiffHunkLines(patch);
    expect(result).toEqual(new Set([10]));
  });

  it("identifies lines outside hunks correctly", () => {
    const patch = [
      "@@ -10,3 +10,3 @@ function foo() {",
      "   const a = 1;",
      "-  const b = 2;",
      "+  const b = 3;",
      "   return a;",
    ].join("\n");

    const result = parseDiffHunkLines(patch);
    expect(result.has(10)).toBe(true);
    expect(result.has(11)).toBe(true);
    expect(result.has(12)).toBe(true);
    expect(result.has(1)).toBe(false);
    expect(result.has(9)).toBe(false);
    expect(result.has(13)).toBe(false);
    expect(result.has(100)).toBe(false);
  });
});
