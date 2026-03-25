/**
 * Thin wrapper around the `fzf` package (port of junegunn/fzf algorithm).
 * Provides a stable interface for the rest of the app while keeping the
 * dependency isolated here.
 */

import { Fzf, type FzfResultItem } from "fzf";

export interface FuzzyMatch {
  /** The original string that was matched */
  path: string;
  /** Score (higher = better match). 0 means no match. */
  score: number;
  /** Character index ranges for highlighting: [start, end+1] pairs */
  positions: Set<number>;
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
  cachedFzf = new Fzf(paths, { fuzzy: "v2" });
  cachedPaths = paths;
  return cachedFzf;
}

export function fuzzySearch(
  query: string,
  paths: string[],
  maxResults = 50,
): FuzzyMatch[] {
  if (query.length === 0) {
    return paths
      .slice(0, maxResults)
      .map((p) => ({ path: p, score: 0, positions: new Set<number>() }));
  }

  const fzf = getFzf(paths);
  const results = fzf.find(query);
  return results.slice(0, maxResults).map(toFuzzyMatch);
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
