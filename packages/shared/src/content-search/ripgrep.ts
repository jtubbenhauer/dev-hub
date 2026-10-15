import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { sha256Utf8Hex } from "./line-hash";
import { buildMatch, stripLineEnding, utf8ByteOffsetToUtf16 } from "./preview";
import { runLineProcess, type LineDecision } from "./process";
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

interface RipgrepSubmatch {
  readonly start: number;
  readonly end: number;
}

interface RipgrepMatchEvent {
  readonly path: string;
  readonly lineText: string;
  readonly lineNumber: number;
  readonly submatches: readonly RipgrepSubmatch[];
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

function buildRipgrepArgs(query: ContentSearchQuery): string[] {
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
  // Last, so user include globs can never re-include these.
  args.push("--glob=!.git", "--glob=!node_modules");
  args.push(`--regexp=${query.pattern}`, "--", ".");
  return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// rg reports non-UTF-8 paths and lines as { bytes } instead of { text }.
function readText(value: unknown): string | null {
  return isRecord(value) && typeof value.text === "string" ? value.text : null;
}

function parseSubmatch(value: unknown): RipgrepSubmatch | null {
  if (!isRecord(value)) return null;
  const { start, end } = value;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { start, end };
}

function parseJsonLine(rawLine: string): unknown {
  try {
    return JSON.parse(rawLine);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function parseMatchEvent(rawLine: string): RipgrepMatchEvent | null {
  const event = parseJsonLine(rawLine);
  if (!isRecord(event) || event.type !== "match" || !isRecord(event.data)) {
    return null;
  }
  const { path, lines, line_number: lineNumber, submatches } = event.data;
  const pathText = readText(path);
  const lineText = readText(lines);
  if (
    pathText === null ||
    lineText === null ||
    typeof lineNumber !== "number" ||
    !Array.isArray(submatches)
  ) {
    return null;
  }
  return {
    path: pathText.startsWith("./") ? pathText.slice(2) : pathText,
    lineText,
    lineNumber,
    submatches: submatches
      .map(parseSubmatch)
      .filter((submatch) => submatch !== null),
  };
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

export async function searchWithRipgrep(
  input: SearchWithRipgrepInput,
): Promise<ContentSearchOutcome> {
  const { binary, workspacePath, query, timeoutMs, signal } = input;
  const startedAt = performance.now();
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
    args: buildRipgrepArgs(query),
    cwd: workspacePath,
    timeoutMs,
    signal,
    onLine: handleLine,
  });

  function buildOkOutcome(): ContentSearchOutcome {
    const files = groupFiles(matchesByPath);
    return {
      kind: "ok",
      files,
      matchCount,
      fileCount: files.length,
      isLimitHit,
      isTimedOut: result.isTimedOut,
      engine: "ripgrep",
      durationMs: performance.now() - startedAt,
    };
  }

  if (result.isStopped || result.isTimedOut) return buildOkOutcome();
  if (result.isAborted) return { kind: "failed", message: "Search cancelled" };
  if (result.spawnErrorCode !== null) {
    return { kind: "unavailable", message: "ripgrep could not be started" };
  }
  if (result.exitCode === 0 || result.exitCode === 1) return buildOkOutcome();
  if (result.exitCode === 2 && result.stderr.includes("regex parse error")) {
    return { kind: "invalid-pattern", message: truncateMessage(result.stderr) };
  }
  if (matchCount > 0) return buildOkOutcome();
  return {
    kind: "failed",
    message:
      truncateMessage(result.stderr) ||
      `ripgrep exited with code ${String(result.exitCode)}`,
  };
}
