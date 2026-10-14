/**
 * Thin wrapper around the `fzf` package (port of junegunn/fzf algorithm).
 * Provides a stable interface for the rest of the app while keeping the
 * dependency isolated here.
 */

import { Fzf, extendedMatch, type FzfResultItem } from "fzf";

export interface FuzzyMatch {
  /** The original string that was matched */
  path: string;
  /** Score (higher = better match). 0 means no match. */
  score: number;
  /** Character index ranges for highlighting: [start, end+1] pairs */
  positions: Set<number>;
}

interface RankedEntry {
  readonly entry: FzfResultItem<string>;
  readonly contiguousTermCount: number;
  readonly fileNameRank: number;
}

function toFuzzyMatch(entry: FzfResultItem<string>): FuzzyMatch {
  return {
    path: entry.item,
    score: entry.score,
    positions: entry.positions,
  };
}

// Cache the Fzf instance so the rune index is only built once per file list.
// Uses reference equality — TanStack Query returns the same array while cached.
let cachedPaths: string[] | null = null;
let cachedFzf: Fzf<string[]> | null = null;

function getFzf(paths: string[]): Fzf<string[]> {
  if (cachedPaths === paths && cachedFzf) return cachedFzf;
  // Extended syntax: space-separated terms must all match, in any order.
  // fuzzySearch sorts the results itself, so skip fzf's own sort.
  cachedFzf = new Fzf(paths, {
    fuzzy: "v2",
    match: extendedMatch,
    sort: false,
  });
  cachedPaths = paths;
  return cachedFzf;
}

// Strip extended-syntax operators (!negate, 'exact, ^prefix, suffix$, |) so
// each term can be looked up literally when ranking.
function getRankingTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "|" && !term.startsWith("!"))
    .map((term) => term.replace(/^['^]+/, "").replace(/\$$/, ""))
    .filter((term) => term.length > 0);
}

function getFileNameRank(fileName: string, term: string): number {
  const extensionStart = fileName.lastIndexOf(".");
  const stem =
    extensionStart > 0 ? fileName.slice(0, extensionStart) : fileName;
  if (fileName === term || stem === term) return 3;
  if (fileName.startsWith(term)) return 2;
  return fileName.includes(term) ? 1 : 0;
}

function rankEntry(
  entry: FzfResultItem<string>,
  terms: readonly string[],
): RankedEntry {
  const lowerPath = entry.item.toLowerCase();
  const fileName = lowerPath.slice(lowerPath.lastIndexOf("/") + 1);
  let contiguousTermCount = 0;
  let fileNameRank = 0;
  for (const term of terms) {
    if (lowerPath.includes(term)) contiguousTermCount++;
    fileNameRank += getFileNameRank(fileName, term);
  }
  return { entry, contiguousTermCount, fileNameRank };
}

// Unbroken term matches first, then matches in the file name itself, then
// fzf's score, then the shorter path.
function compareRankedEntries(a: RankedEntry, b: RankedEntry): number {
  return (
    b.contiguousTermCount - a.contiguousTermCount ||
    b.fileNameRank - a.fileNameRank ||
    b.entry.score - a.entry.score ||
    a.entry.item.length - b.entry.item.length
  );
}

export function fuzzySearch(
  query: string,
  paths: string[],
  maxResults = 50,
): FuzzyMatch[] {
  if (query.trim().length === 0) {
    return paths
      .slice(0, maxResults)
      .map((p) => ({ path: p, score: 0, positions: new Set<number>() }));
  }

  const terms = getRankingTerms(query);
  return getFzf(paths)
    .find(query)
    .map((entry) => rankEntry(entry, terms))
    .sort(compareRankedEntries)
    .slice(0, maxResults)
    .map((ranked) => toFuzzyMatch(ranked.entry));
}

// Remap full-path character positions to basename-relative positions
export function basenamePositions(
  fullPath: string,
  positions: Set<number>,
): Set<number> {
  const lastSlash = fullPath.lastIndexOf("/");
  if (lastSlash === -1) return positions;

  const offset = lastSlash + 1;
  const result = new Set<number>();
  for (const pos of positions) {
    if (pos >= offset) result.add(pos - offset);
  }
  return result;
}
