import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ExplorerView } from "@/components/workbench/context-sidebar/explorer-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { OpenFileInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import { WORKBENCH_PATH } from "@/lib/workbench/workbench-href";
import { useContentSearchStore } from "@/stores/content-search-store";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { useEditorStore } from "@/stores/editor-store";
import type { FileTreeEntry } from "@/types";
import { createWorkspace } from "./workspace-fixture";

const doubles = vi.hoisted(() => ({
  openFileInWorkbench: vi.fn<
    (input: OpenFileInWorkbenchInput) => Promise<boolean>
  >(async () => true),
  push: vi.fn<(href: string) => void>(),
}));

vi.mock("@/lib/workbench/open-in-workbench", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/workbench/open-in-workbench")
  >()),
  openFileInWorkbench: doubles.openFileInWorkbench,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: doubles.push, replace: vi.fn() }),
}));

const WORKSPACE_ID = "ws-1";

const ROOT_ENTRIES: FileTreeEntry[] = [
  { name: "src", path: "src", type: "directory" },
  { name: "README.md", path: "README.md", type: "file" },
  { name: "a.ts", path: "a.ts", type: "file" },
];

function renderExplorerView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // Seeded queries keep the tree, the quick-open list and settings off the network.
  queryClient.setQueryData(["settings"], {});
  queryClient.setQueryData(["file-tree", WORKSPACE_ID, "root"], ROOT_ENTRIES);
  queryClient.setQueryData(
    ["workspace-files", WORKSPACE_ID],
    ["README.md", "a.ts", "src/b.ts"],
  );
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ExplorerView
          workspaceId={WORKSPACE_ID}
          workspace={createWorkspace(WORKSPACE_ID)}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

async function pickQuickOpenResult(query: string, resultName: RegExp) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText("Search files..."), query);
  await user.click(screen.getByRole("button", { name: resultName }));
}

beforeEach(() => {
  localStorage.clear();
  doubles.openFileInWorkbench.mockClear();
  doubles.push.mockClear();
  // Expanding a folder fetches its children; a pending answer keeps it quiet.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  useContentSearchStore.getState().setSidebarView("explorer");
  useContextSidebarStore.setState(
    useContextSidebarStore.getInitialState(),
    true,
  );
  useEditorStore.getState().closeAllFiles();
  useEditorStore.setState({ workspaceFileStates: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ExplorerView", () => {
  it("opens a clicked tree file as a workbench tab", async () => {
    // Given
    renderExplorerView();

    // When
    await userEvent.click(screen.getByRole("button", { name: "a.ts" }));

    // Then
    expect(doubles.openFileInWorkbench).toHaveBeenCalledExactlyOnceWith({
      workspaceId: WORKSPACE_ID,
      path: "a.ts",
      isFileTabsDisabled: false,
      navigate: expect.any(Function),
    });
  });

  it("navigates with the router when the opener needs the workbench route", async () => {
    // Given
    renderExplorerView();
    await userEvent.click(screen.getByRole("button", { name: "a.ts" }));
    const navigate = doubles.openFileInWorkbench.mock.lastCall?.[0].navigate;
    if (!navigate) throw new Error("expected the opener to receive navigate");

    // When
    navigate(`${WORKBENCH_PATH}?open=file&path=a.ts`);

    // Then
    expect(doubles.push).toHaveBeenCalledExactlyOnceWith(
      `${WORKBENCH_PATH}?open=file&path=a.ts`,
    );
  });

  it("opens a quick-open result as a workbench tab", async () => {
    // Given
    renderExplorerView();

    // When
    await pickQuickOpenResult("b.ts", /b\.ts/);

    // Then
    expect(doubles.openFileInWorkbench).toHaveBeenCalledExactlyOnceWith({
      workspaceId: WORKSPACE_ID,
      path: "src/b.ts",
      isFileTabsDisabled: false,
      navigate: expect.any(Function),
    });
  });

  it("expands the tree down to a picked quick-open result", async () => {
    // Given
    renderExplorerView();

    // When
    await pickQuickOpenResult("b.ts", /b\.ts/);

    // Then
    expect(
      useEditorStore.getState().workspaceFileStates[WORKSPACE_ID]
        ?.expandedPaths,
    ).toEqual(["src"]);
  });

  it("leaves the open editors list out of the sidebar", () => {
    // Given
    useEditorStore.setState({
      openFiles: [
        {
          workspaceId: WORKSPACE_ID,
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

    // When
    renderExplorerView();

    // Then
    expect(
      screen.queryByRole("button", { name: /Open Editors/ }),
    ).not.toBeInTheDocument();
  });

  it("focuses the tree container for a tree request queued before it mounted", () => {
    // Given
    useContextSidebarStore.getState().requestFocus("tree");

    // When
    renderExplorerView();

    // Then
    expect(screen.getByRole("region", { name: "File explorer" })).toHaveFocus();
    expect(useContextSidebarStore.getState().focusRequest).toBeNull();
  });

  it("focuses the file search input for a file-search request", () => {
    // Given
    renderExplorerView();

    // When
    act(() => useContextSidebarStore.getState().requestFocus("file-search"));

    // Then
    expect(screen.getByPlaceholderText("Search files...")).toHaveFocus();
    expect(useContextSidebarStore.getState().focusRequest).toBeNull();
  });
});
