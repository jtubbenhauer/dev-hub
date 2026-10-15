import type { ContentSearchMatch } from "./types";

// 32-bit FNV-1a over UTF-16 code units. A staleness check for search results,
// not a security boundary.
function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintText(text: string): string {
  return `${text.length}:${fnv1a32Hex(text)}`;
}

export function isSearchMatchCurrent(
  content: string,
  match: ContentSearchMatch,
): boolean {
  const rawLine = content.split("\n")[match.lineNumber - 1];
  if (rawLine === undefined) return false;
  const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
  if (match.endColumn - 1 > line.length) return false;

  const isZeroLength = match.endColumn <= match.startColumn;
  const comparedText = isZeroLength
    ? line
    : line.slice(match.startColumn - 1, match.endColumn - 1);
  return fingerprintText(comparedText) === match.matchFingerprint;
}
