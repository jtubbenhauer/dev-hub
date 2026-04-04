import { describe, it, expect } from "vitest";
import {
  parsePrReferences,
  isPrTrigger,
  formatPrContext,
} from "@/lib/pr-mention";

describe("parsePrReferences", () => {
  it("matches a PR reference at start of string", () => {
    const refs = parsePrReferences("#123");
    expect(refs).toHaveLength(1);
    expect(refs[0].number).toBe(123);
  });

  it("matches a PR reference preceded by space", () => {
    const refs = parsePrReferences("check #456 please");
    expect(refs).toHaveLength(1);
    expect(refs[0].number).toBe(456);
  });

  it("matches multiple PR references", () => {
    const refs = parsePrReferences("see #1 and #2");
    expect(refs).toHaveLength(2);
    expect(refs[0].number).toBe(1);
    expect(refs[1].number).toBe(2);
  });

  it("does NOT match markdown heading (# heading)", () => {
    const refs = parsePrReferences("# heading");
    expect(refs).toHaveLength(0);
  });

  it("does NOT match markdown subheading (## subheading)", () => {
    const refs = parsePrReferences("## subheading");
    expect(refs).toHaveLength(0);
  });

  it("does NOT match non-numeric reference (#notanumber)", () => {
    const refs = parsePrReferences("#notanumber");
    expect(refs).toHaveLength(0);
  });

  it("does NOT match when hash has no preceding whitespace (foo#bar)", () => {
    const refs = parsePrReferences("foo#123");
    expect(refs).toHaveLength(0);
  });

  it("returns correct startIndex and endIndex for the #123 part", () => {
    const refs = parsePrReferences("check #456 please");
    expect(refs[0].startIndex).toBe(6); // index of '#' in "check #456 please"
    expect(refs[0].endIndex).toBe(10); // index after '6'
  });

  it("returns correct startIndex for reference at start of string", () => {
    const refs = parsePrReferences("#99");
    expect(refs[0].startIndex).toBe(0);
    expect(refs[0].endIndex).toBe(3);
  });

  it("returns empty array for empty string", () => {
    expect(parsePrReferences("")).toHaveLength(0);
  });

  it("matches PR reference with large number", () => {
    const refs = parsePrReferences("fixes #10042");
    expect(refs).toHaveLength(1);
    expect(refs[0].number).toBe(10042);
  });
});

describe("isPrTrigger", () => {
  it("returns triggered=true for text ending with # after space", () => {
    expect(isPrTrigger("hello #")).toEqual({ triggered: true, query: "" });
  });

  it("returns triggered=true for text ending with #digits after space", () => {
    expect(isPrTrigger("hello #12")).toEqual({ triggered: true, query: "12" });
  });

  it("returns triggered=true for # at start of text", () => {
    expect(isPrTrigger("#")).toEqual({ triggered: true, query: "" });
  });

  it("returns triggered=true for #digits at start of text", () => {
    expect(isPrTrigger("#5")).toEqual({ triggered: true, query: "5" });
  });

  it("returns triggered=false for # heading (space after hash)", () => {
    expect(isPrTrigger("# heading")).toEqual({ triggered: false, query: "" });
  });

  it("returns triggered=false when text has no # at end", () => {
    expect(isPrTrigger("hello")).toEqual({ triggered: false, query: "" });
  });

  it("returns triggered=false for non-numeric after # (#abc)", () => {
    expect(isPrTrigger("hello #abc")).toEqual({ triggered: false, query: "" });
  });

  it("returns triggered=false for ## heading", () => {
    expect(isPrTrigger("## heading")).toEqual({ triggered: false, query: "" });
  });

  it("returns triggered=false when # is not preceded by whitespace or start", () => {
    expect(isPrTrigger("foo#")).toEqual({ triggered: false, query: "" });
  });

  it("returns triggered=true with multi-digit query", () => {
    expect(isPrTrigger("fix #1234")).toEqual({
      triggered: true,
      query: "1234",
    });
  });
});

describe("formatPrContext", () => {
  const basePr = {
    number: 42,
    title: "Add feature X",
    state: "open",
    draft: false,
    user: { login: "alice" },
    head: { ref: "feature/x" },
    base: { ref: "main" },
    merge_commit_sha: null,
  };

  it("includes PR number in output", () => {
    const output = formatPrContext(basePr);
    expect(output).toContain("42");
  });

  it("includes PR title in output", () => {
    const output = formatPrContext(basePr);
    expect(output).toContain("Add feature X");
  });

  it("includes author login in output", () => {
    const output = formatPrContext(basePr);
    expect(output).toContain("alice");
  });

  it("includes branch info in output", () => {
    const output = formatPrContext(basePr);
    expect(output).toContain("feature/x");
    expect(output).toContain("main");
  });

  it("shows 'open' status for open non-draft PR", () => {
    const output = formatPrContext(basePr);
    expect(output).toContain("open");
  });

  it("shows 'draft' status for draft PR", () => {
    const draftPr = { ...basePr, draft: true };
    const output = formatPrContext(draftPr);
    expect(output).toContain("draft");
  });

  it("shows 'merged' status when merge_commit_sha is set", () => {
    const mergedPr = {
      ...basePr,
      state: "closed" as const,
      merge_commit_sha: "abc123",
    };
    const output = formatPrContext(mergedPr);
    expect(output).toContain("merged");
  });

  it("shows 'closed' status for closed non-merged PR", () => {
    const closedPr = { ...basePr, state: "closed" as const };
    const output = formatPrContext(closedPr);
    expect(output).toContain("closed");
  });

  it("includes diff when provided and under 50KB", () => {
    const smallDiff = "diff --git a/file.ts b/file.ts\n+added line";
    const output = formatPrContext(basePr, smallDiff);
    expect(output).toContain(smallDiff);
  });

  it("truncates diff at 50KB and appends [truncated] marker", () => {
    const largeDiff = "x".repeat(50 * 1024 + 1);
    const output = formatPrContext(basePr, largeDiff);
    expect(output).toContain("[truncated]");
    // Verify the full diff is NOT included
    expect(output.length).toBeLessThan(largeDiff.length + 500);
  });

  it("does not include diff section when no diff provided", () => {
    const output = formatPrContext(basePr);
    expect(output).not.toContain("[truncated]");
  });
});
