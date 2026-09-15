import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FolderTree } from "@/components/git/folder-tree";
import { buildFileTree } from "@/lib/git-file-tree";

interface TestFile {
  path: string;
}

function renderFile(item: TestFile) {
  return <span data-testid={`file-${item.path}`}>{item.path}</span>;
}

describe("FolderTree", () => {
  it("renders nested folder headers with counts", () => {
    const root = buildFileTree<TestFile>([
      { path: "src/components/a.ts" },
      { path: "src/components/b.ts" },
      { path: "src/index.ts" },
    ]);

    render(
      <FolderTree
        root={root}
        collapsedFolders={new Set()}
        onToggleFolder={vi.fn()}
        renderFile={renderFile}
      />,
    );

    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("components")).toBeInTheDocument();

    const srcButton = screen.getByText("src").closest("button");
    expect(srcButton).toHaveTextContent("3");

    const componentsButton = screen.getByText("components").closest("button");
    expect(componentsButton).toHaveTextContent("2");
  });

  it("calls onToggleFolder with the folder's full path", async () => {
    const user = userEvent.setup();
    const onToggleFolder = vi.fn();
    const root = buildFileTree<TestFile>([{ path: "src/components/a.ts" }]);

    render(
      <FolderTree
        root={root}
        collapsedFolders={new Set()}
        onToggleFolder={onToggleFolder}
        renderFile={renderFile}
      />,
    );

    await user.click(screen.getByText("components"));
    expect(onToggleFolder).toHaveBeenCalledWith("src/components");
    expect(onToggleFolder).not.toHaveBeenCalledWith("components");
  });

  it("renders none of a collapsed folder's descendant files", () => {
    const root = buildFileTree<TestFile>([
      { path: "src/components/a.ts" },
      { path: "src/components/b.ts" },
      { path: "src/index.ts" },
    ]);

    render(
      <FolderTree
        root={root}
        collapsedFolders={new Set(["src/components"])}
        onToggleFolder={vi.fn()}
        renderFile={renderFile}
      />,
    );

    expect(screen.queryByTestId("file-src/components/a.ts")).toBeNull();
    expect(screen.queryByTestId("file-src/components/b.ts")).toBeNull();
    expect(screen.getByTestId("file-src/index.ts")).toBeInTheDocument();
    // header still present even when collapsed
    expect(screen.getByText("components")).toBeInTheDocument();
  });

  it("renders root-level files without any header", () => {
    const root = buildFileTree<TestFile>([
      { path: "readme.md" },
      { path: "package.json" },
    ]);

    render(
      <FolderTree
        root={root}
        collapsedFolders={new Set()}
        onToggleFolder={vi.fn()}
        renderFile={renderFile}
      />,
    );

    expect(screen.getByTestId("file-readme.md")).toBeInTheDocument();
    expect(screen.getByTestId("file-package.json")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
