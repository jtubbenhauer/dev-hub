// allow: SIZE_OK — Todo 14 extends this existing page acceptance suite without moving its assertions.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useEditorStore } from "@/stores/editor-store";
import type { EditorRevealRequest } from "@/stores/editor-store";
import { useContentSearchStore } from "@/stores/content-search-store";
import { buildMatch } from "@/packages/shared/src/content-search/preview";
import type { SearchPanelProps } from "@/components/editor/search-panel";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { FileTreeEntry, Workspace } from "@/types";

interface LeaderRegistration {
  action: { id: string };
  handler: () => void;
}

let searchParams = new URLSearchParams();
let isLspEnabled = false;
const lintFile = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
let leaderRegistrations: LeaderRegistration[] = [];

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/layout/authenticated-layout", () => ({
  AuthenticatedLayout: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

const TREE_FILES = [
  { testId: "tree-image", name: "logo.png", path: "assets/logo.png" },
  { testId: "tree-pdf", name: "spec.pdf", path: "docs/spec.pdf" },
  { testId: "tree-zip", name: "app.zip", path: "build/app.zip" },
];

vi.mock("@/components/editor/file-tree", () => ({
  FileTree: (props: { onFileClick: (entry: FileTreeEntry) => void }) => (
    <>
      {TREE_FILES.map((file) => (
        <button
          key={file.testId}
          type="button"
          data-testid={file.testId}
          onClick={() =>
            props.onFileClick({
              name: file.name,
              path: file.path,
              type: "file",
            })
          }
        />
      ))}
    </>
  ),
}));

vi.mock("@/components/editor/open-editors", () => ({
  OpenEditors: () => null,
}));

vi.mock("@/components/editor/file-tabs", () => ({
  FileTabs: () => null,
}));

vi.mock("@/components/editor/editor-switcher", () => ({
  EditorSwitcher: ({
    isLspEligible,
    revealRequest,
  }: {
    isLspEligible: boolean;
    revealRequest?: EditorRevealRequest | null;
  }) => (
    <div
      data-testid="editor-switcher"
      data-eligible={String(isLspEligible)}
      data-reveal-line={revealRequest?.lineNumber}
    />
  ),
}));

const searchLine = "const needle = true;";
const searchMatch = buildMatch({
  line: searchLine,
  lineNumber: 2,
  start: 6,
  end: 12,
  lineSha256: "0".repeat(64),
});
vi.mock("@/components/editor/search-panel", () => ({
  SearchPanel: ({ onOpenMatch }: SearchPanelProps) => (
    <div data-testid="search-panel">
      <button onClick={() => onOpenMatch("src/a.ts", searchMatch)}>
        Open match
      </button>
      <button onClick={() => onOpenMatch("notes.md", searchMatch)}>
        Open markdown match
      </button>
    </div>
  ),
}));

vi.mock("@/components/editor/lsp-status-toggle", () => ({
  LspStatusToggle: () => null,
}));

vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-settings")>()),
  useLspEnabledSetting: () => ({ isLspEnabled }),
  useFileTabsSetting: () => ({ isFileTabsDisabled: false, isLoading: false }),
}));

vi.mock("@/hooks/use-git", () => ({
  useGitStatus: () => ({ data: undefined }),
}));

vi.mock("@/hooks/use-diagnostics", () => ({
  useLintOnSave: () => ({ lintFile }),
  useDiagnosticsForFile: () => ({ errorCount: 0, warningCount: 0 }),
}));

vi.mock("@/hooks/use-resizable-panel", () => ({
  useResizablePanel: () => ({ width: 260, handleDragStart: vi.fn() }),
}));

vi.mock("@/hooks/use-leader-action", () => ({
  useLeaderAction: (registrations: LeaderRegistration[]) => {
    leaderRegistrations = registrations;
  },
}));

import FilesPage from "@/app/files/page";

const workspace: Workspace = {
  id: "ws-1",
  userId: "user-1",
  name: "Test Workspace",
  path: "/workspace",
  type: "repo",
  parentRepoPath: null,
  packageManager: null,
  quickCommands: null,
  backend: "local",
  provider: null,
  opencodeUrl: null,
  agentUrl: null,
  providerMeta: null,
  shellCommand: null,
  sshTarget: null,
  sshPath: null,
  worktreeSymlinks: null,
  linkedTaskId: null,
  linkedTaskMeta: null,
  color: null,
  createdAt: new Date(0),
  lastAccessedAt: new Date(0),
};

const RAW_LOGO_URL = "/api/files/raw?workspaceId=ws-1&path=assets%2Flogo.png";

function getContentApiCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).includes("/api/files/content"),
  );
}

let queryClient = new QueryClient();

function renderFilesPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <FilesPage />
    </QueryClientProvider>,
  );
}

function getGitStatusInvalidations() {
  return vi
    .mocked(queryClient.invalidateQueries)
    .mock.calls.filter(([filters]) => filters?.queryKey?.[0] === "git-status");
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient();
  vi.spyOn(queryClient, "invalidateQueries");
  isLspEnabled = false;
  vi.unstubAllGlobals();
  searchParams = new URLSearchParams();
  leaderRegistrations = [];
  useContentSearchStore.setState({
    sidebarView: "explorer",
    pendingFocus: false,
  });
  useWorkspaceStore.setState({
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
  });
  useEditorStore.setState({
    openFiles: [],
    activeFilePath: null,
    isFileTreeOpen: true,
    workspaceFileStates: {},
    pendingReveal: null,
    markdownPreviewPath: null,
    csvPreviewPath: null,
  });
});

describe("FilesPage content search", () => {
  it("switches back to the tree when Explorer is clicked after Search", async () => {
    // Given
    renderFilesPage();
    const user = userEvent.setup();
    // When
    await user.click(screen.getByRole("button", { name: "Search" }));
    // Then
    expect(screen.getByTestId("search-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("tree-image")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // When
    await user.click(screen.getByRole("button", { name: "Explorer" }));
    // Then
    expect(screen.getByTestId("tree-image")).toBeInTheDocument();
    expect(screen.queryByTestId("search-panel")).not.toBeInTheDocument();
  });

  it("passes the match line to the editor when a search result opens", async () => {
    // Given
    useContentSearchStore.setState({ sidebarView: "search" });
    const fetchMock = vi.fn(async () =>
      Response.json({
        content: `first\n${searchLine}`,
        language: "typescript",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderFilesPage();
    // When
    await userEvent.click(screen.getByRole("button", { name: "Open match" }));
    // Then
    await waitFor(() =>
      expect(screen.getByTestId("editor-switcher")).toHaveAttribute(
        "data-reveal-line",
        "2",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/content?workspaceId=ws-1&path=src%2Fa.ts",
    );
  });

  it("clears markdown preview when opening a markdown search match", async () => {
    // Given
    useContentSearchStore.setState({ sidebarView: "search" });
    useEditorStore.setState({ markdownPreviewPath: "notes.md" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          content: `first\n${searchLine}`,
          language: "markdown",
        }),
      ),
    );
    renderFilesPage();
    // When
    await userEvent.click(
      screen.getByRole("button", { name: "Open markdown match" }),
    );
    // Then
    await waitFor(() =>
      expect(screen.getByTestId("editor-switcher")).toHaveAttribute(
        "data-reveal-line",
        "2",
      ),
    );
    expect(useEditorStore.getState().markdownPreviewPath).toBeNull();
  });

  it("leaves no pending reveal when the content endpoint returns 404", async () => {
    // Given
    useContentSearchStore.setState({ sidebarView: "search" });
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    renderFilesPage();
    // When
    await userEvent.click(screen.getByRole("button", { name: "Open match" }));
    // Then
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(useEditorStore.getState().pendingReveal).toBeNull();
    expect(screen.queryByTestId("editor-switcher")).not.toBeInTheDocument();
  });

  it("restores Explorer when the filename-search leader action runs", () => {
    // Given
    useContentSearchStore.setState({ sidebarView: "search" });
    renderFilesPage();
    expect(screen.getByTestId("search-panel")).toBeInTheDocument();
    // When
    act(() =>
      leaderRegistrations
        .find(({ action }) => action.id === "files:focus-search")
        ?.handler(),
    );
    // Then
    expect(screen.getByTestId("tree-image")).toBeInTheDocument();
  });
});

describe("FilesPage image preview", () => {
  it("previews an image clicked in the explorer instead of loading it as text", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderFilesPage();

    await user.click(screen.getByTestId("tree-image"));

    const image = await screen.findByRole("img", { name: "logo.png" });
    expect(image).toHaveAttribute("src", RAW_LOGO_URL);
    expect(getContentApiCalls(fetchMock)).toHaveLength(0);
    expect(screen.queryByTestId("editor-switcher")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save/i }),
    ).not.toBeInTheDocument();
    const downloadLink = screen.getByRole("link", { name: "Download file" });
    expect(downloadLink).toHaveAttribute("href", RAW_LOGO_URL);
    expect(downloadLink).toHaveAttribute("download", "logo.png");
  });

  it("opens an image passed through the ?open= link", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    searchParams = new URLSearchParams({ open: "assets/logo.png" });

    renderFilesPage();

    const image = await screen.findByRole("img", { name: "logo.png" });
    expect(image).toHaveAttribute("src", RAW_LOGO_URL);
    expect(getContentApiCalls(fetchMock)).toHaveLength(0);
  });

  it("keeps the ?open= image active after saved text tabs restore", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: "# Readme", language: "markdown" }),
      }),
    );
    useEditorStore.setState({
      workspaceFileStates: {
        [workspace.id]: {
          tabs: [
            { path: "README.md", name: "README.md", language: "markdown" },
          ],
          activeFilePath: "README.md",
          expandedPaths: [],
        },
      },
    });
    searchParams = new URLSearchParams({ open: "assets/logo.png" });

    renderFilesPage();

    await waitFor(() =>
      expect(useEditorStore.getState().openFiles).toHaveLength(2),
    );
    expect(useEditorStore.getState().activeFilePath).toBe("assets/logo.png");
    expect(screen.getByRole("img", { name: "logo.png" })).toHaveAttribute(
      "src",
      RAW_LOGO_URL,
    );
  });

  it("previews a PDF clicked in the explorer instead of loading it as text", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderFilesPage();

    await user.click(screen.getByTestId("tree-pdf"));

    const viewer = await screen.findByTestId("pdf-viewer");
    expect(viewer).toHaveAttribute(
      "src",
      "/api/files/raw?workspaceId=ws-1&path=docs%2Fspec.pdf",
    );
    expect(getContentApiCalls(fetchMock)).toHaveLength(0);
    expect(screen.queryByTestId("editor-switcher")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save/i }),
    ).not.toBeInTheDocument();
  });

  it("offers a download for a file the editor cannot display", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ error: "binary" }, { status: 415 })),
    );
    renderFilesPage();

    await user.click(screen.getByTestId("tree-zip"));

    expect(
      await screen.findByText("This file can't be displayed in the editor."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("editor-switcher")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save/i }),
    ).not.toBeInTheDocument();
    const expectedUrl =
      "/api/files/raw?workspaceId=ws-1&path=build%2Fapp.zip&download=1";
    for (const name of ["Download", "Download file"]) {
      const downloadLink = screen.getByRole("link", { name });
      expect(downloadLink).toHaveAttribute("href", expectedUrl);
      expect(downloadLink).toHaveAttribute("download", "app.zip");
    }
  });

  it("never writes an image tab back to disk from the save shortcut", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderFilesPage();
    await user.click(screen.getByTestId("tree-image"));
    await screen.findByRole("img", { name: "logo.png" });

    const saveRegistration = leaderRegistrations.find(
      (registration) => registration.action.id === "files:save",
    );
    expect(saveRegistration).toBeDefined();
    saveRegistration?.handler();

    expect(getContentApiCalls(fetchMock)).toHaveLength(0);
  });
});

describe("FilesPage snapshot saves", () => {
  function seedText() {
    useEditorStore.getState().openFile({
      workspaceId: "ws-1",
      path: "a.ts",
      name: "a.ts",
      content: "v1",
      originalContent: "base",
      isDirty: true,
      language: "typescript",
    });
  }
  it.each([false, true])(
    "keeps new typing dirty with LSP %s",
    async (enabled) => {
      isLspEnabled = enabled;
      seedText();
      let finish: (response: Response) => void = () => {};
      const fetchMock = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      renderFilesPage();
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/content",
        expect.objectContaining({
          body: JSON.stringify({
            workspaceId: "ws-1",
            path: "a.ts",
            content: "v1",
            ...(enabled ? { baseContent: "base" } : {}),
          }),
        }),
      );
      act(() => useEditorStore.getState().updateFileContent("a.ts", "v2"));
      await act(async () => {
        finish(Response.json({ success: true }));
      });
      expect(useEditorStore.getState().openFiles[0]).toMatchObject({
        content: "v2",
        originalContent: "v1",
        isDirty: true,
      });
      expect(lintFile).toHaveBeenCalledOnce();
      expect(toast.success).toHaveBeenCalledWith("Saved");
      expect(getGitStatusInvalidations()).toEqual([
        [{ queryKey: ["git-status", "ws-1"] }],
      ]);
    },
  );
  it("saves a foreign tab to its owner without LSP attachment or follow-ups", async () => {
    seedText();
    useWorkspaceStore.setState({
      workspaces: [{ ...workspace, id: "B" }],
      activeWorkspaceId: "B",
    });
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    renderFilesPage();
    expect(screen.getByTestId("editor-switcher")).toHaveAttribute(
      "data-eligible",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(useEditorStore.getState().openFiles[0].isDirty).toBe(false),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/content",
      expect.objectContaining({
        body: JSON.stringify({
          workspaceId: "ws-1",
          path: "a.ts",
          content: "v1",
        }),
      }),
    );
    expect(lintFile).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(getGitStatusInvalidations()).toEqual([]);
  });
  it("acknowledges without follow-ups after switching workspace mid-save", async () => {
    seedText();
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    renderFilesPage();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    act(() =>
      useWorkspaceStore.setState({
        workspaces: [{ ...workspace, id: "B" }],
        activeWorkspaceId: "B",
      }),
    );
    await act(async () => {
      finish(Response.json({ success: true }));
    });
    expect(useEditorStore.getState().openFiles[0].originalContent).toBe("v1");
    expect(lintFile).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(getGitStatusInvalidations()).toEqual([]);
  });
  it("keeps text and reports a rejected stale save", async () => {
    seedText();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "disk changed" }, { status: 409 }),
      ),
    );
    renderFilesPage();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("disk changed"),
    );
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      content: "v1",
      originalContent: "base",
      isDirty: true,
    });
  });
});

describe("FilesPage tabs per workspace", () => {
  const otherWorkspace: Workspace = { ...workspace, id: "ws-2", name: "Other" };

  function seedWorkspaceOneTabOpen() {
    useWorkspaceStore.setState({ workspaces: [workspace, otherWorkspace] });
    useEditorStore.setState({
      openFiles: [
        {
          workspaceId: "ws-1",
          instanceId: 1,
          path: "one-only.ts",
          name: "one-only.ts",
          content: "one",
          originalContent: "one",
          isDirty: false,
          language: "typescript",
        },
      ],
      activeFilePath: "one-only.ts",
      workspaceFileStates: {
        "ws-1": {
          tabs: [
            {
              path: "one-only.ts",
              name: "one-only.ts",
              language: "typescript",
            },
          ],
          activeFilePath: "one-only.ts",
          expandedPaths: [],
        },
        "ws-2": {
          tabs: [
            {
              path: "two-only.ts",
              name: "two-only.ts",
              language: "typescript",
            },
          ],
          activeFilePath: "two-only.ts",
          expandedPaths: [],
        },
      },
    });
  }

  function getOpenTabs() {
    return useEditorStore
      .getState()
      .openFiles.map((file) => `${file.workspaceId}:${file.path}`);
  }

  function getSavedTabPaths(workspaceId: string) {
    return useEditorStore
      .getState()
      .workspaceFileStates[workspaceId]?.tabs.map((tab) => tab.path);
  }

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ content: "two", language: "typescript" }),
      ),
    );
  });

  it("shows the active workspace's saved tabs when opened after switching elsewhere", async () => {
    // Given
    seedWorkspaceOneTabOpen();
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-2" });

    // When
    renderFilesPage();

    // Then
    await waitFor(() => expect(getOpenTabs()).toEqual(["ws-2:two-only.ts"]));
    expect(useEditorStore.getState().activeFilePath).toBe("two-only.ts");
    expect(getSavedTabPaths("ws-1")).toEqual(["one-only.ts"]);
    expect(getSavedTabPaths("ws-2")).toEqual(["two-only.ts"]);
  });

  it("swaps tabs when the workspace changes while the page is open", async () => {
    // Given
    seedWorkspaceOneTabOpen();
    renderFilesPage();

    // When
    act(() => useWorkspaceStore.getState().setActiveWorkspaceId("ws-2"));

    // Then
    await waitFor(() => expect(getOpenTabs()).toEqual(["ws-2:two-only.ts"]));
    expect(getSavedTabPaths("ws-1")).toEqual(["one-only.ts"]);
    expect(getSavedTabPaths("ws-2")).toEqual(["two-only.ts"]);
  });

  it("drops a restore that finishes after switching to another workspace", async () => {
    // Given
    seedWorkspaceOneTabOpen();
    useEditorStore.setState({ openFiles: [], activeFilePath: null });
    let finishWorkspaceOne: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes("workspaceId=ws-1")
          ? new Promise<Response>((resolve) => {
              finishWorkspaceOne = resolve;
            })
          : Promise.resolve(
              Response.json({ content: "two", language: "typescript" }),
            ),
      ),
    );
    renderFilesPage();
    act(() => useWorkspaceStore.getState().setActiveWorkspaceId("ws-2"));
    await waitFor(() => expect(getOpenTabs()).toEqual(["ws-2:two-only.ts"]));

    // When
    await act(async () => {
      finishWorkspaceOne(
        Response.json({ content: "one", language: "typescript" }),
      );
    });

    // Then
    expect(getOpenTabs()).toEqual(["ws-2:two-only.ts"]);
  });

  it("keeps the saved tabs while they are still loading", () => {
    // Given
    seedWorkspaceOneTabOpen();
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-2" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    // When
    renderFilesPage();

    // Then
    expect(getSavedTabPaths("ws-2")).toEqual(["two-only.ts"]);
  });
});
