import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { FilesSidebar } from "@/components/editor/files-sidebar";
import type { FileTreeProps } from "@/components/editor/file-tree";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useContentSearchStore } from "@/stores/content-search-store";
import { useEditorStore } from "@/stores/editor-store";

// The tree has its own tests; this file covers what the sidebar stacks above it.
vi.mock("@/components/editor/file-tree", () => ({
  FileTree: () => <div data-testid="file-tree" />,
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

function renderFilesSidebar(shouldShowOpenEditors: boolean) {
  return render(
    <TooltipProvider>
      <FilesSidebar
        workspaceId="ws-1"
        shouldShowOpenEditors={shouldShowOpenEditors}
        fileTreeProps={fileTreeProps}
        onOpenMatch={vi.fn()}
      />
    </TooltipProvider>,
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
  it("lists the open editors above the tree when asked to", () => {
    // When
    renderFilesSidebar(true);

    // Then
    expect(
      screen.getByRole("button", { name: /Open Editors/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
  });

  it("shows only the tree when the open editors list is not wanted", () => {
    // When
    renderFilesSidebar(false);

    // Then
    expect(
      screen.queryByRole("button", { name: /Open Editors/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("file-tree")).toBeInTheDocument();
  });
});
