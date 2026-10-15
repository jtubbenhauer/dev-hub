import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { escapeGlobLiteral } from "./glob-escape";
import { sha256Utf8Hex } from "./line-hash";
import { buildMatch, stripLineEnding, utf8ByteOffsetToUtf16 } from "./preview";
import { runLineProcess, type LineDecision } from "./process";
import { countMatches } from "./result-filter";
import { parseMatchEvent } from "./ripgrep-events";
import {
  SEARCH_CANCELLED,
  collectWithIgnoreRounds,
  type RipgrepPassResult,
} from "./ripgrep-rounds";
import type {
  ContentSearchFile,
  ContentSearchMatch,
  ContentSearchOutcome,
  ContentSearchQuery,
} from "./types";

// Node-only: never export from the @devhub/shared barrel.

const FALLBACK_RIPGREP_PATHS = [
  "/opt/homebrew/bin/rg",
  "/usr/local/bin/rg",
  "/usr/bin/rg",
] as const;
const MAX_ERROR_MESSAGE_CHARS = 500;

export interface SearchWithRipgrepInput {
  readonly binary: string;
  readonly workspacePath: string;
  readonly query: ContentSearchQuery;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

function isExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function resolveRipgrepBinary(): string | null {
  const pathCandidates = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => entry !== "")
    .map((entry) => join(entry, "rg"));
  const candidates = [...pathCandidates, ...FALLBACK_RIPGREP_PATHS];
  return candidates.find(isExecutableFile) ?? null;
}

function buildRipgrepArgs(
  query: ContentSearchQuery,
  excludedPaths: readonly string[],
): string[] {
  const args = [
    "--json",
    "--no-config",
    "--no-messages",
    "--hidden",
    "--max-filesize=1M",
  ];
  if (!query.isCaseSensitive) args.push("--ignore-case");
  if (query.isWholeWord) args.push("--word-regexp");
  if (!query.isRegex) args.push("--fixed-strings");
  for (const glob of query.includeGlobs) args.push(`--glob=${glob}`);
  for (const glob of query.excludeGlobs) args.push(`--glob=!${glob}`);
  // Anchored and escaped, so each one excludes exactly that file.
  for (const excludedPath of excludedPaths) {
    args.push(`--glob=!/${escapeGlobLiteral(excludedPath)}`);
  }
  // Last, so user include globs can never re-include these.
  args.push("--glob=!.git", "--glob=!node_modules");
  args.push(`--regexp=${query.pattern}`, "--", ".");
  return args;
}

function compareMatches(
  left: ContentSearchMatch,
  right: ContentSearchMatch,
): number {
  return (
    left.lineNumber - right.lineNumber || left.startColumn - right.startColumn
  );
}

function groupFiles(
  matchesByPath: ReadonlyMap<string, ContentSearchMatch[]>,
): ContentSearchFile[] {
  return [...matchesByPath]
    .map(([path, matches]) => ({ path, matches: matches.sort(compareMatches) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function truncateMessage(text: string): string {
  return text.trim().slice(0, MAX_ERROR_MESSAGE_CHARS);
}

interface RipgrepPassInput {
  readonly search: SearchWithRipgrepInput;
  // Matched paths found to be git-ignored by earlier ignore rounds.
  readonly excludedPaths: readonly string[];
  readonly timeoutMs: number;
}

async function runRipgrepPass(
  passInput: RipgrepPassInput,
): Promise<RipgrepPassResult> {
  const { search, excludedPaths, timeoutMs } = passInput;
  const { binary, workspacePath, query, signal } = search;
  const matchesByPath = new Map<string, ContentSearchMatch[]>();
  let matchCount = 0;
  let isLimitHit = false;

  function handleLine(rawLine: string): LineDecision {
    const event = parseMatchEvent(rawLine);
    if (event === null) return "continue";
    const line = stripLineEnding(event.lineText);
    const lineSha256 = sha256Utf8Hex(line);
    for (const submatch of event.submatches) {
      if (matchCount >= query.maxResults) {
        isLimitHit = true;
        return "stop";
      }
      const start = utf8ByteOffsetToUtf16(line, submatch.start);
      const end = Math.min(
        line.length,
        utf8ByteOffsetToUtf16(line, submatch.end),
      );
      const match = buildMatch({
        line,
        lineNumber: event.lineNumber,
        start,
        end,
        lineSha256,
      });
      const fileMatches = matchesByPath.get(event.path);
      if (fileMatches === undefined) matchesByPath.set(event.path, [match]);
      else fileMatches.push(match);
      matchCount += 1;
    }
    return "continue";
  }

  const result = await runLineProcess({
    command: binary,
    args: buildRipgrepArgs(query, excludedPaths),
    cwd: workspacePath,
    timeoutMs,
    signal,
    onLine: handleLine,
  });

  function collected(): RipgrepPassResult {
    const files = groupFiles(matchesByPath);
    const results = { files, isLimitHit, isTimedOut: result.isTimedOut };
    return { kind: "collected", results };
  }

  function outcome(searchOutcome: ContentSearchOutcome): RipgrepPassResult {
    return { kind: "outcome", outcome: searchOutcome };
  }

  if (result.isStopped || result.isTimedOut) return collected();
  if (result.isAborted) return outcome(SEARCH_CANCELLED);
  if (result.spawnErrorCode !== null) {
    return outcome({
      kind: "unavailable",
      message: "ripgrep could not be started",
    });
  }
  if (result.exitCode === 0 || result.exitCode === 1) return collected();
  if (result.exitCode === 2 && result.stderr.includes("regex parse error")) {
    const message = truncateMessage(result.stderr);
    return outcome({ kind: "invalid-pattern", message });
  }
  if (matchCount > 0) return collected();
  return outcome({
    kind: "failed",
    message:
      truncateMessage(result.stderr) ||
      `ripgrep exited with code ${String(result.exitCode)}`,
  });
}

export async function searchWithRipgrep(
  input: SearchWithRipgrepInput,
): Promise<ContentSearchOutcome> {
  const { workspacePath, query, timeoutMs, signal } = input;
  const startedAt = performance.now();
  const pass =
    query.includeGlobs.length === 0
      ? await runRipgrepPass({ search: input, excludedPaths: [], timeoutMs })
      : await collectWithIgnoreRounds({
          workspacePath,
          signal,
          getRemainingMs: () => timeoutMs - (performance.now() - startedAt),
          runPass: (excludedPaths, passTimeoutMs) =>
            runRipgrepPass({
              search: input,
              excludedPaths,
              timeoutMs: passTimeoutMs,
            }),
        });
  if (pass.kind === "outcome") return pass.outcome;
  const { files, isLimitHit, isTimedOut } = pass.results;
  return {
    kind: "ok",
    files,
    matchCount: countMatches(files),
    fileCount: files.length,
    isLimitHit,
    isTimedOut,
    engine: "ripgrep",
    durationMs: performance.now() - startedAt,
  };
}
