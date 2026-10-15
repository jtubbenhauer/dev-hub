import type { ContentSearchFile } from "./types";

// Pure bookkeeping for the include-glob ignore rounds: which matched paths git
// has said are ignored or verified, and whether to run rg again. No Node
// imports; not exported from the @devhub/shared barrel.

// rg include globs override .gitignore, so ignored files can fill the cap; each
// extra round re-runs rg with the ignored files found so far excluded.
export const MAX_IGNORE_ROUNDS = 4;

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
  | "out-of-time";

export interface DecideAfterRoundInput {
  readonly pass: CollectedSearchResults;
  readonly newIgnoredCount: number;
  // 1-based.
  readonly round: number;
  readonly remainingMs: number;
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

export function decideAfterRound(input: DecideAfterRoundInput): RoundDecision {
  const { pass, newIgnoredCount, round, remainingMs } = input;
  const isCapUsedByIgnored = pass.isLimitHit && newIgnoredCount > 0;
  if (!isCapUsedByIgnored || pass.isTimedOut) return "done";
  if (round >= MAX_IGNORE_ROUNDS) return "rounds-exhausted";
  if (remainingMs <= 0) return "out-of-time";
  return "next-round";
}
