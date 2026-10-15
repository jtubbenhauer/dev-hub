// Parses rg --json output lines. Pure: no Node imports. Not exported from the
// @devhub/shared barrel.

interface RipgrepSubmatch {
  // UTF-8 byte offsets into the line.
  readonly start: number;
  readonly end: number;
}

export interface RipgrepMatchEvent {
  // Workspace-relative, without a leading "./".
  readonly path: string;
  readonly lineText: string;
  readonly lineNumber: number;
  readonly submatches: readonly RipgrepSubmatch[];
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

export function parseMatchEvent(rawLine: string): RipgrepMatchEvent | null {
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
