import type {
  ContentSearchEngine,
  ContentSearchFile,
  ContentSearchMatch,
  ContentSearchOutcome,
} from "./types";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isContentSearchEngine(value: unknown): value is ContentSearchEngine {
  return value === "ripgrep" || value === "git-grep";
}

function parseMatch(value: unknown): ContentSearchMatch | null {
  if (!isRecord(value)) return null;
  const {
    lineNumber,
    startColumn,
    endColumn,
    startByteColumn,
    matchFingerprint,
    lineSha256,
    preview,
    previewMatchStart,
    previewMatchEnd,
  } = value;
  if (
    !isFiniteNumber(lineNumber) ||
    !isFiniteNumber(startColumn) ||
    !isFiniteNumber(endColumn) ||
    !isFiniteNumber(startByteColumn) ||
    !isFiniteNumber(previewMatchStart) ||
    !isFiniteNumber(previewMatchEnd) ||
    typeof matchFingerprint !== "string" ||
    typeof lineSha256 !== "string" ||
    !SHA256_HEX_PATTERN.test(lineSha256) ||
    typeof preview !== "string"
  ) {
    return null;
  }
  return {
    lineNumber,
    startColumn,
    endColumn,
    startByteColumn,
    matchFingerprint,
    lineSha256,
    preview,
    previewMatchStart,
    previewMatchEnd,
  };
}

function parseFile(value: unknown): ContentSearchFile | null {
  if (!isRecord(value)) return null;
  const { path, matches } = value;
  if (typeof path !== "string" || !Array.isArray(matches)) return null;
  const parsedMatches: ContentSearchMatch[] = [];
  for (const match of matches) {
    const parsedMatch = parseMatch(match);
    if (parsedMatch === null) return null;
    parsedMatches.push(parsedMatch);
  }
  return { path, matches: parsedMatches };
}

function parseOkOutcome(
  value: Record<string, unknown>,
): ContentSearchOutcome | null {
  const {
    files,
    matchCount,
    fileCount,
    isLimitHit,
    isTimedOut,
    engine,
    durationMs,
  } = value;
  if (
    !Array.isArray(files) ||
    !isFiniteNumber(matchCount) ||
    !isFiniteNumber(fileCount) ||
    typeof isLimitHit !== "boolean" ||
    typeof isTimedOut !== "boolean" ||
    !isContentSearchEngine(engine) ||
    !isFiniteNumber(durationMs)
  ) {
    return null;
  }
  const parsedFiles: ContentSearchFile[] = [];
  for (const file of files) {
    const parsedFile = parseFile(file);
    if (parsedFile === null) return null;
    parsedFiles.push(parsedFile);
  }
  return {
    kind: "ok",
    files: parsedFiles,
    matchCount,
    fileCount,
    isLimitHit,
    isTimedOut,
    engine,
    durationMs,
  };
}

export function parseContentSearchOutcome(
  value: unknown,
): ContentSearchOutcome | null {
  if (!isRecord(value)) return null;
  const { kind, message } = value;
  switch (kind) {
    case "ok":
      return parseOkOutcome(value);
    case "invalid-pattern":
    case "unavailable":
    case "failed":
      return typeof message === "string" ? { kind, message } : null;
    default:
      return null;
  }
}
