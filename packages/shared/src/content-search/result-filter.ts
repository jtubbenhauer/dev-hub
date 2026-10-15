import type { GitIgnoreCheck } from "./ignored-paths";
import { CONTENT_SEARCH_MAX_RESULTS_LIMIT } from "./params";
import type { ContentSearchFile, ContentSearchQuery } from "./types";

// Pure post-processing for engine results: drop git-ignored files, trim to
// maxResults, recount. Not exported from the @devhub/shared barrel.

// rg include globs override .gitignore, so ignored matches are collected and
// dropped afterwards; the headroom keeps them from using up maxResults.
const INCLUDE_GLOB_HEADROOM_FACTOR = 2;

export function internalMaxResults(query: ContentSearchQuery): number {
  if (query.includeGlobs.length === 0) return query.maxResults;
  return Math.min(
    query.maxResults * INCLUDE_GLOB_HEADROOM_FACTOR,
    CONTENT_SEARCH_MAX_RESULTS_LIMIT * INCLUDE_GLOB_HEADROOM_FACTOR,
  );
}

export interface RawSearchResults {
  // Sorted by path, matches by line/column.
  readonly files: readonly ContentSearchFile[];
  // The engine stopped at its internal cap.
  readonly isLimitHit: boolean;
  readonly isTimedOut: boolean;
}

export interface FinalizeSearchResultsInput {
  readonly raw: RawSearchResults;
  // null: no ignore check was needed.
  readonly ignoreCheck: GitIgnoreCheck | null;
  readonly maxResults: number;
}

export type FinalizedSearchResults =
  | {
      readonly kind: "results";
      readonly files: readonly ContentSearchFile[];
      readonly matchCount: number;
      readonly fileCount: number;
      readonly isLimitHit: boolean;
      readonly isTimedOut: boolean;
    }
  | { readonly kind: "aborted" };

interface TrimmedFiles {
  readonly files: readonly ContentSearchFile[];
  readonly isTrimmed: boolean;
}

function countMatches(files: readonly ContentSearchFile[]): number {
  return files.reduce((total, file) => total + file.matches.length, 0);
}

// Keeps the first maxResults matches in sorted order; drops emptied files.
function trimToMaxResults(
  files: readonly ContentSearchFile[],
  maxResults: number,
): TrimmedFiles {
  if (countMatches(files) <= maxResults) return { files, isTrimmed: false };
  const trimmedFiles: ContentSearchFile[] = [];
  let remaining = maxResults;
  for (const file of files) {
    if (remaining === 0) break;
    const matches = file.matches.slice(0, remaining);
    trimmedFiles.push({ path: file.path, matches });
    remaining -= matches.length;
  }
  return { files: trimmedFiles, isTrimmed: true };
}

export function finalizeSearchResults(
  input: FinalizeSearchResultsInput,
): FinalizedSearchResults {
  const { raw, ignoreCheck, maxResults } = input;
  let keptFiles = raw.files;
  let isTimedOut = raw.isTimedOut;
  switch (ignoreCheck?.kind) {
    case undefined:
    case "not-a-repository":
    case "unavailable":
      // Outside a repository rg doesn't apply .gitignore either.
      break;
    case "ignored": {
      const ignoredPaths = ignoreCheck.paths;
      keptFiles = raw.files.filter((file) => !ignoredPaths.has(file.path));
      break;
    }
    case "timed-out":
      // Unverified results: flag them so the UI reports partial results.
      isTimedOut = true;
      break;
    case "aborted":
      return { kind: "aborted" };
    default: {
      const unreachable: never = ignoreCheck;
      return unreachable;
    }
  }
  const trimmed = trimToMaxResults(keptFiles, maxResults);
  return {
    kind: "results",
    files: trimmed.files,
    matchCount: countMatches(trimmed.files),
    fileCount: trimmed.files.length,
    isLimitHit: raw.isLimitHit || trimmed.isTrimmed,
    isTimedOut,
  };
}
