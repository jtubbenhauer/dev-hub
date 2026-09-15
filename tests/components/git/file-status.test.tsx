import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileStatusList } from "@/components/git/file-status";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { GitFileStatus } from "@/types";

function staged(path: string): GitFileStatus {
  return { path, index: "M", workingDir: " " };
}

function unstaged(path: string): GitFileStatus {
  return { path, index: " ", workingDir: "M" };
}

interface RenderOptions {
  staged?: GitFileStatus[];
  unstaged?: GitFileStatus[];
  untracked?: string[];
  conflicted?: string[];
  selectedFile?: string | null;
  selectedStaged?: boolean;
  isGroupedByFolder?: boolean;
  collapsedFolders?: Set<string>;
  onSelectFile?: (file: string, isStaged: boolean) => void;
  onStageFiles?: (files: string[]) => void;
  onToggleFolder?: (path: string) => void;
}

function renderList(options: RenderOptions = {}) {
  const {
    staged: stagedFiles = [],
    unstaged: unstagedFiles = [],
    untracked = [],
    conflicted = [],
    selectedFile = null,
    selectedStaged = false,
    isGroupedByFolder = true,
    collapsedFolders = new Set<string>(),
    onSelectFile = vi.fn(),
    onStageFiles = vi.fn(),
    onToggleFolder = vi.fn(),
  } = options;

  render(
    <TooltipProvider>
      <FileStatusList
        staged={stagedFiles}
        unstaged={unstagedFiles}
        untracked={untracked}
        conflicted={conflicted}
        selectedFile={selectedFile}
        selectedStaged={selectedStaged}
        reviewedFiles={new Set()}
        sortMode="path"
        isGroupedByFolder={isGroupedByFolder}
        collapsedFolders={collapsedFolders}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
        onStageFiles={onStageFiles}
        onUnstageFiles={vi.fn()}
        onStageAll={vi.fn()}
        onUnstageAll={vi.fn()}
        onDiscardFiles={vi.fn()}
        onToggleReviewed={vi.fn()}
      />
    </TooltipProvider>,
  );

  return { onSelectFile, onStageFiles, onToggleFolder };
}

describe("FileStatusList (grouping)", () => {
  it("grouped: shows a folder header inside each section", () => {
    renderList({
      staged: [staged("src/a.ts")],
      unstaged: [unstaged("lib/b.ts")],
      isGroupedByFolder: true,
    });

    // Staged section folder header
    expect(screen.getByText("src").closest("button")).toBeInTheDocument();
    // Changes section folder header
    expect(screen.getByText("lib").closest("button")).toBeInTheDocument();
    // File names rendered without dir suffix
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
  });

  it("grouped: collapsing a shared folder hides its rows in ALL sections", () => {
    renderList({
      staged: [staged("data/s1.ts"), staged("root-staged.ts")],
      unstaged: [unstaged("data/u1.ts")],
      untracked: ["data/t1.ts"],
      isGroupedByFolder: true,
      collapsedFolders: new Set(["data"]),
    });

    // "data" header appears once per section that contains it (staged + changes)
    expect(screen.getAllByText("data")).toHaveLength(2);

    // Every "data/..." file is hidden across both sections
    expect(screen.queryByText("s1.ts")).toBeNull();
    expect(screen.queryByText("u1.ts")).toBeNull();
    expect(screen.queryByText("t1.ts")).toBeNull();

    // The root-level staged file (not under data) stays visible
    expect(screen.getByText("root-staged.ts")).toBeInTheDocument();
  });

  it("grouped: 's' on the selected unstaged file calls onStageFiles", () => {
    const onStageFiles = vi.fn();
    renderList({
      unstaged: [unstaged("data/u1.ts")],
      selectedFile: "data/u1.ts",
      selectedStaged: false,
      isGroupedByFolder: true,
      onStageFiles,
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    });

    expect(onStageFiles).toHaveBeenCalledWith(["data/u1.ts"]);
  });

  it("grouped: 'j' skips collapsed files across section boundaries", () => {
    const onSelectFile = vi.fn();
    renderList({
      staged: [staged("aaa/s1.ts")],
      unstaged: [unstaged("bbb/u1.ts")],
      untracked: ["ccc/t1.ts"],
      isGroupedByFolder: true,
      collapsedFolders: new Set(["bbb"]),
      selectedFile: "aaa/s1.ts",
      selectedStaged: true,
      onSelectFile,
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });

    // bbb is collapsed, so from the staged file j lands on the untracked file
    // in the Changes section, skipping the hidden unstaged row.
    expect(onSelectFile).toHaveBeenCalledWith("ccc/t1.ts", false);
  });

  it("grouped: unstaged rows precede untracked rows within a shared folder", () => {
    // Names chosen so alphabetical order (a < z) is the OPPOSITE of the
    // required insertion order (unstaged before untracked). This locks the
    // stable-order contract rather than an accidental sort.
    renderList({
      unstaged: [unstaged("data/z-unstaged.ts")],
      untracked: ["data/a-untracked.ts"],
      isGroupedByFolder: true,
    });

    const unstagedEl = screen.getByText("z-unstaged.ts");
    const untrackedEl = screen.getByText("a-untracked.ts");

    const relation = unstagedEl.compareDocumentPosition(untrackedEl);
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("flat: renders no folder headers and shows the dir suffix", () => {
    renderList({
      staged: [staged("src/a.ts")],
      isGroupedByFolder: false,
    });

    // No folder header button in flat mode
    expect(screen.queryByRole("button", { name: "src" })).toBeNull();
    // File name + dir suffix both visible
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
  });

  it("flat: 'j' selects the next file in display order", () => {
    const onSelectFile = vi.fn();
    renderList({
      staged: [staged("src/a.ts")],
      unstaged: [unstaged("src/b.ts")],
      isGroupedByFolder: false,
      selectedFile: "src/a.ts",
      selectedStaged: true,
      onSelectFile,
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });

    // staged src/a.ts -> unstaged src/b.ts
    expect(onSelectFile).toHaveBeenCalledWith("src/b.ts", false);
  });
});
