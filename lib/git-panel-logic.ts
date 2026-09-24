import { buildFileTree, flattenVisibleItems } from "@/lib/git-file-tree";
import type { GitStatusResult, ReviewChangedFile } from "@/types";

export type SortMode = "name-asc" | "name-desc" | "status" | "path";

export const SORT_LABELS: Record<SortMode, string> = {
  "name-asc": "Name A-Z",
  "name-desc": "Name Z-A",
  status: "Status",
  path: "Full path",
};

export const SORT_MODE_ORDER: SortMode[] = [
  "name-asc",
  "name-desc",
  "status",
  "path",
];

export function getNextSortMode(mode: SortMode): SortMode {
  const index = SORT_MODE_ORDER.indexOf(mode);
  return SORT_MODE_ORDER[(index + 1) % SORT_MODE_ORDER.length];
}

export type GitViewMode = "working" | "branch" | "last-commit";

const VALID_GIT_VIEW_MODES: readonly GitViewMode[] = [
  "working",
  "branch",
  "last-commit",
];

export function isValidViewMode(raw: string | null): raw is GitViewMode {
  return raw !== null && VALID_GIT_VIEW_MODES.includes(raw as GitViewMode);
}

export function parseStoredViewMode(raw: string | null): GitViewMode {
  return isValidViewMode(raw) ? raw : "working";
}

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

// ---------------------------------------------------------------------------
// Visible (collapse-aware) flat file builders
// ---------------------------------------------------------------------------

// Mirrors file-status.tsx sortByMode: name modes sort by filename, status sorts
// by an optional status key (index/workingDir), path sorts by full path.
function sortSection<T extends { path: string }>(
  items: T[],
  mode: SortMode,
  statusKey?: keyof T,
): T[] {
  const sorted = [...items];
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
      if (statusKey) {
        return sorted.sort((a, b) =>
          String(a[statusKey]).localeCompare(String(b[statusKey])),
        );
      }
      return sorted;
    case "path":
      return sorted.sort((a, b) => a.path.localeCompare(b.path));
    default:
      return sorted;
  }
}

// Working-mode visible order. Ungrouped delegates to buildFlatFiles; grouped
// reproduces file-status.tsx exactly: per-section trees (staged, changes =
// unstaged+untracked, conflicts) built with the folderOrder rule, flattened
// skipping files hidden inside collapsed folders, then concatenated.
export function buildVisibleFlatFiles(
  status: GitStatusResult | undefined | null,
  sortMode: SortMode,
  isGroupedByFolder: boolean,
  collapsedFolders: ReadonlySet<string>,
): FlatFile[] {
  if (!status) return [];
  if (!isGroupedByFolder) return buildFlatFiles(status, sortMode);

  const folderOrder = sortMode === "name-desc" ? "desc" : "asc";

  const sortedStaged = sortSection(status.staged, sortMode, "index");
  const sortedUnstaged = sortSection(status.unstaged, sortMode, "workingDir");
  const sortedUntracked = sortSection(
    status.untracked.map((p) => ({ path: p })),
    sortMode,
  );
  const sortedConflicted = sortSection(
    status.conflicted.map((p) => ({ path: p })),
    sortMode,
  );

  const stagedTree = buildFileTree(sortedStaged, folderOrder);
  const changesItems = [
    ...sortedUnstaged.map((f) => ({ path: f.path })),
    ...sortedUntracked.map((f) => ({ path: f.path })),
  ];
  const changesTree = buildFileTree(changesItems, folderOrder);
  const conflictsTree = buildFileTree(sortedConflicted, folderOrder);

  return [
    ...flattenVisibleItems(stagedTree, collapsedFolders).map((f) => ({
      path: f.path,
      isStaged: true,
    })),
    ...flattenVisibleItems(changesTree, collapsedFolders).map((f) => ({
      path: f.path,
      isStaged: false,
    })),
    ...flattenVisibleItems(conflictsTree, collapsedFolders).map((f) => ({
      path: f.path,
      isStaged: false,
    })),
  ];
}

// Branch / last-commit visible order. Mirrors ChangedFileList: the input files
// are already sorted by the caller, so we only build the tree (folderOrder
// controls folder ordering; files keep input order) and flatten when grouped.
// Every entry is isStaged: false.
export function buildVisibleChangedFiles(
  changedFiles: ReviewChangedFile[],
  sortMode: SortMode,
  isGroupedByFolder: boolean,
  collapsedFolders: ReadonlySet<string>,
): FlatFile[] {
  if (!isGroupedByFolder) {
    return changedFiles.map((f) => ({ path: f.path, isStaged: false }));
  }
  const folderOrder = sortMode === "name-desc" ? "desc" : "asc";
  const tree = buildFileTree(changedFiles, folderOrder);
  return flattenVisibleItems(tree, collapsedFolders).map((f) => ({
    path: f.path,
    isStaged: false,
  }));
}

// ---------------------------------------------------------------------------
// Leader-key file action resolver
// ---------------------------------------------------------------------------

export type LeaderFileAction =
  | "next-file"
  | "prev-file"
  | "next-unreviewed"
  | "prev-unreviewed"
  | "reviewed-next"
  | "stage-toggle";

export interface LeaderFileActionInput {
  action: LeaderFileAction;
  viewMode: string;
  status: GitStatusResult | undefined | null;
  changedFiles: ReviewChangedFile[];
  sortMode: SortMode;
  isGroupedByFolder: boolean;
  collapsedFolders: ReadonlySet<string>;
  selectedFile: string | null;
  selectedStaged: boolean;
  reviewedFiles: ReadonlySet<string>;
}

export type LeaderFileResolution =
  | { kind: "select"; path: string; staged: boolean }
  | { kind: "stage"; path: string }
  | { kind: "unstage"; path: string }
  | {
      kind: "toggle-reviewed-then-select";
      togglePath: string;
      next: { path: string; staged: boolean } | null;
    }
  | { kind: "noop" };

type NavAction =
  | "next-file"
  | "prev-file"
  | "next-unreviewed"
  | "prev-unreviewed";

// selectedIndex is -1 for a null selection; each nav action then resolves to the
// first visible candidate.
function findNavTarget(
  action: NavAction,
  list: FlatFile[],
  selectedIndex: number,
  nullSelection: boolean,
  reviewedFiles: ReadonlySet<string>,
): FlatFile | null {
  if (list.length === 0) return null;
  switch (action) {
    case "next-file":
      return list[Math.min(selectedIndex + 1, list.length - 1)] ?? null;
    case "prev-file":
      return list[Math.max(selectedIndex - 1, 0)] ?? null;
    case "next-unreviewed":
      return (
        list.find((f, i) => !reviewedFiles.has(f.path) && i > selectedIndex) ??
        null
      );
    case "prev-unreviewed":
      if (nullSelection) {
        return list.find((f) => !reviewedFiles.has(f.path)) ?? null;
      }
      return (
        [...list]
          .slice(0, selectedIndex)
          .reverse()
          .find((f) => !reviewedFiles.has(f.path)) ?? null
      );
  }
}

// Pure resolution of a leader-key file action against the collapse-aware visible
// list. No side effects — the caller applies the result via
// applyLeaderFileResolution.
export function resolveLeaderFileAction(
  input: LeaderFileActionInput,
): LeaderFileResolution {
  const {
    action,
    viewMode,
    status,
    changedFiles,
    sortMode,
    isGroupedByFolder,
    collapsedFolders,
    selectedFile,
    selectedStaged,
    reviewedFiles,
  } = input;

  let list: FlatFile[];
  if (viewMode === "working") {
    list = buildVisibleFlatFiles(
      status,
      sortMode,
      isGroupedByFolder,
      collapsedFolders,
    );
  } else if (viewMode === "branch" || viewMode === "last-commit") {
    list = buildVisibleChangedFiles(
      changedFiles,
      sortMode,
      isGroupedByFolder,
      collapsedFolders,
    );
  } else {
    // pr and any other view mode has no collapse-aware file list here
    return { kind: "noop" };
  }

  // stage-toggle is only meaningful in working mode
  if (action === "stage-toggle" && viewMode !== "working") {
    return { kind: "noop" };
  }

  const nullSelection = selectedFile === null;
  let selectedIndex = -1;
  if (!nullSelection) {
    selectedIndex = list.findIndex(
      (f) => f.path === selectedFile && f.isStaged === selectedStaged,
    );
    // HIDDEN-SELECTION RULE: a selection that is not in the visible list
    // (e.g. inside a collapsed folder) resolves every action to noop.
    if (selectedIndex === -1) return { kind: "noop" };
  }

  switch (action) {
    case "reviewed-next": {
      if (selectedFile === null) return { kind: "noop" };
      const next = list[selectedIndex + 1];
      return {
        kind: "toggle-reviewed-then-select",
        togglePath: selectedFile,
        next: next ? { path: next.path, staged: next.isStaged } : null,
      };
    }
    case "stage-toggle": {
      if (selectedFile === null) return { kind: "noop" };
      const current = list[selectedIndex];
      if (!current) return { kind: "noop" };
      return current.isStaged
        ? { kind: "unstage", path: current.path }
        : { kind: "stage", path: current.path };
    }
    case "next-file":
    case "prev-file":
    case "next-unreviewed":
    case "prev-unreviewed": {
      const target = findNavTarget(
        action,
        list,
        selectedIndex,
        nullSelection,
        reviewedFiles,
      );
      return target
        ? { kind: "select", path: target.path, staged: target.isStaged }
        : { kind: "noop" };
    }
    default:
      return { kind: "noop" };
  }
}

export interface LeaderFileEffects {
  select: (path: string, staged: boolean) => void;
  toggleReviewed: (path: string) => void;
  stage: (path: string) => void;
  unstage: (path: string) => void;
  wasEditorFocused: boolean;
  refocusEditor: () => void;
}

// Applies a resolution to imperative effects. For toggle-reviewed-then-select,
// refocusEditor runs AFTER select and only when the editor had focus, preserving
// the existing reviewed-next focus behavior.
export function applyLeaderFileResolution(
  resolution: LeaderFileResolution,
  effects: LeaderFileEffects,
): void {
  switch (resolution.kind) {
    case "select":
      effects.select(resolution.path, resolution.staged);
      return;
    case "stage":
      effects.stage(resolution.path);
      return;
    case "unstage":
      effects.unstage(resolution.path);
      return;
    case "toggle-reviewed-then-select":
      effects.toggleReviewed(resolution.togglePath);
      if (resolution.next) {
        effects.select(resolution.next.path, resolution.next.staged);
        if (effects.wasEditorFocused) {
          effects.refocusEditor();
        }
      }
      return;
    case "noop":
      return;
  }
}
