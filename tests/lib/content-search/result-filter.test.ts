import { describe, expect, it } from "vitest";
import {
  EMPTY_IGNORE_ROUND_STATE,
  MAX_IGNORE_ROUNDS,
  countMatches,
  decideAfterRound,
  findUncheckedPaths,
  keepVerifiedFiles,
  recordIgnoreCheck,
} from "@/packages/shared/src/content-search/result-filter";
import type {
  ContentSearchFile,
  ContentSearchMatch,
} from "@/packages/shared/src/content-search/types";

function makeMatch(lineNumber: number): ContentSearchMatch {
  return {
    lineNumber,
    startColumn: 1,
    endColumn: 2,
    startByteColumn: 1,
    matchFingerprint: "x",
    lineSha256: "0".repeat(64),
    preview: "x",
    previewMatchStart: 0,
    previewMatchEnd: 1,
  };
}

function makeFile(path: string, matchCount: number): ContentSearchFile {
  return {
    path,
    matches: Array.from({ length: matchCount }, (_, index) =>
      makeMatch(index + 1),
    ),
  };
}

const FILES: readonly ContentSearchFile[] = [
  makeFile("a.generated.ts", 4),
  makeFile("b.ts", 2),
  makeFile("c.ts", 3),
];

const CAPPED_PASS = { files: FILES, isLimitHit: true, isTimedOut: false };

describe("ignore round state", () => {
  it("treats every path as unchecked at the start", () => {
    expect(findUncheckedPaths(FILES, EMPTY_IGNORE_ROUND_STATE)).toEqual([
      "a.generated.ts",
      "b.ts",
      "c.ts",
    ]);
  });

  it("records ignored and verified paths from a check", () => {
    const state = recordIgnoreCheck({
      state: EMPTY_IGNORE_ROUND_STATE,
      checkedPaths: ["a.generated.ts", "b.ts"],
      ignoredPaths: new Set(["a.generated.ts"]),
    });

    expect([...state.ignoredPaths]).toEqual(["a.generated.ts"]);
    expect([...state.verifiedPaths]).toEqual(["b.ts"]);
    expect(findUncheckedPaths(FILES, state)).toEqual(["c.ts"]);
  });

  it("keeps only verified files, so unchecked and ignored files are never exposed", () => {
    const state = recordIgnoreCheck({
      state: EMPTY_IGNORE_ROUND_STATE,
      checkedPaths: ["a.generated.ts", "b.ts"],
      ignoredPaths: new Set(["a.generated.ts"]),
    });

    expect(keepVerifiedFiles(FILES, state).map((file) => file.path)).toEqual([
      "b.ts",
    ]);
  });

  it("returns no files before anything was verified", () => {
    expect(keepVerifiedFiles(FILES, EMPTY_IGNORE_ROUND_STATE)).toEqual([]);
  });

  it("counts matches across files", () => {
    expect(countMatches(FILES)).toBe(9);
  });
});

describe("decideAfterRound", () => {
  it("is done when the pass was not cut by the cap", () => {
    expect(
      decideAfterRound({
        pass: { ...CAPPED_PASS, isLimitHit: false },
        newIgnoredCount: 2,
        round: 1,
        remainingMs: 1000,
      }),
    ).toBe("done");
  });

  it("is done when a capped pass found no new ignored files", () => {
    expect(
      decideAfterRound({
        pass: CAPPED_PASS,
        newIgnoredCount: 0,
        round: 1,
        remainingMs: 1000,
      }),
    ).toBe("done");
  });

  it("is done when the pass itself timed out", () => {
    expect(
      decideAfterRound({
        pass: { ...CAPPED_PASS, isTimedOut: true },
        newIgnoredCount: 1,
        round: 1,
        remainingMs: 1000,
      }),
    ).toBe("done");
  });

  it("runs another round when ignored files used up the cap", () => {
    expect(
      decideAfterRound({
        pass: CAPPED_PASS,
        newIgnoredCount: 1,
        round: 1,
        remainingMs: 1000,
      }),
    ).toBe("next-round");
  });

  it("stops after the last allowed round", () => {
    expect(
      decideAfterRound({
        pass: CAPPED_PASS,
        newIgnoredCount: 1,
        round: MAX_IGNORE_ROUNDS,
        remainingMs: 1000,
      }),
    ).toBe("rounds-exhausted");
  });

  it("stops when no time is left for another round", () => {
    expect(
      decideAfterRound({
        pass: CAPPED_PASS,
        newIgnoredCount: 1,
        round: 1,
        remainingMs: 0,
      }),
    ).toBe("out-of-time");
  });
});
