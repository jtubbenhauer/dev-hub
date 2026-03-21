import type { GitStatusResult, ReviewChangedFile } from "@/types";

export type SortMode = "name-asc" | "name-desc" | "status" | "path";

export interface FlatFile {
  path: string;
  isStaged: boolean;
}

export function sortFiles(
  files: ReviewChangedFile[],
  mode: SortMode,
): ReviewChangedFile[] {
  const sorted = [...files];
  switch (mode) {
    case "name-asc":
      return sorted.sort((a, b) => {
        const an = a.path.split("/").pop() ?? a.path;
        const bn = b.path.split("/").pop() ?? b.path;
        return an.localeCompare(bn);
      });
    case "name-desc":
      return sorted.sort((a, b) => {
        const an = a.path.split("/").pop() ?? a.path;
        const bn = b.path.split("/").pop() ?? b.path;
        return bn.localeCompare(an);
      });
    case "status":
      return sorted.sort((a, b) => a.status.localeCompare(b.status));
    case "path":
      return sorted.sort((a, b) => a.path.localeCompare(b.path));
    default:
      return sorted;
  }
}

export function buildFlatFiles(
  status: GitStatusResult | undefined | null,
  sortMode: SortMode,
): FlatFile[] {
  if (!status) return [];

  const sort = <T extends { path: string }>(items: T[]): T[] => {
    const sorted = [...items];
    switch (sortMode) {
      case "name-asc":
        return sorted.sort((a, b) => {
          const an = a.path.split("/").pop() ?? a.path;
          const bn = b.path.split("/").pop() ?? b.path;
          return an.localeCompare(bn);
        });
      case "name-desc":
        return sorted.sort((a, b) => {
          const an = a.path.split("/").pop() ?? a.path;
          const bn = b.path.split("/").pop() ?? b.path;
          return bn.localeCompare(an);
        });
      case "status":
        return sorted;
      case "path":
        return sorted.sort((a, b) => a.path.localeCompare(b.path));
      default:
        return sorted;
    }
  };

  return [
    ...sort(status.staged).map((f) => ({ path: f.path, isStaged: true })),
    ...sort(status.unstaged).map((f) => ({ path: f.path, isStaged: false })),
    ...sort(status.untracked.map((p) => ({ path: p }))).map((f) => ({
      path: f.path,
      isStaged: false,
    })),
    ...sort(status.conflicted.map((p) => ({ path: p }))).map((f) => ({
      path: f.path,
      isStaged: false,
    })),
  ];
}
