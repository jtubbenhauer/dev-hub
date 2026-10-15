import { describe, expect, it } from "vitest";
import {
  EMPTY_IGNORE_ROUND_STATE,
  MAX_EXCLUSION_ARGV_BYTES,
  MAX_EXCLUSION_ARG_BYTES,
  MAX_IGNORE_ROUNDS,
  buildExclusionGlobArg,
  countMatches,
  decideAfterRound,
  findUncheckedPaths,
  keepVerifiedFiles,
  measureExclusionArgvBytes,
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

describe("measureExclusionArgvBytes", () => {
  it("sums the UTF-8 bytes of each exclusion argument plus its terminator", () => {
    // "--glob=!/a" is 10 bytes; "--glob=!/ñ" is 11 (ñ is 2 bytes).
    expect(measureExclusionArgvBytes(["a", "ñ"])).toBe(11 + 12);
  });

  it("measures the escaped glob, not the raw path", () => {
    expect(buildExclusionGlobArg("a b")).toBe("--glob=!/a\\ b");
    expect(measureExclusionArgvBytes(["a b"])).toBe(14);
  });

  it("treats a single argument over the per-argument limit as unbounded", () => {
    const longPath = "x".repeat(MAX_EXCLUSION_ARG_BYTES);

    expect(measureExclusionArgvBytes(["a", longPath])).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("is zero without exclusions", () => {
    expect(measureExclusionArgvBytes([])).toBe(0);
  });
});

describe("decideAfterRound", () => {
  const BASE_INPUT = {
    pass: CAPPED_PASS,
    newIgnoredCount: 1,
    round: 1,
    exclusionArgvBytes: 100,
  };

  it("is done when the pass was not cut by the cap", () => {
    expect(
      decideAfterRound({
        ...BASE_INPUT,
        pass: { ...CAPPED_PASS, isLimitHit: false },
      }),
    ).toBe("done");
  });

  it("is done when a capped pass found no new ignored files", () => {
    expect(decideAfterRound({ ...BASE_INPUT, newIgnoredCount: 0 })).toBe(
      "done",
    );
  });

  it("is done when the pass itself timed out", () => {
    expect(
      decideAfterRound({
        ...BASE_INPUT,
        pass: { ...CAPPED_PASS, isTimedOut: true },
      }),
    ).toBe("done");
  });

  it("runs another round when ignored files used up the cap", () => {
    expect(decideAfterRound(BASE_INPUT)).toBe("next-round");
  });

  it("runs another round when the exclusions are exactly at the byte bound", () => {
    expect(
      decideAfterRound({
        ...BASE_INPUT,
        exclusionArgvBytes: MAX_EXCLUSION_ARGV_BYTES,
      }),
    ).toBe("next-round");
  });

  it("stops after the last allowed round", () => {
    expect(decideAfterRound({ ...BASE_INPUT, round: MAX_IGNORE_ROUNDS })).toBe(
      "rounds-exhausted",
    );
  });

  it("stops when the accumulated exclusions exceed the argv byte bound", () => {
    expect(
      decideAfterRound({
        ...BASE_INPUT,
        exclusionArgvBytes: MAX_EXCLUSION_ARGV_BYTES + 1,
      }),
    ).toBe("exclusions-too-large");
  });
});
