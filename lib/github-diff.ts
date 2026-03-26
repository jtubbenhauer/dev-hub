const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

// GitHub's review comment API only accepts line numbers within diff hunks.
// This parses the patch to extract valid modified-side (RIGHT) line numbers.
export function parseDiffHunkLines(patch: string | undefined): Set<number> {
  const lines = new Set<number>();
  if (!patch) return lines;

  let currentLine = 0;
  let remaining = 0;

  for (const raw of patch.split("\n")) {
    const hunkMatch = HUNK_HEADER_RE.exec(raw);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      remaining = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      lines.add(currentLine);
      continue;
    }

    if (remaining <= 0) continue;

    // Deletions only affect the LEFT side — don't consume a modified-side line
    if (raw.startsWith("-")) continue;

    lines.add(currentLine);
    currentLine++;
    remaining--;
  }

  return lines;
}
