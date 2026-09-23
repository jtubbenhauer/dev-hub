import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useSidePanelStore } from "@/stores/side-panel-store";
import { PDF_LANGUAGE } from "@/lib/file-preview";

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
  FileTree: () => <div data-testid="file-tree" />,
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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  useSidePanelStore.setState({
    openFiles: [
      {
        path: "docs/spec.pdf",
        name: "spec.pdf",
        content: "",
        originalContent: "",
        language: PDF_LANGUAGE,
        isDirty: false,
      },
    ],
    activeFilePath: "docs/spec.pdf",
    fileViewModes: {},
    isFilePickerOpen: false,
    isLoading: false,
    error: null,
    workspaceFileStates: {},
  });
});

describe("SplitPanelFiles PDF preview", () => {
  it("renders the PDF viewer instead of the text editor", () => {
    renderPanel();

    const viewer = screen.getByTestId("pdf-viewer");
    expect(viewer).toHaveAttribute(
      "src",
      "/api/files/raw?workspaceId=ws1&path=docs%2Fspec.pdf",
    );
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("split-panel-save")).not.toBeInTheDocument();
  });
});
