import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useSidePanelStore } from "@/stores/side-panel-store";
import type { FileTreeEntry } from "@/types";

vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: () =>
    function MonacoStub() {
      return <div data-testid="monaco-editor" />;
    },
}));

vi.mock("@/components/chat/side-panel-diff-view", () => ({
  SidePanelDiffView: () => <div data-testid="side-panel-diff-view" />,
}));

vi.mock("@/hooks/use-git", () => ({
  useGitStatus: () => ({
    data: undefined,
    dataUpdatedAt: 0,
    refetch: () => Promise.resolve({ data: undefined }),
  }),
}));

vi.mock("@/hooks/use-file-comments", () => ({
  useFileComments: () => ({ data: [] }),
  useResolveFileComment: () => ({ mutate: vi.fn() }),
  useDeleteFileComment: () => ({ mutate: vi.fn() }),
  useUpdateFileComment: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-diagnostics", () => ({
  useLintOnSave: () => ({ lintFile: vi.fn() }),
}));

vi.mock("@/components/editor/file-tree", () => ({
  FileTree: (props: { onFileClick: (entry: FileTreeEntry) => void }) => (
    <button
      type="button"
      data-testid="tree-file"
      onClick={() =>
        props.onFileClick({
          name: "foo.ts",
          path: "src/foo.ts",
          type: "file",
        } as FileTreeEntry)
      }
    />
  ),
}));

vi.mock("@/components/chat/split-panel-file-tabs", () => ({
  SplitPanelFileTabs: () => <div data-testid="split-panel-file-tabs" />,
}));

vi.mock("@/components/editor/comments-sidebar", () => ({
  CommentsSidebar: () => <div data-testid="comments-sidebar" />,
}));

let sidebarTabsOpenMode: "sidebar" | "dialog" = "sidebar";
vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-settings")>()),
  useChatSidebarTabsOpenSetting: () => ({
    sidebarTabsOpenMode,
    isLoading: false,
  }),
}));

const openChatFileDialog = vi.fn();
vi.mock("@/stores/chat-file-dialog-store", () => ({
  useChatFileDialogStore: {
    getState: () => ({ openFile: openChatFileDialog }),
  },
}));

import { SplitPanelFiles } from "@/components/chat/split-panel-files";

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SplitPanelFiles workspaceId="ws1" workspacePath="/ws/root" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  sidebarTabsOpenMode = "sidebar";
  useSidePanelStore.setState({
    openFiles: [],
    activeFilePath: null,
    fileViewModes: {},
    isFilePickerOpen: true,
    isLoading: false,
    error: null,
    workspaceFileStates: {},
  });
});

describe("SplitPanelFiles open mode", () => {
  it("opens a tree file in the chat file dialog when dialog mode is set", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    sidebarTabsOpenMode = "dialog";
    renderPanel();

    await user.click(screen.getByTestId("tree-file"));

    expect(openChatFileDialog).toHaveBeenCalledWith(
      "ws1",
      "src/foo.ts",
      expect.any(Function),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSidePanelStore.getState().openFiles).toHaveLength(0);
  });

  it("opens a tree file as a sidebar tab in sidebar mode", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: "hello", language: "typescript" }),
      }),
    );
    renderPanel();

    await user.click(screen.getByTestId("tree-file"));

    await waitFor(() =>
      expect(useSidePanelStore.getState().activeFilePath).toBe("src/foo.ts"),
    );
    expect(openChatFileDialog).not.toHaveBeenCalled();
  });
});
