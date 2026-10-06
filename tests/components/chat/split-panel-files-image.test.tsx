import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useSidePanelStore } from "@/stores/side-panel-store";
import { IMAGE_LANGUAGE } from "@/lib/file-preview";
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

vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-settings")>()),
  useChatSidebarTabsOpenSetting: () => ({
    sidebarTabsOpenMode: "sidebar",
    isLoading: false,
  }),
}));

vi.mock("@/components/editor/file-tree", () => ({
  FileTree: (props: { onFileClick: (entry: FileTreeEntry) => void }) => (
    <button
      type="button"
      data-testid="tree-image"
      onClick={() =>
        props.onFileClick({
          name: "logo.png",
          path: "assets/logo.png",
          type: "file",
        })
      }
    />
  ),
}));

vi.mock("@/components/chat/split-panel-file-tabs", () => ({
  SplitPanelFileTabs: () => <div data-testid="split-panel-file-tabs" />,
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

function hasFetchedTextContent(fetchMock: ReturnType<typeof vi.fn>): boolean {
  return fetchMock.mock.calls.some(([url]) =>
    String(url).includes("/api/files/content"),
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
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

describe("SplitPanelFiles image preview", () => {
  it("previews an image clicked in the explorer instead of failing to load it", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    await user.click(screen.getByTestId("tree-image"));

    const image = await screen.findByRole("img", { name: "logo.png" });
    expect(image).toHaveAttribute(
      "src",
      "/api/files/raw?workspaceId=ws1&path=assets%2Flogo.png",
    );
    expect(hasFetchedTextContent(fetchMock)).toBe(false);
    expect(screen.queryByText(/File not found/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("split-panel-save")).not.toBeInTheDocument();
    const tab = useSidePanelStore
      .getState()
      .openFiles.find((f) => f.path === "assets/logo.png");
    expect(tab?.language).toBe(IMAGE_LANGUAGE);
  });
});
