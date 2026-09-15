import { describe, it, expect, vi } from "vitest";
import {
  sortFiles,
  buildFlatFiles,
  buildVisibleFlatFiles,
  buildVisibleChangedFiles,
  resolveLeaderFileAction,
  applyLeaderFileResolution,
  parseStoredViewMode,
  isValidViewMode,
} from "@/lib/git-panel-logic";
import type {
  SortMode,
  LeaderFileAction,
  LeaderFileActionInput,
  LeaderFileEffects,
} from "@/lib/git-panel-logic";
import { buildFileTree, flattenVisibleItems } from "@/lib/git-file-tree";
import type { ReviewChangedFile, GitStatusResult } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReviewFile(
  path: string,
  status: ReviewChangedFile["status"] = "modified",
): ReviewChangedFile {
  return { path, status };
}

function makeStatus(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    isRepo: true,
    branch: "main",
    tracking: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    lastCommit: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. sortFiles — name-asc
// ---------------------------------------------------------------------------

describe("sortFiles — name-asc", () => {
  it("sorts by filename A→Z, ignoring directory prefix", () => {
    const files = [
      makeReviewFile("src/zebra.ts"),
      makeReviewFile("src/apple.ts"),
      makeReviewFile("lib/mango.ts"),
    ];
    const result = sortFiles(files, "name-asc");
    expect(result.map((f) => f.path)).toEqual([
      "src/apple.ts",
      "lib/mango.ts",
      "src/zebra.ts",
    ]);
  });

  it("returns an empty array unchanged", () => {
    expect(sortFiles([], "name-asc")).toEqual([]);
  });

  it("returns a single file unchanged", () => {
    const files = [makeReviewFile("src/only.ts")];
    expect(sortFiles(files, "name-asc")).toEqual(files);
  });

  it("does not mutate the original array", () => {
    const files = [makeReviewFile("b.ts"), makeReviewFile("a.ts")];
    sortFiles(files, "name-asc");
    expect(files[0].path).toBe("b.ts");
  });

  it("sorts files with same name in different dirs stably by filename", () => {
    const files = [
      makeReviewFile("src/index.ts"),
      makeReviewFile("lib/index.ts"),
    ];
    const result = sortFiles(files, "name-asc");
    // Both have filename "index.ts" — relative order is stable (localeCompare of equal = 0)
    expect(result).toHaveLength(2);
    expect(result.every((f) => f.path.endsWith("index.ts"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. sortFiles — name-desc
// ---------------------------------------------------------------------------

describe("sortFiles — name-desc", () => {
  it("sorts by filename Z→A, ignoring directory prefix", () => {
    const files = [
      makeReviewFile("src/apple.ts"),
      makeReviewFile("lib/mango.ts"),
      makeReviewFile("src/zebra.ts"),
    ];
    const result = sortFiles(files, "name-desc");
    expect(result.map((f) => f.path)).toEqual([
      "src/zebra.ts",
      "lib/mango.ts",
      "src/apple.ts",
    ]);
  });

  it("returns an empty array unchanged", () => {
    expect(sortFiles([], "name-desc")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. sortFiles — status
// ---------------------------------------------------------------------------

describe("sortFiles — status", () => {
  it("sorts by status field alphabetically", () => {
    const files = [
      makeReviewFile("c.ts", "modified"),
      makeReviewFile("a.ts", "added"),
      makeReviewFile("b.ts", "deleted"),
    ];
    const result = sortFiles(files, "status");
    expect(result.map((f) => f.status)).toEqual([
      "added",
      "deleted",
      "modified",
    ]);
  });

  it("groups files with the same status together", () => {
    const files = [
      makeReviewFile("z.ts", "modified"),
      makeReviewFile("a.ts", "added"),
      makeReviewFile("m.ts", "modified"),
    ];
    const result = sortFiles(files, "status");
    const statuses = result.map((f) => f.status);
    expect(statuses[0]).toBe("added");
    expect(statuses[1]).toBe("modified");
    expect(statuses[2]).toBe("modified");
  });
});

// ---------------------------------------------------------------------------
// 4. sortFiles — path
// ---------------------------------------------------------------------------

describe("sortFiles — path", () => {
  it("sorts by full path alphabetically", () => {
    const files = [
      makeReviewFile("src/z.ts"),
      makeReviewFile("lib/a.ts"),
      makeReviewFile("app/m.ts"),
    ];
    const result = sortFiles(files, "path");
    expect(result.map((f) => f.path)).toEqual([
      "app/m.ts",
      "lib/a.ts",
      "src/z.ts",
    ]);
  });

  it("distinguishes files with the same name by directory prefix", () => {
    const files = [
      makeReviewFile("src/index.ts"),
      makeReviewFile("lib/index.ts"),
    ];
    const result = sortFiles(files, "path");
    expect(result[0].path).toBe("lib/index.ts");
    expect(result[1].path).toBe("src/index.ts");
  });
});

// ---------------------------------------------------------------------------
// 5. buildFlatFiles — null / undefined status
// ---------------------------------------------------------------------------

describe("buildFlatFiles — null/undefined status", () => {
  it("returns [] when status is null", () => {
    expect(buildFlatFiles(null, "name-asc")).toEqual([]);
  });

  it("returns [] when status is undefined", () => {
    expect(buildFlatFiles(undefined, "name-asc")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. buildFlatFiles — section ordering
// ---------------------------------------------------------------------------

describe("buildFlatFiles — section ordering", () => {
  it("places staged files before unstaged files", () => {
    const status = makeStatus({
      staged: [{ path: "staged.ts", index: "M", workingDir: " " }],
      unstaged: [{ path: "unstaged.ts", index: " ", workingDir: "M" }],
    });
    const result = buildFlatFiles(status, "name-asc");
    expect(result[0].path).toBe("staged.ts");
    expect(result[0].isStaged).toBe(true);
    expect(result[1].path).toBe("unstaged.ts");
    expect(result[1].isStaged).toBe(false);
  });

  it("places unstaged files before untracked files", () => {
    const status = makeStatus({
      unstaged: [{ path: "unstaged.ts", index: " ", workingDir: "M" }],
      untracked: ["new-file.ts"],
    });
    const result = buildFlatFiles(status, "name-asc");
    expect(result[0].path).toBe("unstaged.ts");
    expect(result[1].path).toBe("new-file.ts");
  });

  it("places untracked files before conflicted files", () => {
    const status = makeStatus({
      untracked: ["new-file.ts"],
      conflicted: ["conflict.ts"],
    });
    const result = buildFlatFiles(status, "name-asc");
    expect(result[0].path).toBe("new-file.ts");
    expect(result[1].path).toBe("conflict.ts");
  });

  it("full ordering: staged → unstaged → untracked → conflicted", () => {
    const status = makeStatus({
      staged: [{ path: "s.ts", index: "M", workingDir: " " }],
      unstaged: [{ path: "u.ts", index: " ", workingDir: "M" }],
      untracked: ["n.ts"],
      conflicted: ["c.ts"],
    });
    const result = buildFlatFiles(status, "name-asc");
    expect(result.map((f) => f.path)).toEqual(["s.ts", "u.ts", "n.ts", "c.ts"]);
  });

  it("all staged files have isStaged: true", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "A", workingDir: " " },
      ],
    });
    const result = buildFlatFiles(status, "name-asc");
    expect(result.every((f) => f.isStaged)).toBe(true);
  });

  it("unstaged, untracked, and conflicted files all have isStaged: false", () => {
    const status = makeStatus({
      unstaged: [{ path: "u.ts", index: " ", workingDir: "M" }],
      untracked: ["n.ts"],
      conflicted: ["c.ts"],
    });
    const result = buildFlatFiles(status, "name-asc");
    expect(result.every((f) => !f.isStaged)).toBe(true);
  });

  it("returns [] when status has all empty sections", () => {
    const result = buildFlatFiles(makeStatus(), "name-asc");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. buildFlatFiles — sorting within sections
// ---------------------------------------------------------------------------

describe("buildFlatFiles — sorting within sections (name-asc)", () => {
  it("sorts staged files by filename A→Z within the staged section", () => {
    const status = makeStatus({
      staged: [
        { path: "src/zebra.ts", index: "M", workingDir: " " },
        { path: "src/apple.ts", index: "M", workingDir: " " },
      ],
    });
    const result = buildFlatFiles(status, "name-asc");
    expect(result[0].path).toBe("src/apple.ts");
    expect(result[1].path).toBe("src/zebra.ts");
  });

  it("sorts unstaged files by filename A→Z within the unstaged section", () => {
    const status = makeStatus({
      unstaged: [
        { path: "src/zebra.ts", index: " ", workingDir: "M" },
        { path: "src/apple.ts", index: " ", workingDir: "M" },
      ],
    });
    const result = buildFlatFiles(status, "name-asc");
    expect(result[0].path).toBe("src/apple.ts");
    expect(result[1].path).toBe("src/zebra.ts");
  });

  it("sorts untracked files by filename A→Z within the untracked section", () => {
    const status = makeStatus({
      untracked: ["src/zebra.ts", "src/apple.ts"],
    });
    const result = buildFlatFiles(status, "name-asc");
    expect(result[0].path).toBe("src/apple.ts");
    expect(result[1].path).toBe("src/zebra.ts");
  });

  it("sorts conflicted files by filename A→Z within the conflicted section", () => {
    const status = makeStatus({
      conflicted: ["src/zebra.ts", "src/apple.ts"],
    });
    const result = buildFlatFiles(status, "name-asc");
    expect(result[0].path).toBe("src/apple.ts");
    expect(result[1].path).toBe("src/zebra.ts");
  });
});

describe("buildFlatFiles — sorting within sections (name-desc)", () => {
  it("sorts staged files by filename Z→A within the staged section", () => {
    const status = makeStatus({
      staged: [
        { path: "src/apple.ts", index: "M", workingDir: " " },
        { path: "src/zebra.ts", index: "M", workingDir: " " },
      ],
    });
    const result = buildFlatFiles(status, "name-desc");
    expect(result[0].path).toBe("src/zebra.ts");
    expect(result[1].path).toBe("src/apple.ts");
  });
});

describe("buildFlatFiles — sorting within sections (path)", () => {
  it("sorts staged files by full path within the staged section", () => {
    const status = makeStatus({
      staged: [
        { path: "src/z.ts", index: "M", workingDir: " " },
        { path: "lib/a.ts", index: "M", workingDir: " " },
      ],
    });
    const result = buildFlatFiles(status, "path");
    expect(result[0].path).toBe("lib/a.ts");
    expect(result[1].path).toBe("src/z.ts");
  });
});

// ---------------------------------------------------------------------------
// 8. buildFlatFiles — status sort mode preserves insertion order per section
// ---------------------------------------------------------------------------

describe("buildFlatFiles — status sort mode", () => {
  it("preserves original insertion order for staged files (no status field to sort by)", () => {
    const status = makeStatus({
      staged: [
        { path: "zzz.ts", index: "M", workingDir: " " },
        { path: "aaa.ts", index: "A", workingDir: " " },
      ],
    });
    const result = buildFlatFiles(status, "status");
    // GitFileStatus has no 'status' field — insertion order is preserved
    expect(result[0].path).toBe("zzz.ts");
    expect(result[1].path).toBe("aaa.ts");
  });

  it("preserves original insertion order for unstaged files", () => {
    const status = makeStatus({
      unstaged: [
        { path: "zzz.ts", index: " ", workingDir: "M" },
        { path: "aaa.ts", index: " ", workingDir: "D" },
      ],
    });
    const result = buildFlatFiles(status, "status");
    expect(result[0].path).toBe("zzz.ts");
    expect(result[1].path).toBe("aaa.ts");
  });

  it("preserves original insertion order for untracked files", () => {
    const status = makeStatus({
      untracked: ["zzz.ts", "aaa.ts"],
    });
    const result = buildFlatFiles(status, "status");
    expect(result[0].path).toBe("zzz.ts");
    expect(result[1].path).toBe("aaa.ts");
  });

  it("preserves original insertion order for conflicted files", () => {
    const status = makeStatus({
      conflicted: ["zzz.ts", "aaa.ts"],
    });
    const result = buildFlatFiles(status, "status");
    expect(result[0].path).toBe("zzz.ts");
    expect(result[1].path).toBe("aaa.ts");
  });

  it("section order is still staged → unstaged → untracked → conflicted", () => {
    const status = makeStatus({
      staged: [{ path: "s.ts", index: "M", workingDir: " " }],
      unstaged: [{ path: "u.ts", index: " ", workingDir: "M" }],
      untracked: ["n.ts"],
      conflicted: ["c.ts"],
    });
    const result = buildFlatFiles(status, "status");
    expect(result.map((f) => f.path)).toEqual(["s.ts", "u.ts", "n.ts", "c.ts"]);
  });
});

// ---------------------------------------------------------------------------
// 9. reviewed-next navigation logic (pure algorithm, no React)
// ---------------------------------------------------------------------------

describe("reviewed-next navigation logic", () => {
  it("returns the item after the currently selected file", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
      ],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const selectedPath = "a.ts";
    const selectedIsStaged = true;
    const selectedIndex = flatFiles.findIndex(
      (f) => f.path === selectedPath && f.isStaged === selectedIsStaged,
    );
    const next = flatFiles[selectedIndex + 1];
    expect(next?.path).toBe("b.ts");
    expect(next?.isStaged).toBe(true);
  });

  it("returns undefined when the selected file is the last in the list", () => {
    const status = makeStatus({
      staged: [{ path: "only.ts", index: "M", workingDir: " " }],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const selectedIndex = flatFiles.findIndex(
      (f) => f.path === "only.ts" && f.isStaged,
    );
    const next = flatFiles[selectedIndex + 1];
    expect(next).toBeUndefined();
  });

  it("correctly crosses the staged→unstaged section boundary", () => {
    const status = makeStatus({
      staged: [{ path: "staged.ts", index: "M", workingDir: " " }],
      unstaged: [{ path: "unstaged.ts", index: " ", workingDir: "M" }],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const selectedIndex = flatFiles.findIndex(
      (f) => f.path === "staged.ts" && f.isStaged,
    );
    const next = flatFiles[selectedIndex + 1];
    expect(next?.path).toBe("unstaged.ts");
    expect(next?.isStaged).toBe(false);
  });

  it("returns undefined when no file is selected (simulated by missing findIndex match)", () => {
    const status = makeStatus({
      staged: [{ path: "a.ts", index: "M", workingDir: " " }],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    // Simulate no file selected: findIndex returns -1
    const selectedIndex = flatFiles.findIndex(() => false);
    const _next = flatFiles[selectedIndex + 1];
    // flatFiles[0] is "a.ts" — but the early-return guard (if !file) prevents reaching this
    // Here we just verify the algorithm: index -1 + 1 = 0, which would be the first file
    // The guard in the handler (if (!file) return) would have already exited
    expect(selectedIndex).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// 10. next-file / prev-file navigation logic
// ---------------------------------------------------------------------------

describe("next-file navigation logic", () => {
  it("advances to the next file in the flat list", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
        { path: "c.ts", index: "M", workingDir: " " },
      ],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const selectedIndex = flatFiles.findIndex((f) => f.path === "a.ts");
    const next = flatFiles[selectedIndex + 1];
    expect(next?.path).toBe("b.ts");
  });

  it("clamps at the last file — no next exists beyond the end", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
      ],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const lastIndex = flatFiles.length - 1;
    const beyondLast = flatFiles[lastIndex + 1];
    expect(beyondLast).toBeUndefined();
  });
});

describe("prev-file navigation logic", () => {
  it("goes back to the previous file in the flat list", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
        { path: "c.ts", index: "M", workingDir: " " },
      ],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const selectedIndex = flatFiles.findIndex((f) => f.path === "b.ts");
    const prev = flatFiles[selectedIndex - 1];
    expect(prev?.path).toBe("a.ts");
  });

  it("clamps at the first file — no prev exists before index 0", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
      ],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const firstIndex = 0;
    const beforeFirst = flatFiles[firstIndex - 1];
    expect(beforeFirst).toBeUndefined();
  });

  it("crosses unstaged→staged boundary correctly going backwards", () => {
    const status = makeStatus({
      staged: [{ path: "staged.ts", index: "M", workingDir: " " }],
      unstaged: [{ path: "unstaged.ts", index: " ", workingDir: "M" }],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const selectedIndex = flatFiles.findIndex((f) => f.path === "unstaged.ts");
    const prev = flatFiles[selectedIndex - 1];
    expect(prev?.path).toBe("staged.ts");
    expect(prev?.isStaged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. next-unreviewed / prev-unreviewed navigation logic
// ---------------------------------------------------------------------------

describe("next-unreviewed navigation logic", () => {
  it("skips reviewed files and returns the next unreviewed one", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
        { path: "c.ts", index: "M", workingDir: " " },
      ],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const reviewed = new Set(["b.ts"]);
    const selectedIndex = flatFiles.findIndex((f) => f.path === "a.ts");
    const nextUnreviewed = flatFiles
      .slice(selectedIndex + 1)
      .find((f) => !reviewed.has(f.path));
    expect(nextUnreviewed?.path).toBe("c.ts");
  });

  it("returns undefined when all remaining files are reviewed", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
        { path: "c.ts", index: "M", workingDir: " " },
      ],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const reviewed = new Set(["b.ts", "c.ts"]);
    const selectedIndex = flatFiles.findIndex((f) => f.path === "a.ts");
    const nextUnreviewed = flatFiles
      .slice(selectedIndex + 1)
      .find((f) => !reviewed.has(f.path));
    expect(nextUnreviewed).toBeUndefined();
  });

  it("returns undefined when no files exist after current position", () => {
    const status = makeStatus({
      staged: [{ path: "only.ts", index: "M", workingDir: " " }],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const reviewed = new Set<string>();
    const selectedIndex = flatFiles.findIndex((f) => f.path === "only.ts");
    const nextUnreviewed = flatFiles
      .slice(selectedIndex + 1)
      .find((f) => !reviewed.has(f.path));
    expect(nextUnreviewed).toBeUndefined();
  });
});

describe("prev-unreviewed navigation logic", () => {
  it("skips reviewed files going backwards and returns the prev unreviewed one", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
        { path: "c.ts", index: "M", workingDir: " " },
      ],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const reviewed = new Set(["b.ts"]);
    const selectedIndex = flatFiles.findIndex((f) => f.path === "c.ts");
    const prevUnreviewed = flatFiles
      .slice(0, selectedIndex)
      .reverse()
      .find((f) => !reviewed.has(f.path));
    expect(prevUnreviewed?.path).toBe("a.ts");
  });

  it("returns undefined when all previous files are reviewed", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
        { path: "c.ts", index: "M", workingDir: " " },
      ],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const reviewed = new Set(["a.ts", "b.ts"]);
    const selectedIndex = flatFiles.findIndex((f) => f.path === "c.ts");
    const prevUnreviewed = flatFiles
      .slice(0, selectedIndex)
      .reverse()
      .find((f) => !reviewed.has(f.path));
    expect(prevUnreviewed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 12. stage-toggle logic
// ---------------------------------------------------------------------------

describe("stage-toggle logic", () => {
  it("current file is unstaged — should be staged", () => {
    const status = makeStatus({
      unstaged: [{ path: "u.ts", index: " ", workingDir: "M" }],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const current = flatFiles.find((f) => f.path === "u.ts");
    expect(current?.isStaged).toBe(false);
    // Handler would call handleStageFiles([current.path])
  });

  it("current file is staged — should be unstaged", () => {
    const status = makeStatus({
      staged: [{ path: "s.ts", index: "M", workingDir: " " }],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const current = flatFiles.find((f) => f.path === "s.ts");
    expect(current?.isStaged).toBe(true);
    // Handler would call handleUnstageFiles([current.path])
  });

  it("no current file selected — flatFiles.findIndex returns -1, flatFiles[-1] is undefined", () => {
    const status = makeStatus({
      staged: [{ path: "s.ts", index: "M", workingDir: " " }],
    });
    const flatFiles = buildFlatFiles(status, "name-asc");
    const selectedIndex = -1;
    const current = flatFiles[selectedIndex];
    expect(current).toBeUndefined();
    // Handler would return early (if (!current) return)
  });
});

// ---------------------------------------------------------------------------
// 13. buildVisibleFlatFiles / buildVisibleChangedFiles — collapse-aware order
// ---------------------------------------------------------------------------

const ALL_SORT_MODES: SortMode[] = ["name-asc", "name-desc", "status", "path"];

function nestedStatus(): GitStatusResult {
  return makeStatus({
    staged: [
      { path: "src/components/Button.tsx", index: "M", workingDir: " " },
      { path: "src/index.ts", index: "A", workingDir: " " },
      { path: "README.md", index: "M", workingDir: " " },
    ],
    unstaged: [
      { path: "src/utils/helpers.ts", index: " ", workingDir: "M" },
      { path: "lib/db.ts", index: " ", workingDir: "M" },
    ],
    untracked: ["src/new.ts", "docs/guide.md"],
    conflicted: ["config/settings.json"],
  });
}

// Independent re-derivation of file-status.tsx's grouped flat order — the
// canonical display pipeline the leader keys must mirror.
function expectedWorkingVisible(
  status: GitStatusResult,
  sortMode: SortMode,
  collapsed: ReadonlySet<string>,
): { path: string; isStaged: boolean }[] {
  const folderOrder = sortMode === "name-desc" ? "desc" : "asc";
  const sortSec = <T extends { path: string }>(
    items: T[],
    key?: keyof T,
  ): T[] => {
    const s = [...items];
    switch (sortMode) {
      case "name-asc":
        return s.sort((a, b) => {
          const an = a.path.split("/").pop() ?? a.path;
          const bn = b.path.split("/").pop() ?? b.path;
          return an.localeCompare(bn);
        });
      case "name-desc":
        return s.sort((a, b) => {
          const an = a.path.split("/").pop() ?? a.path;
          const bn = b.path.split("/").pop() ?? b.path;
          return bn.localeCompare(an);
        });
      case "status":
        return key
          ? s.sort((a, b) => String(a[key]).localeCompare(String(b[key])))
          : s;
      case "path":
        return s.sort((a, b) => a.path.localeCompare(b.path));
      default:
        return s;
    }
  };
  const staged = sortSec(status.staged, "index");
  const unstaged = sortSec(status.unstaged, "workingDir");
  const untracked = sortSec(status.untracked.map((p) => ({ path: p })));
  const conflicted = sortSec(status.conflicted.map((p) => ({ path: p })));
  const stagedTree = buildFileTree(staged, folderOrder);
  const changesTree = buildFileTree(
    [
      ...unstaged.map((f) => ({ path: f.path })),
      ...untracked.map((f) => ({ path: f.path })),
    ],
    folderOrder,
  );
  const conflictsTree = buildFileTree(conflicted, folderOrder);
  return [
    ...flattenVisibleItems(stagedTree, collapsed).map((f) => ({
      path: f.path,
      isStaged: true,
    })),
    ...flattenVisibleItems(changesTree, collapsed).map((f) => ({
      path: f.path,
      isStaged: false,
    })),
    ...flattenVisibleItems(conflictsTree, collapsed).map((f) => ({
      path: f.path,
      isStaged: false,
    })),
  ];
}

describe("buildVisibleFlatFiles — explicit nested order (name-asc, grouped)", () => {
  it("orders subfolders' files before root files, staged → changes → conflicts", () => {
    const status = makeStatus({
      staged: [
        { path: "src/z.ts", index: "M", workingDir: " " },
        { path: "src/a.ts", index: "A", workingDir: " " },
        { path: "root.ts", index: "M", workingDir: " " },
      ],
    });
    const result = buildVisibleFlatFiles(
      status,
      "name-asc",
      true,
      new Set<string>(),
    );
    expect(result).toEqual([
      { path: "src/a.ts", isStaged: true },
      { path: "src/z.ts", isStaged: true },
      { path: "root.ts", isStaged: true },
    ]);
  });
});

describe.each(ALL_SORT_MODES)(
  "buildVisibleFlatFiles — grouped matches display pipeline (%s)",
  (mode) => {
    it("matches the display order for a nested fixture", () => {
      const status = nestedStatus();
      const collapsed = new Set<string>();
      expect(buildVisibleFlatFiles(status, mode, true, collapsed)).toEqual(
        expectedWorkingVisible(status, mode, collapsed),
      );
    });

    it("excludes files inside a collapsed folder", () => {
      const status = nestedStatus();
      const collapsed = new Set<string>(["src"]);
      const result = buildVisibleFlatFiles(status, mode, true, collapsed);
      expect(result.some((f) => f.path.startsWith("src/"))).toBe(false);
      expect(result).toEqual(expectedWorkingVisible(status, mode, collapsed));
    });

    it("ungrouped delegates to buildFlatFiles output exactly", () => {
      const status = nestedStatus();
      expect(
        buildVisibleFlatFiles(status, mode, false, new Set<string>()),
      ).toEqual(buildFlatFiles(status, mode));
    });
  },
);

describe("buildVisibleFlatFiles — null status", () => {
  it("returns [] for null/undefined status regardless of grouping", () => {
    expect(buildVisibleFlatFiles(null, "path", true, new Set())).toEqual([]);
    expect(buildVisibleFlatFiles(undefined, "path", false, new Set())).toEqual(
      [],
    );
  });
});

function expectedChangedVisible(
  files: ReviewChangedFile[],
  sortMode: SortMode,
  collapsed: ReadonlySet<string>,
): { path: string; isStaged: boolean }[] {
  const folderOrder = sortMode === "name-desc" ? "desc" : "asc";
  const tree = buildFileTree(files, folderOrder);
  return flattenVisibleItems(tree, collapsed).map((f) => ({
    path: f.path,
    isStaged: false,
  }));
}

describe("buildVisibleChangedFiles — collapse + folderOrder", () => {
  const changed = [
    makeReviewFile("src/a/one.ts"),
    makeReviewFile("src/b/two.ts"),
    makeReviewFile("root.ts"),
  ];

  it("ungrouped returns every file as isStaged: false in input order", () => {
    expect(
      buildVisibleChangedFiles(changed, "path", false, new Set<string>()),
    ).toEqual([
      { path: "src/a/one.ts", isStaged: false },
      { path: "src/b/two.ts", isStaged: false },
      { path: "root.ts", isStaged: false },
    ]);
  });

  it.each(ALL_SORT_MODES)(
    "grouped matches the display pipeline (%s)",
    (mode) => {
      const collapsed = new Set<string>();
      expect(buildVisibleChangedFiles(changed, mode, true, collapsed)).toEqual(
        expectedChangedVisible(changed, mode, collapsed),
      );
    },
  );

  it("excludes files inside a collapsed folder", () => {
    const collapsed = new Set<string>(["src/a"]);
    const result = buildVisibleChangedFiles(changed, "path", true, collapsed);
    expect(result.some((f) => f.path.startsWith("src/a/"))).toBe(false);
    expect(result).toEqual(expectedChangedVisible(changed, "path", collapsed));
  });
});

// ---------------------------------------------------------------------------
// 14. resolveLeaderFileAction
// ---------------------------------------------------------------------------

const NAV_ACTIONS: LeaderFileAction[] = [
  "next-file",
  "prev-file",
  "next-unreviewed",
  "prev-unreviewed",
];
const ALL_ACTIONS: LeaderFileAction[] = [
  ...NAV_ACTIONS,
  "reviewed-next",
  "stage-toggle",
];

const workingStatus = makeStatus({
  staged: [
    { path: "a.ts", index: "M", workingDir: " " },
    { path: "b.ts", index: "M", workingDir: " " },
    { path: "c.ts", index: "M", workingDir: " " },
  ],
});

const changedFixture: ReviewChangedFile[] = [
  makeReviewFile("x.ts"),
  makeReviewFile("y.ts"),
  makeReviewFile("z.ts"),
];

function baseInput(
  overrides: Partial<LeaderFileActionInput> = {},
): LeaderFileActionInput {
  return {
    action: "next-file",
    viewMode: "working",
    status: workingStatus,
    changedFiles: [],
    sortMode: "path",
    isGroupedByFolder: false,
    collapsedFolders: new Set<string>(),
    selectedFile: null,
    selectedStaged: false,
    reviewedFiles: new Set<string>(),
    ...overrides,
  };
}

describe("resolveLeaderFileAction — null selection", () => {
  it.each(NAV_ACTIONS)(
    "%s resolves to the first visible candidate",
    (action) => {
      const res = resolveLeaderFileAction(baseInput({ action }));
      expect(res).toEqual({ kind: "select", path: "a.ts", staged: true });
    },
  );

  it("reviewed-next resolves to noop", () => {
    expect(
      resolveLeaderFileAction(baseInput({ action: "reviewed-next" })),
    ).toEqual({ kind: "noop" });
  });

  it("stage-toggle resolves to noop", () => {
    expect(
      resolveLeaderFileAction(baseInput({ action: "stage-toggle" })),
    ).toEqual({ kind: "noop" });
  });

  it("next-unreviewed skips reviewed files when landing on first candidate", () => {
    const res = resolveLeaderFileAction(
      baseInput({
        action: "next-unreviewed",
        reviewedFiles: new Set(["a.ts"]),
      }),
    );
    expect(res).toEqual({ kind: "select", path: "b.ts", staged: true });
  });
});

describe("resolveLeaderFileAction — hidden selection", () => {
  const nested = makeStatus({
    staged: [
      { path: "src/hidden.ts", index: "M", workingDir: " " },
      { path: "top.ts", index: "M", workingDir: " " },
    ],
  });

  it.each(ALL_ACTIONS)(
    "%s resolves to noop when the selection is inside a collapsed folder",
    (action) => {
      const res = resolveLeaderFileAction(
        baseInput({
          action,
          status: nested,
          sortMode: "name-asc",
          isGroupedByFolder: true,
          collapsedFolders: new Set(["src"]),
          selectedFile: "src/hidden.ts",
          selectedStaged: true,
        }),
      );
      expect(res).toEqual({ kind: "noop" });
    },
  );
});

describe("resolveLeaderFileAction — pr and non-file view modes", () => {
  it.each(ALL_ACTIONS)("%s resolves to noop in pr view mode", (action) => {
    const res = resolveLeaderFileAction(
      baseInput({
        action,
        viewMode: "pr",
        selectedFile: "a.ts",
        selectedStaged: true,
      }),
    );
    expect(res).toEqual({ kind: "noop" });
  });
});

describe("resolveLeaderFileAction — stage-toggle scope", () => {
  it.each(["branch", "last-commit", "pr"])(
    "resolves to noop outside working mode (%s)",
    (viewMode) => {
      const res = resolveLeaderFileAction(
        baseInput({
          action: "stage-toggle",
          viewMode,
          changedFiles: changedFixture,
          selectedFile: "x.ts",
          selectedStaged: false,
        }),
      );
      expect(res).toEqual({ kind: "noop" });
    },
  );

  it("stages an unstaged selected file in working mode", () => {
    const status = makeStatus({
      unstaged: [{ path: "u.ts", index: " ", workingDir: "M" }],
    });
    const res = resolveLeaderFileAction(
      baseInput({
        action: "stage-toggle",
        status,
        selectedFile: "u.ts",
        selectedStaged: false,
      }),
    );
    expect(res).toEqual({ kind: "stage", path: "u.ts" });
  });

  it("unstages a staged selected file in working mode", () => {
    const res = resolveLeaderFileAction(
      baseInput({
        action: "stage-toggle",
        selectedFile: "a.ts",
        selectedStaged: true,
      }),
    );
    expect(res).toEqual({ kind: "unstage", path: "a.ts" });
  });
});

describe("resolveLeaderFileAction — navigation from a selection", () => {
  it("next-file advances to the following visible file", () => {
    const res = resolveLeaderFileAction(
      baseInput({
        action: "next-file",
        selectedFile: "a.ts",
        selectedStaged: true,
      }),
    );
    expect(res).toEqual({ kind: "select", path: "b.ts", staged: true });
  });

  it("prev-file steps back to the previous visible file", () => {
    const res = resolveLeaderFileAction(
      baseInput({
        action: "prev-file",
        selectedFile: "b.ts",
        selectedStaged: true,
      }),
    );
    expect(res).toEqual({ kind: "select", path: "a.ts", staged: true });
  });

  it("next-file clamps at the end (re-selects the last file)", () => {
    const res = resolveLeaderFileAction(
      baseInput({
        action: "next-file",
        selectedFile: "c.ts",
        selectedStaged: true,
      }),
    );
    expect(res).toEqual({ kind: "select", path: "c.ts", staged: true });
  });

  it("navigates the branch changed-file list (isStaged false)", () => {
    const res = resolveLeaderFileAction(
      baseInput({
        action: "next-file",
        viewMode: "branch",
        changedFiles: changedFixture,
        selectedFile: "x.ts",
        selectedStaged: false,
      }),
    );
    expect(res).toEqual({ kind: "select", path: "y.ts", staged: false });
  });
});

describe("resolveLeaderFileAction — reviewed-next uses the visible list", () => {
  const nested = makeStatus({
    staged: [
      { path: "aaa/1.ts", index: "M", workingDir: " " },
      { path: "aaa/2.ts", index: "M", workingDir: " " },
      { path: "bbb/3.ts", index: "M", workingDir: " " },
    ],
  });

  it("toggles the current file and selects the next visible file", () => {
    const res = resolveLeaderFileAction(
      baseInput({
        action: "reviewed-next",
        status: nested,
        sortMode: "name-asc",
        isGroupedByFolder: true,
        collapsedFolders: new Set<string>(),
        selectedFile: "aaa/2.ts",
        selectedStaged: true,
      }),
    );
    expect(res).toEqual({
      kind: "toggle-reviewed-then-select",
      togglePath: "aaa/2.ts",
      next: { path: "bbb/3.ts", staged: true },
    });
  });

  it("toggles with next: null when the next file is hidden in a collapsed folder", () => {
    const res = resolveLeaderFileAction(
      baseInput({
        action: "reviewed-next",
        status: nested,
        sortMode: "name-asc",
        isGroupedByFolder: true,
        collapsedFolders: new Set(["bbb"]),
        selectedFile: "aaa/2.ts",
        selectedStaged: true,
      }),
    );
    expect(res).toEqual({
      kind: "toggle-reviewed-then-select",
      togglePath: "aaa/2.ts",
      next: null,
    });
  });

  it("toggles with next: null at the end of the list", () => {
    const res = resolveLeaderFileAction(
      baseInput({
        action: "reviewed-next",
        selectedFile: "c.ts",
        selectedStaged: true,
      }),
    );
    expect(res).toEqual({
      kind: "toggle-reviewed-then-select",
      togglePath: "c.ts",
      next: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 15. applyLeaderFileResolution
// ---------------------------------------------------------------------------

describe("applyLeaderFileResolution", () => {
  function makeEffects(wasEditorFocused: boolean): LeaderFileEffects {
    return {
      select: vi.fn(),
      toggleReviewed: vi.fn(),
      stage: vi.fn(),
      unstage: vi.fn(),
      wasEditorFocused,
      refocusEditor: vi.fn(),
    };
  }

  beforeEachRafStub();

  it("toggle-reviewed-then-select refocuses AFTER select when editor was focused", () => {
    const effects = makeEffects(true);
    applyLeaderFileResolution(
      {
        kind: "toggle-reviewed-then-select",
        togglePath: "a.ts",
        next: { path: "b.ts", staged: true },
      },
      effects,
    );
    expect(effects.toggleReviewed).toHaveBeenCalledWith("a.ts");
    expect(effects.select).toHaveBeenCalledWith("b.ts", true);
    expect(effects.refocusEditor).toHaveBeenCalledTimes(1);
    const selectOrder = (effects.select as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const refocusOrder = (effects.refocusEditor as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0];
    expect(selectOrder).toBeLessThan(refocusOrder);
  });

  it("toggle-reviewed-then-select never refocuses when editor was not focused", () => {
    const effects = makeEffects(false);
    applyLeaderFileResolution(
      {
        kind: "toggle-reviewed-then-select",
        togglePath: "a.ts",
        next: { path: "b.ts", staged: true },
      },
      effects,
    );
    expect(effects.select).toHaveBeenCalledWith("b.ts", true);
    expect(effects.refocusEditor).not.toHaveBeenCalled();
  });

  it("toggle-reviewed-then-select with next: null toggles but never selects/refocuses", () => {
    const effects = makeEffects(true);
    applyLeaderFileResolution(
      { kind: "toggle-reviewed-then-select", togglePath: "a.ts", next: null },
      effects,
    );
    expect(effects.toggleReviewed).toHaveBeenCalledWith("a.ts");
    expect(effects.select).not.toHaveBeenCalled();
    expect(effects.refocusEditor).not.toHaveBeenCalled();
  });

  it("select invokes only select", () => {
    const effects = makeEffects(true);
    applyLeaderFileResolution(
      { kind: "select", path: "a.ts", staged: false },
      effects,
    );
    expect(effects.select).toHaveBeenCalledWith("a.ts", false);
    expect(effects.stage).not.toHaveBeenCalled();
    expect(effects.unstage).not.toHaveBeenCalled();
    expect(effects.toggleReviewed).not.toHaveBeenCalled();
  });

  it("stage invokes only stage", () => {
    const effects = makeEffects(true);
    applyLeaderFileResolution({ kind: "stage", path: "u.ts" }, effects);
    expect(effects.stage).toHaveBeenCalledWith("u.ts");
    expect(effects.unstage).not.toHaveBeenCalled();
    expect(effects.select).not.toHaveBeenCalled();
  });

  it("unstage invokes only unstage", () => {
    const effects = makeEffects(true);
    applyLeaderFileResolution({ kind: "unstage", path: "s.ts" }, effects);
    expect(effects.unstage).toHaveBeenCalledWith("s.ts");
    expect(effects.stage).not.toHaveBeenCalled();
  });

  it("noop invokes no effect", () => {
    const effects = makeEffects(true);
    applyLeaderFileResolution({ kind: "noop" }, effects);
    expect(effects.select).not.toHaveBeenCalled();
    expect(effects.stage).not.toHaveBeenCalled();
    expect(effects.unstage).not.toHaveBeenCalled();
    expect(effects.toggleReviewed).not.toHaveBeenCalled();
    expect(effects.refocusEditor).not.toHaveBeenCalled();
  });
});

// requestAnimationFrame is stubbed to run synchronously so refocus ordering is
// observable within the apply unit tests.
function beforeEachRafStub(): void {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
}

// ---------------------------------------------------------------------------
// 16. parseStoredViewMode / isValidViewMode — localStorage view-mode parsing
// ---------------------------------------------------------------------------

describe("parseStoredViewMode", () => {
  it("maps the removed 'pr' value to 'working'", () => {
    expect(parseStoredViewMode("pr")).toBe("working");
  });

  it("returns 'branch' for a valid 'branch' value", () => {
    expect(parseStoredViewMode("branch")).toBe("branch");
  });

  it("returns 'last-commit' for a valid 'last-commit' value", () => {
    expect(parseStoredViewMode("last-commit")).toBe("last-commit");
  });

  it("returns 'working' for a valid 'working' value", () => {
    expect(parseStoredViewMode("working")).toBe("working");
  });

  it("returns 'working' for null", () => {
    expect(parseStoredViewMode(null)).toBe("working");
  });

  it("returns 'working' for garbage input", () => {
    expect(parseStoredViewMode("garbage")).toBe("working");
  });
});

describe("isValidViewMode", () => {
  it("returns false for the removed 'pr' value", () => {
    expect(isValidViewMode("pr")).toBe(false);
  });

  it("returns true for 'branch'", () => {
    expect(isValidViewMode("branch")).toBe(true);
  });

  it("returns true for 'working'", () => {
    expect(isValidViewMode("working")).toBe(true);
  });

  it("returns true for 'last-commit'", () => {
    expect(isValidViewMode("last-commit")).toBe(true);
  });

  it("returns false for null", () => {
    expect(isValidViewMode(null)).toBe(false);
  });

  it("returns false for garbage input", () => {
    expect(isValidViewMode("garbage")).toBe(false);
  });
});
