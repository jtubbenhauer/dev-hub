import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { FilesSidebar } from "@/components/editor/files-sidebar";
import type { FileTreeProps } from "@/components/editor/file-tree";
import { useContentSearchStore } from "@/stores/content-search-store";
import { useEditorStore } from "@/stores/editor-store";

// The tree and the search panel have their own tests; this file covers which
// one the sidebar shows.
vi.mock("@/components/editor/file-tree", () => ({
  FileTree: () => <div data-testid="file-tree" />,
}));

vi.mock("@/components/editor/search-panel", () => ({
  SearchPanel: () => <div data-testid="search-panel" />,
}));

const fileTreeProps: FileTreeProps = {
  workspaceId: "ws-1",
  expandedPaths: new Set<string>(),
  activeFilePath: null,
  onToggleExpand: vi.fn(),
  onExpandPathToFile: vi.fn(),
  onFileClick: vi.fn(),
  onSearchResultClick: vi.fn(),
};

function renderFilesSidebar() {
  return render(
    <FilesSidebar
      workspaceId="ws-1"
      fileTreeProps={fileTreeProps}
      onOpenMatch={vi.fn()}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  useContentSearchStore.getState().setSidebarView("explorer");
  useEditorStore.setState({
    openFiles: [
      {
        workspaceId: "ws-1",
        path: "a.ts",
        name: "a.ts",
        content: "export const a = 1;\n",
        originalContent: "export const a = 1;\n",
        language: "typescript",
        isDirty: false,
        instanceId: 1,
      },
    ],
    activeFilePath: "a.ts",
  });
});

afterEach(() => {
  cleanup();
  useEditorStore.getState().closeAllFiles();
});

describe("FilesSidebar", () => {
  it("shows only the tree in the explorer view, even with open file buffers", () => {
    // When
    renderFilesSidebar();

    // Then
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open Editors/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the search panel instead of the tree in the search view", async () => {
    // Given
    renderFilesSidebar();

    // When
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    // Then
    expect(screen.getByTestId("search-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("file-tree")).not.toBeInTheDocument();
  });
});
