import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useSidePanelStore } from "@/stores/side-panel-store";
import type { GitStatusResult, GitFileStatus, OpenFile } from "@/types";

// next/dynamic is only used by SplitPanelFiles for the Monaco editor; render a
// lightweight stub so we can assert which surface (editor vs diff) is shown.
vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: () =>
    function MonacoStub() {
      return <div data-testid="monaco-editor" />;
    },
}));

// Capture the props the diff surface receives so we can prove an outside-repo
// path never reaches it.
let diffProps: { workspaceId: string; filePath: string } | undefined;
vi.mock("@/components/chat/side-panel-diff-view", () => ({
  SidePanelDiffView: (props: { workspaceId: string; filePath: string }) => {
    diffProps = props;
    return <div data-testid="side-panel-diff-view">{props.filePath}</div>;
  },
}));

const useGitStatusMock = vi.fn();
vi.mock("@/hooks/use-git", () => ({
  useGitStatus: (...args: unknown[]) => useGitStatusMock(...args),
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
  FileTree: () => <div data-testid="file-tree" />,
}));

vi.mock("@/components/chat/split-panel-file-tabs", () => ({
  SplitPanelFileTabs: () => <div data-testid="split-panel-file-tabs" />,
}));

vi.mock("@/components/editor/comments-sidebar", () => ({
  CommentsSidebar: () => <div data-testid="comments-sidebar" />,
}));

import { SplitPanelFiles } from "@/components/chat/split-panel-files";

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
  };
}

function dirty(path: string): GitFileStatus {
  return { path, index: " ", workingDir: "M" };
}

// A far-future timestamp is "fresh" (>= the key's activation time recorded at
// effect run); a tiny timestamp is "stale" and forces a refetch.
function freshTs(): number {
  return Date.now() + 1_000_000;
}

function setStatus(opts: {
  data: GitStatusResult | undefined;
  dataUpdatedAt?: number;
  refetch?: ReturnType<typeof vi.fn>;
}): ReturnType<typeof vi.fn> {
  const refetch =
    opts.refetch ?? vi.fn().mockResolvedValue({ data: opts.data });
  useGitStatusMock.mockReturnValue({
    data: opts.data,
    dataUpdatedAt: opts.dataUpdatedAt ?? freshTs(),
    refetch,
  });
  return refetch;
}

function openFile(path: string, opts?: { isDirty?: boolean }): void {
  const isDirty = opts?.isDirty ?? false;
  const file: OpenFile = {
    path,
    name: path.split(/[/\\]/).pop() ?? path,
    content: "content",
    language: "typescript",
    isDirty,
    originalContent: isDirty ? "different" : "content",
  };
  useSidePanelStore.setState({ openFiles: [file], activeFilePath: path });
}

function renderPanel(workspaceId = "ws1", workspacePath = "/ws/root") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  const utils = render(
    <QueryClientProvider client={client}>
      <SplitPanelFiles
        workspaceId={workspaceId}
        workspacePath={workspacePath}
      />
    </QueryClientProvider>,
  );
  return { ...utils, client, invalidateSpy };
}

beforeEach(() => {
  diffProps = undefined;
  useGitStatusMock.mockReset();
  useSidePanelStore.setState({
    openFiles: [],
    activeFilePath: null,
    fileViewModes: {},
    isFilePickerOpen: false,
    isLoading: false,
    error: null,
    workspaceFileStates: {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SplitPanelFiles diff/editor mode", () => {
  it("(1) defaults to diff for a git-dirty file with a clean buffer", async () => {
    setStatus({ data: makeStatus({ unstaged: [dirty("foo.ts")] }) });
    openFile("/ws/root/foo.ts");
    renderPanel();

    expect(
      await screen.findByTestId("side-panel-diff-view"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("file-view-toggle-diff")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("(2) keeps a dirty buffer in editor even when git-dirty", async () => {
    setStatus({ data: makeStatus({ unstaged: [dirty("foo.ts")] }) });
    openFile("/ws/root/foo.ts", { isDirty: true });
    renderPanel();

    expect(await screen.findByTestId("monaco-editor")).toBeInTheDocument();
    expect(
      screen.queryByTestId("side-panel-diff-view"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("file-view-toggle-editor")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("(3) persists editor (never diff) when dirty buffer races fresh git-dirty status", async () => {
    setStatus({ data: makeStatus({ unstaged: [dirty("foo.ts")] }) });
    openFile("/ws/root/foo.ts", { isDirty: true });
    renderPanel();

    await waitFor(() => {
      expect(useSidePanelStore.getState().fileViewModes["ws1:foo.ts"]).toBe(
        "editor",
      );
    });
    expect(
      screen.queryByTestId("side-panel-diff-view"),
    ).not.toBeInTheDocument();
  });

  it("(4) latches editor when dirty while status pending, and stays editor after it resolves git-dirty", async () => {
    setStatus({ data: undefined, dataUpdatedAt: 0 });
    openFile("/ws/root/foo.ts", { isDirty: true });
    const { rerender, client } = renderPanel();

    await waitFor(() => {
      expect(useSidePanelStore.getState().fileViewModes["ws1:foo.ts"]).toBe(
        "editor",
      );
    });

    setStatus({ data: makeStatus({ unstaged: [dirty("foo.ts")] }) });
    rerender(
      <QueryClientProvider client={client}>
        <SplitPanelFiles workspaceId="ws1" workspacePath="/ws/root" />
      </QueryClientProvider>,
    );

    expect(useSidePanelStore.getState().fileViewModes["ws1:foo.ts"]).toBe(
      "editor",
    );
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(
      screen.queryByTestId("side-panel-diff-view"),
    ).not.toBeInTheDocument();
  });

  it("(5) persists an explicit toggle to Editor across re-renders", async () => {
    const user = userEvent.setup();
    setStatus({ data: makeStatus({ unstaged: [dirty("foo.ts")] }) });
    openFile("/ws/root/foo.ts");
    const { rerender, client } = renderPanel();

    await screen.findByTestId("side-panel-diff-view");
    await user.click(screen.getByTestId("file-view-toggle-editor"));
    await screen.findByTestId("monaco-editor");
    expect(useSidePanelStore.getState().fileViewModes["ws1:foo.ts"]).toBe(
      "editor",
    );

    rerender(
      <QueryClientProvider client={client}>
        <SplitPanelFiles workspaceId="ws1" workspacePath="/ws/root" />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(
      screen.queryByTestId("side-panel-diff-view"),
    ).not.toBeInTheDocument();
  });

  it("(6) defaults to diff for an untracked file", async () => {
    setStatus({ data: makeStatus({ untracked: ["foo.ts"] }) });
    openFile("/ws/root/foo.ts");
    renderPanel();

    expect(
      await screen.findByTestId("side-panel-diff-view"),
    ).toBeInTheDocument();
  });

  it.each([
    "/abs/file.ts",
    "C:\\outside\\f.ts",
    "\\\\server\\share\\f.ts",
    "../outside.ts",
  ])(
    "(7) outside-repo path %s renders editor with no toggle or diff",
    async (path) => {
      setStatus({ data: makeStatus() });
      openFile(path);
      renderPanel();

      expect(await screen.findByTestId("monaco-editor")).toBeInTheDocument();
      expect(screen.queryByTestId("file-view-toggle")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("side-panel-diff-view"),
      ).not.toBeInTheDocument();
      expect(diffProps).toBeUndefined();
    },
  );

  it("(8) non-repo workspace renders editor with no toggle", async () => {
    setStatus({ data: makeStatus({ isRepo: false }) });
    openFile("/ws/root/foo.ts");
    renderPanel();

    expect(await screen.findByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("file-view-toggle")).not.toBeInTheDocument();
  });

  it("(9) render gate: a stored diff mode never renders diff when canDiff is false", async () => {
    useSidePanelStore.setState({ fileViewModes: { "ws1:foo.ts": "diff" } });
    setStatus({ data: makeStatus({ isRepo: false }) });
    openFile("/ws/root/foo.ts");
    renderPanel();

    expect(await screen.findByTestId("monaco-editor")).toBeInTheDocument();
    expect(
      screen.queryByTestId("side-panel-diff-view"),
    ).not.toBeInTheDocument();
  });

  it("(10) clean file defaults to editor with a toggle, and switching to Diff renders", async () => {
    const user = userEvent.setup();
    setStatus({ data: makeStatus() });
    openFile("/ws/root/foo.ts");
    renderPanel();

    expect(await screen.findByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.getByTestId("file-view-toggle")).toBeInTheDocument();

    await user.click(screen.getByTestId("file-view-toggle-diff"));
    expect(
      await screen.findByTestId("side-panel-diff-view"),
    ).toBeInTheDocument();
  });

  it("(11) save success invalidates git-file-content, git-status, and git-file-diffs", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    setStatus({ data: makeStatus() });
    openFile("/ws/root/foo.ts", { isDirty: true });
    const { invalidateSpy } = renderPanel();

    await screen.findByTestId("monaco-editor");
    await user.click(screen.getByTestId("split-panel-save"));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["git-file-content", "ws1"],
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["git-status", "ws1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["git-file-diffs", "ws1"],
    });
  });

  it("(12) namespaces keys by workspace so other workspaces' entries are independent", async () => {
    useSidePanelStore.setState({
      fileViewModes: { "ws1:foo.ts": "diff", "ws2:foo.ts": "editor" },
    });
    setStatus({ data: makeStatus({ unstaged: [dirty("foo.ts")] }) });
    openFile("/ws/root/foo.ts");
    renderPanel("ws1", "/ws/root");

    await waitFor(() => {
      expect(useSidePanelStore.getState().fileViewModes["ws1:foo.ts"]).toBe(
        "diff",
      );
    });
    expect(useSidePanelStore.getState().fileViewModes["ws2:foo.ts"]).toBe(
      "editor",
    );
  });

  it("(13) prunes a file's qualified entry when its tab is closed", async () => {
    setStatus({ data: makeStatus({ unstaged: [dirty("foo.ts")] }) });
    openFile("/ws/root/foo.ts");
    renderPanel("ws1", "/ws/root");

    await waitFor(() => {
      expect(useSidePanelStore.getState().fileViewModes["ws1:foo.ts"]).toBe(
        "diff",
      );
    });

    act(() => {
      useSidePanelStore.getState().closeTab("/ws/root/foo.ts");
    });

    await waitFor(() => {
      expect(
        useSidePanelStore.getState().fileViewModes["ws1:foo.ts"],
      ).toBeUndefined();
    });
  });

  it("(14) initializes diff when the cache is stale but a refetch returns fresh git-dirty data", async () => {
    const refetch = vi
      .fn()
      .mockResolvedValue({ data: makeStatus({ unstaged: [dirty("foo.ts")] }) });
    setStatus({ data: makeStatus(), dataUpdatedAt: 1, refetch });
    openFile("/ws/root/foo.ts");
    renderPanel();

    expect(
      await screen.findByTestId("side-panel-diff-view"),
    ).toBeInTheDocument();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith({ cancelRefetch: false });
  });

  it("(15) initializes editor when the refetch rejects (never stuck undefined)", async () => {
    const refetch = vi.fn().mockRejectedValue(new Error("network"));
    setStatus({ data: makeStatus(), dataUpdatedAt: 1, refetch });
    openFile("/ws/root/foo.ts");
    renderPanel();

    await waitFor(() => {
      expect(useSidePanelStore.getState().fileViewModes["ws1:foo.ts"]).toBe(
        "editor",
      );
    });
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
    expect(
      screen.queryByTestId("side-panel-diff-view"),
    ).not.toBeInTheDocument();
  });
});
