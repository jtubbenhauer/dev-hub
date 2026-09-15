import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChangedFileList } from "@/components/git/changed-file-list";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReviewChangedFile } from "@/types";

function file(path: string): ReviewChangedFile {
  return { path, status: "modified" };
}

interface RenderOptions {
  files?: ReviewChangedFile[];
  selectedFile?: string | null;
  isGroupedByFolder?: boolean;
  collapsedFolders?: Set<string>;
  onSelectFile?: (path: string) => void;
  onToggleFolder?: (path: string) => void;
}

function renderList(options: RenderOptions = {}) {
  const {
    files = [file("src/a.ts"), file("src/b.ts"), file("readme.md")],
    selectedFile = null,
    isGroupedByFolder = true,
    collapsedFolders = new Set<string>(),
    onSelectFile = vi.fn(),
    onToggleFolder = vi.fn(),
  } = options;

  render(
    <TooltipProvider>
      <ChangedFileList
        files={files}
        selectedFile={selectedFile}
        isLoading={false}
        reviewedFiles={new Set()}
        sortMode="name-asc"
        isGroupedByFolder={isGroupedByFolder}
        collapsedFolders={collapsedFolders}
        onToggleFolder={onToggleFolder}
        onSelectFile={onSelectFile}
        onToggleReviewed={vi.fn()}
      />
    </TooltipProvider>,
  );

  return { onSelectFile, onToggleFolder };
}

describe("ChangedFileList", () => {
  it("grouped: shows folder headers and omits the dir suffix on file rows", () => {
    renderList({
      files: [file("src/a.ts"), file("src/b.ts")],
      isGroupedByFolder: true,
    });

    // Folder header rendered as a button
    const srcHeader = screen.getByText("src").closest("button");
    expect(srcHeader).toBeInTheDocument();

    // File names shown without the trailing dir suffix
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
    // The dir path "src" only appears once (the header), not repeated as a
    // suffix on each row.
    expect(screen.getAllByText("src")).toHaveLength(1);
  });

  it("grouped: collapsing a folder removes its file rows", () => {
    renderList({
      files: [file("src/a.ts"), file("src/b.ts"), file("readme.md")],
      isGroupedByFolder: true,
      collapsedFolders: new Set(["src"]),
    });

    // Header still present when collapsed
    expect(screen.getByText("src").closest("button")).toBeInTheDocument();
    // Collapsed folder's files are hidden
    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.queryByText("b.ts")).toBeNull();
    // Sibling root file still visible
    expect(screen.getByText("readme.md")).toBeInTheDocument();
  });

  it("grouped: j from a file selects the next VISIBLE file, skipping collapsed folder contents", () => {
    const onSelectFile = vi.fn();
    renderList({
      files: [
        file("apple/a1.ts"),
        file("banana/b1.ts"),
        file("banana/b2.ts"),
        file("cherry/c1.ts"),
      ],
      isGroupedByFolder: true,
      collapsedFolders: new Set(["banana"]),
      selectedFile: "apple/a1.ts",
      onSelectFile,
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });

    // banana's files are hidden, so the next visible file is cherry/c1.ts
    expect(onSelectFile).toHaveBeenCalledWith("cherry/c1.ts");
  });

  it("grouped: clicking a folder header toggles it", async () => {
    const user = userEvent.setup();
    const onToggleFolder = vi.fn();
    renderList({
      files: [file("src/a.ts")],
      isGroupedByFolder: true,
      onToggleFolder,
    });

    await user.click(screen.getByText("src"));
    expect(onToggleFolder).toHaveBeenCalledWith("src");
  });

  it("flat: shows the dir suffix and renders no folder headers", () => {
    renderList({
      files: [file("src/a.ts"), file("readme.md")],
      isGroupedByFolder: false,
    });

    // No folder header buttons in flat mode
    expect(screen.queryByRole("button", { name: "src" })).toBeNull();
    // Dir suffix visible next to the file name
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
  });

  it("flat: j selects the next file in list order", () => {
    const onSelectFile = vi.fn();
    renderList({
      files: [file("src/a.ts"), file("src/b.ts"), file("readme.md")],
      isGroupedByFolder: false,
      selectedFile: "src/a.ts",
      onSelectFile,
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    });

    expect(onSelectFile).toHaveBeenCalledWith("src/b.ts");
  });

  it("shows the empty message when there are no files", () => {
    renderList({ files: [], isGroupedByFolder: true });
    expect(screen.getByText("No changed files")).toBeInTheDocument();
  });
});
