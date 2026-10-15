import { describe, expect, it } from "vitest";
import type { GitIgnoreCheck } from "@/packages/shared/src/content-search/ignored-paths";
import {
  collectWithIgnoreRounds,
  type RipgrepPassResult,
} from "@/packages/shared/src/content-search/ripgrep-rounds";
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

function makeFile(path: string): ContentSearchFile {
  return { path, matches: [makeMatch(1)] };
}

function cappedPass(paths: readonly string[]): RipgrepPassResult {
  return {
    kind: "collected",
    results: {
      files: paths.map(makeFile),
      isLimitHit: true,
      isTimedOut: false,
    },
  };
}

function ignored(paths: readonly string[]): GitIgnoreCheck {
  return { kind: "ignored", paths: new Set(paths) };
}

describe("collectWithIgnoreRounds", () => {
  it("does not start another pass when the budget ran out after the previous round", async () => {
    let remainingMs = 10_000;
    const passExclusions: (readonly string[])[] = [];

    const result = await collectWithIgnoreRounds({
      getRemainingMs: () => remainingMs,
      runPass: (excludedPaths) => {
        passExclusions.push(excludedPaths);
        return Promise.resolve(cappedPass(["eligible.ts", "x.generated.ts"]));
      },
      checkIgnoredPaths: () => {
        // The check answers, but uses up the rest of the search budget.
        remainingMs = 0;
        return Promise.resolve(ignored(["x.generated.ts"]));
      },
    });

    expect(passExclusions).toEqual([[]]);
    expect(result).toEqual({
      kind: "collected",
      results: {
        files: [makeFile("eligible.ts")],
        isLimitHit: true,
        isTimedOut: true,
      },
    });
  });

  it("does not start another pass when the exclusions would exceed the argv bound", async () => {
    const longIgnoredPaths = Array.from(
      { length: 300 },
      (_, index) => `${"d".repeat(250)}/${index}.generated.ts`,
    );
    let passCount = 0;

    const result = await collectWithIgnoreRounds({
      getRemainingMs: () => 10_000,
      runPass: () => {
        passCount += 1;
        return Promise.resolve(
          cappedPass(["eligible.ts", ...longIgnoredPaths]),
        );
      },
      checkIgnoredPaths: () => Promise.resolve(ignored(longIgnoredPaths)),
    });

    expect(passCount).toBe(1);
    expect(result).toEqual({
      kind: "collected",
      results: {
        files: [makeFile("eligible.ts")],
        isLimitHit: true,
        isTimedOut: false,
      },
    });
  });

  it("re-runs with the ignored paths excluded while they fit the bound", async () => {
    const passExclusions: (readonly string[])[] = [];

    const result = await collectWithIgnoreRounds({
      getRemainingMs: () => 10_000,
      runPass: (excludedPaths) => {
        passExclusions.push(excludedPaths);
        return Promise.resolve(
          excludedPaths.length === 0
            ? cappedPass(["x.generated.ts"])
            : cappedPass(["eligible.ts"]),
        );
      },
      checkIgnoredPaths: (paths) =>
        Promise.resolve(
          ignored(paths.filter((path) => path.endsWith(".generated.ts"))),
        ),
    });

    expect(passExclusions).toEqual([[], ["x.generated.ts"]]);
    expect(result.kind === "collected" && result.results.files).toEqual([
      makeFile("eligible.ts"),
    ]);
  });
});
