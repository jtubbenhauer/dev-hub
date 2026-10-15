import { findGitIgnoredPaths } from "./ignored-paths";
import {
  EMPTY_IGNORE_ROUND_STATE,
  decideAfterRound,
  findUncheckedPaths,
  keepVerifiedFiles,
  recordIgnoreCheck,
  type CollectedSearchResults,
} from "./result-filter";
import type { ContentSearchOutcome } from "./types";

// Node-only (spawns git): never export from the @devhub/shared barrel.

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
  readonly workspacePath: string;
  readonly signal?: AbortSignal;
  // Time left of the whole search's budget.
  readonly getRemainingMs: () => number;
  readonly runPass: (
    excludedPaths: readonly string[],
    timeoutMs: number,
  ) => Promise<RipgrepPassResult>;
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
  const { workspacePath, signal, getRemainingMs, runPass } = input;
  let state = EMPTY_IGNORE_ROUND_STATE;
  for (let round = 1; ; round += 1) {
    const pass = await runPass([...state.ignoredPaths], getRemainingMs());
    if (pass.kind === "outcome") return pass;
    const { files, isLimitHit, isTimedOut } = pass.results;
    const checkedPaths = findUncheckedPaths(files, state);
    const check = await findGitIgnoredPaths({
      cwd: workspacePath,
      paths: checkedPaths,
      timeoutMs: getRemainingMs(),
      signal,
    });
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
    const verifiedFiles = keepVerifiedFiles(files, state);
    const decision = decideAfterRound({
      pass: pass.results,
      newIgnoredCount: check.paths.size,
      round,
      remainingMs: getRemainingMs(),
    });
    switch (decision) {
      case "next-round":
        break;
      case "done":
        return collected({ files: verifiedFiles, isLimitHit, isTimedOut });
      case "rounds-exhausted":
        return collected({
          files: verifiedFiles,
          isLimitHit: true,
          isTimedOut: false,
        });
      case "out-of-time":
        return collected({
          files: verifiedFiles,
          isLimitHit: true,
          isTimedOut: true,
        });
      default: {
        const unreachable: never = decision;
        return unreachable;
      }
    }
  }
}
