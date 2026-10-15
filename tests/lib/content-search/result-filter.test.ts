import { describe, expect, it } from "vitest";
import {
  finalizeSearchResults,
  internalMaxResults,
} from "@/packages/shared/src/content-search/result-filter";
import type {
  ContentSearchFile,
  ContentSearchMatch,
  ContentSearchQuery,
} from "@/packages/shared/src/content-search/types";

const BASE_QUERY: ContentSearchQuery = {
  pattern: "x",
  isRegex: false,
  isCaseSensitive: false,
  isWholeWord: false,
  includeGlobs: [],
  excludeGlobs: [],
  maxResults: 100,
};

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

function shape(files: readonly ContentSearchFile[]): [string, number][] {
  return files.map((file) => [file.path, file.matches.length]);
}

describe("internalMaxResults", () => {
  it("equals maxResults without include globs", () => {
    expect(internalMaxResults({ ...BASE_QUERY, maxResults: 300 })).toBe(300);
  });

  it("doubles maxResults with include globs", () => {
    expect(
      internalMaxResults({
        ...BASE_QUERY,
        maxResults: 300,
        includeGlobs: ["*.ts"],
      }),
    ).toBe(600);
  });

  it("caps the doubled value at twice the request limit", () => {
    expect(
      internalMaxResults({
        ...BASE_QUERY,
        maxResults: 9000,
        includeGlobs: ["*.ts"],
      }),
    ).toBe(10_000);
  });
});

describe("finalizeSearchResults", () => {
  const raw = { files: FILES, isLimitHit: false, isTimedOut: false };

  it("keeps everything when no ignore check ran and the cap is not exceeded", () => {
    const finalized = finalizeSearchResults({
      raw,
      ignoreCheck: null,
      maxResults: 100,
    });

    expect(finalized).toMatchObject({
      kind: "results",
      matchCount: 9,
      fileCount: 3,
      isLimitHit: false,
      isTimedOut: false,
    });
  });

  it("drops ignored files before trimming, so ignored matches do not use the cap", () => {
    const finalized = finalizeSearchResults({
      raw,
      ignoreCheck: { kind: "ignored", paths: new Set(["a.generated.ts"]) },
      maxResults: 5,
    });

    if (finalized.kind !== "results") throw new Error("expected results");
    expect(shape(finalized.files)).toEqual([
      ["b.ts", 2],
      ["c.ts", 3],
    ]);
    expect(finalized.matchCount).toBe(5);
    expect(finalized.isLimitHit).toBe(false);
  });

  it("trims from the end of the sorted order and reports the limit", () => {
    const finalized = finalizeSearchResults({
      raw,
      ignoreCheck: { kind: "ignored", paths: new Set(["a.generated.ts"]) },
      maxResults: 3,
    });

    if (finalized.kind !== "results") throw new Error("expected results");
    expect(shape(finalized.files)).toEqual([
      ["b.ts", 2],
      ["c.ts", 1],
    ]);
    expect(finalized.files[1]?.matches[0]?.lineNumber).toBe(1);
    expect(finalized.matchCount).toBe(3);
    expect(finalized.fileCount).toBe(2);
    expect(finalized.isLimitHit).toBe(true);
  });

  it("drops files left empty by trimming", () => {
    const finalized = finalizeSearchResults({
      raw,
      ignoreCheck: null,
      maxResults: 4,
    });

    if (finalized.kind !== "results") throw new Error("expected results");
    expect(shape(finalized.files)).toEqual([["a.generated.ts", 4]]);
    expect(finalized.fileCount).toBe(1);
  });

  it("keeps the limit flag when the internal cap was hit even without trimming", () => {
    const finalized = finalizeSearchResults({
      raw: { ...raw, isLimitHit: true },
      ignoreCheck: { kind: "ignored", paths: new Set(["a.generated.ts"]) },
      maxResults: 100,
    });

    expect(finalized).toMatchObject({ matchCount: 5, isLimitHit: true });
  });

  it.each(["not-a-repository", "unavailable"] as const)(
    "keeps results unfiltered when git reports %s",
    (kind) => {
      const finalized = finalizeSearchResults({
        raw,
        ignoreCheck: { kind },
        maxResults: 100,
      });

      expect(finalized).toMatchObject({
        kind: "results",
        matchCount: 9,
        isTimedOut: false,
      });
    },
  );

  it("keeps results unfiltered but marks them timed out when the check timed out", () => {
    const finalized = finalizeSearchResults({
      raw,
      ignoreCheck: { kind: "timed-out" },
      maxResults: 100,
    });

    expect(finalized).toMatchObject({
      kind: "results",
      matchCount: 9,
      fileCount: 3,
      isTimedOut: true,
    });
  });

  it("reports aborted when the check was aborted", () => {
    const finalized = finalizeSearchResults({
      raw,
      ignoreCheck: { kind: "aborted" },
      maxResults: 100,
    });

    expect(finalized).toEqual({ kind: "aborted" });
  });
});
