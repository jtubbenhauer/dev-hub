import { searchWithGitGrep } from "./git-grep";
import { resolveRipgrepBinary, searchWithRipgrep } from "./ripgrep";
import type { ContentSearchOutcome, ContentSearchQuery } from "./types";

// Node-only entry, exposed as @devhub/shared/content-search; never export it
// from the @devhub/shared barrel.

export { resolveRipgrepBinary };

const DEFAULT_TIMEOUT_MS = 15_000;

export interface SearchWorkspaceContentInput {
  readonly workspacePath: string;
  readonly query: ContentSearchQuery;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  // undefined: resolve rg from PATH; null: force git grep; string: rg path.
  readonly ripgrepBinary?: string | null;
}

export function searchWorkspaceContent(
  input: SearchWorkspaceContentInput,
): Promise<ContentSearchOutcome> {
  const { workspacePath, query, signal } = input;
  if (query.pattern === "") {
    return Promise.resolve({
      kind: "ok",
      files: [],
      matchCount: 0,
      fileCount: 0,
      isLimitHit: false,
      isTimedOut: false,
      engine: "ripgrep",
      durationMs: 0,
    });
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const binary =
    input.ripgrepBinary === undefined
      ? resolveRipgrepBinary()
      : input.ripgrepBinary;
  if (binary === null) {
    return searchWithGitGrep({ workspacePath, query, timeoutMs, signal });
  }
  return searchWithRipgrep({ binary, workspacePath, query, timeoutMs, signal });
}
