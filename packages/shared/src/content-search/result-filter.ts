import { escapeGlobLiteral } from "./glob-escape";
import type { ContentSearchFile } from "./types";

// Pure bookkeeping for the include-glob ignore rounds: which matched paths git
// has said are ignored or verified, and whether to run rg again. No Node
// imports; not exported from the @devhub/shared barrel.

// rg include globs override .gitignore, so ignored files can fill the cap; each
// extra round re-runs rg with the ignored files found so far excluded.
export const MAX_IGNORE_ROUNDS = 4;
// Re-runs pass one --glob per ignored path; bound their total argv size well
// below ARG_MAX (1 MiB on macOS, often 2 MiB on Linux) to never hit E2BIG.
export const MAX_EXCLUSION_ARGV_BYTES = 64 * 1024;
export const MAX_EXCLUSION_ARG_BYTES = 4096;

const utf8Encoder = new TextEncoder();

export interface CollectedSearchResults {
  // Sorted by path, matches by line/column.
  readonly files: readonly ContentSearchFile[];
  readonly isLimitHit: boolean;
  readonly isTimedOut: boolean;
}

export interface IgnoreRoundState {
  // Insertion-ordered, so re-run args are stable.
  readonly ignoredPaths: ReadonlySet<string>;
  // Checked by git and not ignored.
  readonly verifiedPaths: ReadonlySet<string>;
}

export const EMPTY_IGNORE_ROUND_STATE: IgnoreRoundState = {
  ignoredPaths: new Set(),
  verifiedPaths: new Set(),
};

export interface RecordIgnoreCheckInput {
  readonly state: IgnoreRoundState;
  readonly checkedPaths: readonly string[];
  readonly ignoredPaths: ReadonlySet<string>;
}

export type RoundDecision =
  | "done"
  | "next-round"
  | "rounds-exhausted"
  | "exclusions-too-large";

export interface DecideAfterRoundInput {
  readonly pass: CollectedSearchResults;
  readonly newIgnoredCount: number;
  // 1-based.
  readonly round: number;
  // measureExclusionArgvBytes of every ignored path known so far.
  readonly exclusionArgvBytes: number;
}

export function countMatches(files: readonly ContentSearchFile[]): number {
  return files.reduce((total, file) => total + file.matches.length, 0);
}

export function findUncheckedPaths(
  files: readonly ContentSearchFile[],
  state: IgnoreRoundState,
): string[] {
  return files
    .map((file) => file.path)
    .filter(
      (filePath) =>
        !state.ignoredPaths.has(filePath) && !state.verifiedPaths.has(filePath),
    );
}

export function recordIgnoreCheck(
  input: RecordIgnoreCheckInput,
): IgnoreRoundState {
  const { state, checkedPaths, ignoredPaths } = input;
  const nextIgnored = new Set(state.ignoredPaths);
  const nextVerified = new Set(state.verifiedPaths);
  for (const checkedPath of checkedPaths) {
    if (ignoredPaths.has(checkedPath)) nextIgnored.add(checkedPath);
    else nextVerified.add(checkedPath);
  }
  return { ignoredPaths: nextIgnored, verifiedPaths: nextVerified };
}

export function keepVerifiedFiles(
  files: readonly ContentSearchFile[],
  state: IgnoreRoundState,
): ContentSearchFile[] {
  return files.filter((file) => state.verifiedPaths.has(file.path));
}

export function buildExclusionGlobArg(ignoredPath: string): string {
  // Anchored and escaped, so it excludes exactly that file.
  return `--glob=!/${escapeGlobLiteral(ignoredPath)}`;
}

// argv bytes the exclusions would add (each arg plus its NUL terminator);
// infinite when a single argument is longer than any OS should accept.
export function measureExclusionArgvBytes(
  ignoredPaths: Iterable<string>,
): number {
  let totalBytes = 0;
  for (const ignoredPath of ignoredPaths) {
    const argBytes = utf8Encoder.encode(
      buildExclusionGlobArg(ignoredPath),
    ).length;
    if (argBytes > MAX_EXCLUSION_ARG_BYTES) return Number.POSITIVE_INFINITY;
    totalBytes += argBytes + 1;
  }
  return totalBytes;
}

export function decideAfterRound(input: DecideAfterRoundInput): RoundDecision {
  const { pass, newIgnoredCount, round, exclusionArgvBytes } = input;
  const isCapUsedByIgnored = pass.isLimitHit && newIgnoredCount > 0;
  if (!isCapUsedByIgnored || pass.isTimedOut) return "done";
  if (round >= MAX_IGNORE_ROUNDS) return "rounds-exhausted";
  if (exclusionArgvBytes > MAX_EXCLUSION_ARGV_BYTES) {
    return "exclusions-too-large";
  }
  return "next-round";
}
