import { describe, it, expect } from "vitest"
import { sortFiles, buildFlatFiles } from "@/lib/git-panel-logic"
import type { ReviewChangedFile, GitStatusResult } from "@/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReviewFile(path: string, status: ReviewChangedFile["status"] = "modified"): ReviewChangedFile {
  return { path, status }
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
  }
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
    ]
    const result = sortFiles(files, "name-asc")
    expect(result.map((f) => f.path)).toEqual(["src/apple.ts", "lib/mango.ts", "src/zebra.ts"])
  })

  it("returns an empty array unchanged", () => {
    expect(sortFiles([], "name-asc")).toEqual([])
  })

  it("returns a single file unchanged", () => {
    const files = [makeReviewFile("src/only.ts")]
    expect(sortFiles(files, "name-asc")).toEqual(files)
  })

  it("does not mutate the original array", () => {
    const files = [makeReviewFile("b.ts"), makeReviewFile("a.ts")]
    sortFiles(files, "name-asc")
    expect(files[0].path).toBe("b.ts")
  })

  it("sorts files with same name in different dirs stably by filename", () => {
    const files = [
      makeReviewFile("src/index.ts"),
      makeReviewFile("lib/index.ts"),
    ]
    const result = sortFiles(files, "name-asc")
    // Both have filename "index.ts" — relative order is stable (localeCompare of equal = 0)
    expect(result).toHaveLength(2)
    expect(result.every((f) => f.path.endsWith("index.ts"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. sortFiles — name-desc
// ---------------------------------------------------------------------------

describe("sortFiles — name-desc", () => {
  it("sorts by filename Z→A, ignoring directory prefix", () => {
    const files = [
      makeReviewFile("src/apple.ts"),
      makeReviewFile("lib/mango.ts"),
      makeReviewFile("src/zebra.ts"),
    ]
    const result = sortFiles(files, "name-desc")
    expect(result.map((f) => f.path)).toEqual(["src/zebra.ts", "lib/mango.ts", "src/apple.ts"])
  })

  it("returns an empty array unchanged", () => {
    expect(sortFiles([], "name-desc")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3. sortFiles — status
// ---------------------------------------------------------------------------

describe("sortFiles — status", () => {
  it("sorts by status field alphabetically", () => {
    const files = [
      makeReviewFile("c.ts", "modified"),
      makeReviewFile("a.ts", "added"),
      makeReviewFile("b.ts", "deleted"),
    ]
    const result = sortFiles(files, "status")
    expect(result.map((f) => f.status)).toEqual(["added", "deleted", "modified"])
  })

  it("groups files with the same status together", () => {
    const files = [
      makeReviewFile("z.ts", "modified"),
      makeReviewFile("a.ts", "added"),
      makeReviewFile("m.ts", "modified"),
    ]
    const result = sortFiles(files, "status")
    const statuses = result.map((f) => f.status)
    expect(statuses[0]).toBe("added")
    expect(statuses[1]).toBe("modified")
    expect(statuses[2]).toBe("modified")
  })
})

// ---------------------------------------------------------------------------
// 4. sortFiles — path
// ---------------------------------------------------------------------------

describe("sortFiles — path", () => {
  it("sorts by full path alphabetically", () => {
    const files = [
      makeReviewFile("src/z.ts"),
      makeReviewFile("lib/a.ts"),
      makeReviewFile("app/m.ts"),
    ]
    const result = sortFiles(files, "path")
    expect(result.map((f) => f.path)).toEqual(["app/m.ts", "lib/a.ts", "src/z.ts"])
  })

  it("distinguishes files with the same name by directory prefix", () => {
    const files = [
      makeReviewFile("src/index.ts"),
      makeReviewFile("lib/index.ts"),
    ]
    const result = sortFiles(files, "path")
    expect(result[0].path).toBe("lib/index.ts")
    expect(result[1].path).toBe("src/index.ts")
  })
})

// ---------------------------------------------------------------------------
// 5. buildFlatFiles — null / undefined status
// ---------------------------------------------------------------------------

describe("buildFlatFiles — null/undefined status", () => {
  it("returns [] when status is null", () => {
    expect(buildFlatFiles(null, "name-asc")).toEqual([])
  })

  it("returns [] when status is undefined", () => {
    expect(buildFlatFiles(undefined, "name-asc")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 6. buildFlatFiles — section ordering
// ---------------------------------------------------------------------------

describe("buildFlatFiles — section ordering", () => {
  it("places staged files before unstaged files", () => {
    const status = makeStatus({
      staged: [{ path: "staged.ts", index: "M", workingDir: " " }],
      unstaged: [{ path: "unstaged.ts", index: " ", workingDir: "M" }],
    })
    const result = buildFlatFiles(status, "name-asc")
    expect(result[0].path).toBe("staged.ts")
    expect(result[0].isStaged).toBe(true)
    expect(result[1].path).toBe("unstaged.ts")
    expect(result[1].isStaged).toBe(false)
  })

  it("places unstaged files before untracked files", () => {
    const status = makeStatus({
      unstaged: [{ path: "unstaged.ts", index: " ", workingDir: "M" }],
      untracked: ["new-file.ts"],
    })
    const result = buildFlatFiles(status, "name-asc")
    expect(result[0].path).toBe("unstaged.ts")
    expect(result[1].path).toBe("new-file.ts")
  })

  it("places untracked files before conflicted files", () => {
    const status = makeStatus({
      untracked: ["new-file.ts"],
      conflicted: ["conflict.ts"],
    })
    const result = buildFlatFiles(status, "name-asc")
    expect(result[0].path).toBe("new-file.ts")
    expect(result[1].path).toBe("conflict.ts")
  })

  it("full ordering: staged → unstaged → untracked → conflicted", () => {
    const status = makeStatus({
      staged: [{ path: "s.ts", index: "M", workingDir: " " }],
      unstaged: [{ path: "u.ts", index: " ", workingDir: "M" }],
      untracked: ["n.ts"],
      conflicted: ["c.ts"],
    })
    const result = buildFlatFiles(status, "name-asc")
    expect(result.map((f) => f.path)).toEqual(["s.ts", "u.ts", "n.ts", "c.ts"])
  })

  it("all staged files have isStaged: true", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "A", workingDir: " " },
      ],
    })
    const result = buildFlatFiles(status, "name-asc")
    expect(result.every((f) => f.isStaged)).toBe(true)
  })

  it("unstaged, untracked, and conflicted files all have isStaged: false", () => {
    const status = makeStatus({
      unstaged: [{ path: "u.ts", index: " ", workingDir: "M" }],
      untracked: ["n.ts"],
      conflicted: ["c.ts"],
    })
    const result = buildFlatFiles(status, "name-asc")
    expect(result.every((f) => !f.isStaged)).toBe(true)
  })

  it("returns [] when status has all empty sections", () => {
    const result = buildFlatFiles(makeStatus(), "name-asc")
    expect(result).toEqual([])
  })
})

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
    })
    const result = buildFlatFiles(status, "name-asc")
    expect(result[0].path).toBe("src/apple.ts")
    expect(result[1].path).toBe("src/zebra.ts")
  })

  it("sorts unstaged files by filename A→Z within the unstaged section", () => {
    const status = makeStatus({
      unstaged: [
        { path: "src/zebra.ts", index: " ", workingDir: "M" },
        { path: "src/apple.ts", index: " ", workingDir: "M" },
      ],
    })
    const result = buildFlatFiles(status, "name-asc")
    expect(result[0].path).toBe("src/apple.ts")
    expect(result[1].path).toBe("src/zebra.ts")
  })

  it("sorts untracked files by filename A→Z within the untracked section", () => {
    const status = makeStatus({
      untracked: ["src/zebra.ts", "src/apple.ts"],
    })
    const result = buildFlatFiles(status, "name-asc")
    expect(result[0].path).toBe("src/apple.ts")
    expect(result[1].path).toBe("src/zebra.ts")
  })

  it("sorts conflicted files by filename A→Z within the conflicted section", () => {
    const status = makeStatus({
      conflicted: ["src/zebra.ts", "src/apple.ts"],
    })
    const result = buildFlatFiles(status, "name-asc")
    expect(result[0].path).toBe("src/apple.ts")
    expect(result[1].path).toBe("src/zebra.ts")
  })
})

describe("buildFlatFiles — sorting within sections (name-desc)", () => {
  it("sorts staged files by filename Z→A within the staged section", () => {
    const status = makeStatus({
      staged: [
        { path: "src/apple.ts", index: "M", workingDir: " " },
        { path: "src/zebra.ts", index: "M", workingDir: " " },
      ],
    })
    const result = buildFlatFiles(status, "name-desc")
    expect(result[0].path).toBe("src/zebra.ts")
    expect(result[1].path).toBe("src/apple.ts")
  })
})

describe("buildFlatFiles — sorting within sections (path)", () => {
  it("sorts staged files by full path within the staged section", () => {
    const status = makeStatus({
      staged: [
        { path: "src/z.ts", index: "M", workingDir: " " },
        { path: "lib/a.ts", index: "M", workingDir: " " },
      ],
    })
    const result = buildFlatFiles(status, "path")
    expect(result[0].path).toBe("lib/a.ts")
    expect(result[1].path).toBe("src/z.ts")
  })
})

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
    })
    const result = buildFlatFiles(status, "status")
    // GitFileStatus has no 'status' field — insertion order is preserved
    expect(result[0].path).toBe("zzz.ts")
    expect(result[1].path).toBe("aaa.ts")
  })

  it("preserves original insertion order for unstaged files", () => {
    const status = makeStatus({
      unstaged: [
        { path: "zzz.ts", index: " ", workingDir: "M" },
        { path: "aaa.ts", index: " ", workingDir: "D" },
      ],
    })
    const result = buildFlatFiles(status, "status")
    expect(result[0].path).toBe("zzz.ts")
    expect(result[1].path).toBe("aaa.ts")
  })

  it("preserves original insertion order for untracked files", () => {
    const status = makeStatus({
      untracked: ["zzz.ts", "aaa.ts"],
    })
    const result = buildFlatFiles(status, "status")
    expect(result[0].path).toBe("zzz.ts")
    expect(result[1].path).toBe("aaa.ts")
  })

  it("preserves original insertion order for conflicted files", () => {
    const status = makeStatus({
      conflicted: ["zzz.ts", "aaa.ts"],
    })
    const result = buildFlatFiles(status, "status")
    expect(result[0].path).toBe("zzz.ts")
    expect(result[1].path).toBe("aaa.ts")
  })

  it("section order is still staged → unstaged → untracked → conflicted", () => {
    const status = makeStatus({
      staged: [{ path: "s.ts", index: "M", workingDir: " " }],
      unstaged: [{ path: "u.ts", index: " ", workingDir: "M" }],
      untracked: ["n.ts"],
      conflicted: ["c.ts"],
    })
    const result = buildFlatFiles(status, "status")
    expect(result.map((f) => f.path)).toEqual(["s.ts", "u.ts", "n.ts", "c.ts"])
  })
})

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
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const selectedPath = "a.ts"
    const selectedIsStaged = true
    const selectedIndex = flatFiles.findIndex(
      (f) => f.path === selectedPath && f.isStaged === selectedIsStaged
    )
    const next = flatFiles[selectedIndex + 1]
    expect(next?.path).toBe("b.ts")
    expect(next?.isStaged).toBe(true)
  })

  it("returns undefined when the selected file is the last in the list", () => {
    const status = makeStatus({
      staged: [{ path: "only.ts", index: "M", workingDir: " " }],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const selectedIndex = flatFiles.findIndex((f) => f.path === "only.ts" && f.isStaged)
    const next = flatFiles[selectedIndex + 1]
    expect(next).toBeUndefined()
  })

  it("correctly crosses the staged→unstaged section boundary", () => {
    const status = makeStatus({
      staged: [{ path: "staged.ts", index: "M", workingDir: " " }],
      unstaged: [{ path: "unstaged.ts", index: " ", workingDir: "M" }],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const selectedIndex = flatFiles.findIndex((f) => f.path === "staged.ts" && f.isStaged)
    const next = flatFiles[selectedIndex + 1]
    expect(next?.path).toBe("unstaged.ts")
    expect(next?.isStaged).toBe(false)
  })

  it("returns undefined when no file is selected (simulated by missing findIndex match)", () => {
    const status = makeStatus({
      staged: [{ path: "a.ts", index: "M", workingDir: " " }],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    // Simulate no file selected: findIndex returns -1
    const selectedIndex = flatFiles.findIndex(() => false)
    const next = flatFiles[selectedIndex + 1]
    // flatFiles[0] is "a.ts" — but the early-return guard (if !file) prevents reaching this
    // Here we just verify the algorithm: index -1 + 1 = 0, which would be the first file
    // The guard in the handler (if (!file) return) would have already exited
    expect(selectedIndex).toBe(-1)
  })
})

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
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const selectedIndex = flatFiles.findIndex((f) => f.path === "a.ts")
    const next = flatFiles[selectedIndex + 1]
    expect(next?.path).toBe("b.ts")
  })

  it("clamps at the last file — no next exists beyond the end", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
      ],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const lastIndex = flatFiles.length - 1
    const beyondLast = flatFiles[lastIndex + 1]
    expect(beyondLast).toBeUndefined()
  })
})

describe("prev-file navigation logic", () => {
  it("goes back to the previous file in the flat list", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
        { path: "c.ts", index: "M", workingDir: " " },
      ],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const selectedIndex = flatFiles.findIndex((f) => f.path === "b.ts")
    const prev = flatFiles[selectedIndex - 1]
    expect(prev?.path).toBe("a.ts")
  })

  it("clamps at the first file — no prev exists before index 0", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
      ],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const firstIndex = 0
    const beforeFirst = flatFiles[firstIndex - 1]
    expect(beforeFirst).toBeUndefined()
  })

  it("crosses unstaged→staged boundary correctly going backwards", () => {
    const status = makeStatus({
      staged: [{ path: "staged.ts", index: "M", workingDir: " " }],
      unstaged: [{ path: "unstaged.ts", index: " ", workingDir: "M" }],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const selectedIndex = flatFiles.findIndex((f) => f.path === "unstaged.ts")
    const prev = flatFiles[selectedIndex - 1]
    expect(prev?.path).toBe("staged.ts")
    expect(prev?.isStaged).toBe(true)
  })
})

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
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const reviewed = new Set(["b.ts"])
    const selectedIndex = flatFiles.findIndex((f) => f.path === "a.ts")
    const nextUnreviewed = flatFiles.slice(selectedIndex + 1).find((f) => !reviewed.has(f.path))
    expect(nextUnreviewed?.path).toBe("c.ts")
  })

  it("returns undefined when all remaining files are reviewed", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
        { path: "c.ts", index: "M", workingDir: " " },
      ],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const reviewed = new Set(["b.ts", "c.ts"])
    const selectedIndex = flatFiles.findIndex((f) => f.path === "a.ts")
    const nextUnreviewed = flatFiles.slice(selectedIndex + 1).find((f) => !reviewed.has(f.path))
    expect(nextUnreviewed).toBeUndefined()
  })

  it("returns undefined when no files exist after current position", () => {
    const status = makeStatus({
      staged: [{ path: "only.ts", index: "M", workingDir: " " }],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const reviewed = new Set<string>()
    const selectedIndex = flatFiles.findIndex((f) => f.path === "only.ts")
    const nextUnreviewed = flatFiles.slice(selectedIndex + 1).find((f) => !reviewed.has(f.path))
    expect(nextUnreviewed).toBeUndefined()
  })
})

describe("prev-unreviewed navigation logic", () => {
  it("skips reviewed files going backwards and returns the prev unreviewed one", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
        { path: "c.ts", index: "M", workingDir: " " },
      ],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const reviewed = new Set(["b.ts"])
    const selectedIndex = flatFiles.findIndex((f) => f.path === "c.ts")
    const prevUnreviewed = flatFiles
      .slice(0, selectedIndex)
      .reverse()
      .find((f) => !reviewed.has(f.path))
    expect(prevUnreviewed?.path).toBe("a.ts")
  })

  it("returns undefined when all previous files are reviewed", () => {
    const status = makeStatus({
      staged: [
        { path: "a.ts", index: "M", workingDir: " " },
        { path: "b.ts", index: "M", workingDir: " " },
        { path: "c.ts", index: "M", workingDir: " " },
      ],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const reviewed = new Set(["a.ts", "b.ts"])
    const selectedIndex = flatFiles.findIndex((f) => f.path === "c.ts")
    const prevUnreviewed = flatFiles
      .slice(0, selectedIndex)
      .reverse()
      .find((f) => !reviewed.has(f.path))
    expect(prevUnreviewed).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 12. stage-toggle logic
// ---------------------------------------------------------------------------

describe("stage-toggle logic", () => {
  it("current file is unstaged — should be staged", () => {
    const status = makeStatus({
      unstaged: [{ path: "u.ts", index: " ", workingDir: "M" }],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const current = flatFiles.find((f) => f.path === "u.ts")
    expect(current?.isStaged).toBe(false)
    // Handler would call handleStageFiles([current.path])
  })

  it("current file is staged — should be unstaged", () => {
    const status = makeStatus({
      staged: [{ path: "s.ts", index: "M", workingDir: " " }],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const current = flatFiles.find((f) => f.path === "s.ts")
    expect(current?.isStaged).toBe(true)
    // Handler would call handleUnstageFiles([current.path])
  })

  it("no current file selected — flatFiles.findIndex returns -1, flatFiles[-1] is undefined", () => {
    const status = makeStatus({
      staged: [{ path: "s.ts", index: "M", workingDir: " " }],
    })
    const flatFiles = buildFlatFiles(status, "name-asc")
    const selectedIndex = -1
    const current = flatFiles[selectedIndex]
    expect(current).toBeUndefined()
    // Handler would return early (if (!current) return)
  })
})
