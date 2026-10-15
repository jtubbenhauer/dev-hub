import type { GitIgnoreCheck } from "./ignored-paths";
import {
  EMPTY_IGNORE_ROUND_STATE,
  decideAfterRound,
  findUncheckedPaths,
  keepVerifiedFiles,
  measureExclusionArgvBytes,
  recordIgnoreCheck,
  type CollectedSearchResults,
} from "./result-filter";
import type { ContentSearchFile, ContentSearchOutcome } from "./types";

// Round orchestration only; rg and git are injected by ripgrep.ts. Not
// exported from the @devhub/shared barrel.

export const SEARCH_CANCELLED = {
  kind: "failed",
  message: "Search cancelled",
} as const satisfies ContentSearchOutcome;

const GIT_UNAVAILABLE = {
  kind: "failed",
  message:
    "Could not check .gitignore for the file filter because git is not available. Remove the file filter to search without it.",
} as const satisfies ContentSearchOutcome;

export type RipgrepPassResult =
  | { readonly kind: "collected"; readonly results: CollectedSearchResults }
  | { readonly kind: "outcome"; readonly outcome: ContentSearchOutcome };

export interface IgnoreRoundsInput {
  // Time left of the whole search's budget.
  readonly getRemainingMs: () => number;
  readonly runPass: (
    excludedPaths: readonly string[],
    timeoutMs: number,
  ) => Promise<RipgrepPassResult>;
  readonly checkIgnoredPaths: (
    paths: readonly string[],
    timeoutMs: number,
  ) => Promise<GitIgnoreCheck>;
}

function collected(results: CollectedSearchResults): RipgrepPassResult {
  return { kind: "collected", results };
}

// With include globs, rg doesn't apply .gitignore to files the globs match.
// Every matched path is checked with git, only verified files are returned,
// and while ignored files fill the cap rg is re-run with them excluded.
export async function collectWithIgnoreRounds(
  input: IgnoreRoundsInput,
): Promise<RipgrepPassResult> {
  const { getRemainingMs, runPass, checkIgnoredPaths } = input;
  let state = EMPTY_IGNORE_ROUND_STATE;
  let verifiedFiles: readonly ContentSearchFile[] = [];
  for (let round = 1; ; round += 1) {
    const passTimeoutMs = getRemainingMs();
    // Never spawn a re-run that would be killed at once.
    if (round > 1 && passTimeoutMs <= 0) {
      return collected({
        files: verifiedFiles,
        isLimitHit: true,
        isTimedOut: true,
      });
    }
    const pass = await runPass([...state.ignoredPaths], passTimeoutMs);
    if (pass.kind === "outcome") return pass;
    const { files, isLimitHit, isTimedOut } = pass.results;
    const checkedPaths = findUncheckedPaths(files, state);
    const check = await checkIgnoredPaths(checkedPaths, getRemainingMs());
    switch (check.kind) {
      case "ignored":
        break;
      case "not-a-repository":
        // Outside a repository rg doesn't apply .gitignore either.
        return pass;
      case "timed-out":
        return collected({
          files: keepVerifiedFiles(files, state),
          isLimitHit,
          isTimedOut: true,
        });
      case "unavailable":
        return { kind: "outcome", outcome: GIT_UNAVAILABLE };
      case "aborted":
        return { kind: "outcome", outcome: SEARCH_CANCELLED };
      default: {
        const unreachable: never = check;
        return unreachable;
      }
    }
    state = recordIgnoreCheck({
      state,
      checkedPaths,
      ignoredPaths: check.paths,
    });
    verifiedFiles = keepVerifiedFiles(files, state);
    const decision = decideAfterRound({
      pass: pass.results,
      newIgnoredCount: check.paths.size,
      round,
      exclusionArgvBytes: measureExclusionArgvBytes(state.ignoredPaths),
    });
    switch (decision) {
      case "next-round":
        break;
      case "done":
        return collected({ files: verifiedFiles, isLimitHit, isTimedOut });
      case "rounds-exhausted":
      case "exclusions-too-large":
        return collected({
          files: verifiedFiles,
          isLimitHit: true,
          isTimedOut: false,
        });
      default: {
        const unreachable: never = decision;
        return unreachable;
      }
    }
  }
}
