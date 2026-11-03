import type { Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";

import type { MonacoEditorHandle } from "@/components/editor/monaco-editor";
import { FileTabPanel } from "@/components/workbench/tabs/file-tab-panel";
import { WORKBENCH_PANEL_COMPONENTS } from "@/components/workbench/tab-registry";
import { IMAGE_LANGUAGE, PDF_LANGUAGE } from "@/lib/file-preview";
import { getFocusedFileTabCommands } from "@/lib/workbench/focused-file-tab-commands";
import { useContentSearchStore } from "@/stores/content-search-store";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { GitStatusResult } from "@/types";
import {
  createFileBuffer,
  createGitStatus,
  fileTabParams,
  renderFileTabs,
  WORKSPACE_ID,
} from "./file-tab-fixtures";

interface DiffViewProps {
  readonly workspaceId: string;
  readonly filePath: string;
  readonly staged?: boolean;
  readonly baseRef?: string | null;
}

const doubles = vi.hoisted(() => {
  const registeredLeaderActions = new Map<string, () => void>();
  return {
    gitStatus: { current: undefined as GitStatusResult | undefined },
    diffViewProps: [] as DiffViewProps[],
    focusedEditorPaths: [] as string[],
    neovimMountPaths: [] as string[],
    lintFile: vi.fn(async () => {}),
    registeredLeaderActions,
    registerAction: vi.fn((action: { id: string }, handler: () => void) => {
      registeredLeaderActions.set(action.id, handler);
    }),
    deregisterAction: vi.fn((actionId: string) => {
      registeredLeaderActions.delete(actionId);
    }),
  };
});

// Next aliases next/dynamic to app-dynamic for the app router; unlike the
// pages loader vitest would resolve, it forwards refs to the loaded editor.
vi.mock("next/dynamic", async () => ({
  default: (await import("next/dist/shared/lib/app-dynamic")).default,
}));

vi.mock("@/components/editor/monaco-editor", async () => {
  const { useImperativeHandle } = await import("react");
  return {
    MonacoEditor: (props: {
      readonly filePath?: string;
      readonly ref?: Ref<MonacoEditorHandle>;
    }) => {
      const { filePath = "", ref } = props;
      useImperativeHandle(ref, () => ({
        focus: () => doubles.focusedEditorPaths.push(filePath),
        blur: () => {},
        revealLine: () => {},
      }));
      return <div data-testid="monaco-editor" data-path={filePath} />;
    },
  };
});

vi.mock("@/components/editor/neovim-editor", async () => {
  const { useEffect } = await import("react");
  return {
    NeovimEditor: ({ filePath = "" }: { readonly filePath?: string }) => {
      useEffect(() => {
        doubles.neovimMountPaths.push(filePath);
      }, [filePath]);
      return <div data-testid="neovim-editor" data-path={filePath} />;
    },
  };
});

vi.mock("@/components/workbench/workbench-diff-view", () => ({
  WorkbenchDiffView: (props: DiffViewProps) => {
    doubles.diffViewProps.push(props);
    return <div data-testid="workbench-diff-view" />;
  },
}));

vi.mock("@/components/chat/chat-interface", () => ({
  ChatInterface: () => null,
}));

vi.mock("@/hooks/use-git", () => ({
  useGitStatus: () => ({ data: doubles.gitStatus.current }),
}));

vi.mock("@/hooks/use-diagnostics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-diagnostics")>()),
  useLintOnSave: () => ({ lintFile: doubles.lintFile, isLinting: false }),
}));

vi.mock("@/components/providers/leader-key-provider", () => ({
  useLeaderKey: () => ({
    registerAction: doubles.registerAction,
    deregisterAction: doubles.deregisterAction,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

type FetchReply = (init: RequestInit | undefined) => Promise<Response>;

const fileContentReply = { current: (() => notFound()) as FetchReply };
const saveReply = {
  current: (() =>
    Promise.resolve(Response.json({ success: true }))) as FetchReply,
};
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  if (url === "/api/files/content" && init?.method === "PUT") {
    return saveReply.current(init);
  }
  if (url.startsWith("/api/files/content?")) {
    return fileContentReply.current(init);
  }
  return Promise.reject(new Error(`Unexpected fetch ${url}`));
});

function notFound(): Promise<Response> {
  return Promise.resolve(
    Response.json({ error: "not found" }, { status: 404 }),
  );
}

function fileContentRequests(): unknown[][] {
  return fetchMock.mock.calls.filter(([url]) =>
    url.startsWith("/api/files/content?"),
  );
}

function savedBodies(): unknown[] {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === "PUT")
    .map(([, init]) => JSON.parse(String(init?.body)));
}

function seedBuffers(...buffers: ReturnType<typeof createFileBuffer>[]): void {
  useEditorStore.setState({ openFiles: buffers });
}

function clickSave(): void {
  fireEvent.click(screen.getByTestId("file-tab-save"));
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  fileContentReply.current = () => notFound();
  saveReply.current = () => Promise.resolve(Response.json({ success: true }));
  doubles.gitStatus.current = createGitStatus();
  doubles.diffViewProps.length = 0;
  doubles.focusedEditorPaths.length = 0;
  doubles.neovimMountPaths.length = 0;
  doubles.registeredLeaderActions.clear();
  doubles.lintFile.mockClear();
  doubles.registerAction.mockClear();
  doubles.deregisterAction.mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useContextSidebarStore.setState(
    useContextSidebarStore.getInitialState(),
    true,
  );
  useWorkspaceStore.setState({ activeWorkspaceId: WORKSPACE_ID });
  useEditorStore.setState({
    openFiles: [],
    activeFilePath: null,
    fileViewModes: {},
    markdownPreviewPath: null,
    csvPreviewPath: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FileTabPanel registration", () => {
  it("is the workbench body of file tabs", () => {
    // Then
    expect(WORKBENCH_PANEL_COMPONENTS.file).toBe(FileTabPanel);
  });
});

describe("FileTabPanel restored without a buffer", () => {
  it("loads its file into a buffer of its own workspace", async () => {
    // Given
    fileContentReply.current = () =>
      Promise.resolve(
        Response.json({ content: "# Readme\n", language: "markdown" }),
      );

    // When
    renderFileTabs([{ panelId: "tab-readme", path: "README.md" }]);

    // Then
    expect(await screen.findByTestId("monaco-editor")).toHaveAttribute(
      "data-path",
      "README.md",
    );
    expect(useEditorStore.getState().openFiles).toEqual([
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        path: "README.md",
        content: "# Readme\n",
      }),
    ]);
  });

  it("shows that the file is gone instead of an editor", async () => {
    // When
    renderFileTabs([{ panelId: "tab-readme", path: "README.md" }]);

    // Then
    expect(
      await screen.findByText("File not found: README.md"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
  });

  it("closes the tab from the not-found notice", async () => {
    // Given
    const { api } = renderFileTabs([
      { panelId: "tab-readme", path: "README.md" },
    ]);
    const closeButton = await screen.findByRole("button", {
      name: "Close tab",
    });

    // When
    act(() => fireEvent.click(closeButton));

    // Then
    expect(api.getPanel("tab-readme")).toBeUndefined();
  });

  it("refuses to load over another workspace's unsaved buffer", async () => {
    // Given
    seedBuffers(
      createFileBuffer("README.md", {
        workspaceId: "ws2",
        content: "unsaved",
        isDirty: true,
      }),
    );

    // When
    renderFileTabs([{ panelId: "tab-readme", path: "README.md" }]);

    // Then
    expect(
      screen.getByText(
        "This file has unsaved changes in another workspace. Save or discard them there first.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close tab" }),
    ).toBeInTheDocument();
    expect(fileContentRequests()).toEqual([]);
  });
});

describe("FileTabPanel save", () => {
  it("saves its own file while another file is the editor's active one", async () => {
    // Given
    seedBuffers(
      createFileBuffer("a.ts", {
        content: "v1",
        originalContent: "base",
        isDirty: true,
      }),
      createFileBuffer("b.ts"),
    );
    useEditorStore.setState({ activeFilePath: "b.ts" });
    renderFileTabs([{ panelId: "tab-a", path: "a.ts" }]);

    // When
    clickSave();

    // Then
    await waitFor(() => expect(savedBodies()).toHaveLength(1));
    expect(savedBodies()[0]).toEqual({
      workspaceId: WORKSPACE_ID,
      path: "a.ts",
      content: "v1",
    });
  });

  it.each([false, true])(
    "keeps text typed during the save dirty, LSP=%s",
    async (isLspEnabled) => {
      // Given
      let finishSave: (response: Response) => void = () => {};
      saveReply.current = () =>
        new Promise<Response>((resolve) => {
          finishSave = resolve;
        });
      seedBuffers(
        createFileBuffer("a.ts", {
          content: "v1",
          originalContent: "base",
          isDirty: true,
        }),
      );
      const { invalidateQueries } = renderFileTabs(
        [{ panelId: "tab-a", path: "a.ts" }],
        { isLspEnabled },
      );
      clickSave();
      await waitFor(() => expect(savedBodies()).toHaveLength(1));
      act(() => useEditorStore.getState().updateFileContent("a.ts", "v2"));

      // When
      await act(async () => {
        finishSave(Response.json({ success: true }));
      });

      // Then
      expect(savedBodies()[0]).toEqual({
        workspaceId: WORKSPACE_ID,
        path: "a.ts",
        content: "v1",
        ...(isLspEnabled ? { baseContent: "base" } : {}),
      });
      await waitFor(() =>
        expect(useEditorStore.getState().openFiles[0].originalContent).toBe(
          "v1",
        ),
      );
      expect(useEditorStore.getState().openFiles[0]).toMatchObject({
        content: "v2",
        isDirty: true,
      });
      expect(doubles.lintFile).toHaveBeenCalledOnce();
      expect(invalidateQueries).toHaveBeenCalledExactlyOnceWith({
        queryKey: ["git-status", WORKSPACE_ID],
      });
      expect(toast.success).toHaveBeenCalledExactlyOnceWith("Saved");
    },
  );

  it("skips the save follow-ups after a workspace switch", async () => {
    // Given
    let finishSave: (response: Response) => void = () => {};
    saveReply.current = () =>
      new Promise<Response>((resolve) => {
        finishSave = resolve;
      });
    seedBuffers(createFileBuffer("a.ts", { content: "v1", isDirty: true }));
    const { invalidateQueries } = renderFileTabs([
      { panelId: "tab-a", path: "a.ts" },
    ]);
    clickSave();
    await waitFor(() => expect(savedBodies()).toHaveLength(1));
    act(() => useWorkspaceStore.setState({ activeWorkspaceId: "ws2" }));

    // When
    await act(async () => {
      finishSave(Response.json({ success: true }));
    });

    // Then
    await waitFor(() =>
      expect(useEditorStore.getState().openFiles[0].isDirty).toBe(false),
    );
    expect(doubles.lintFile).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("shows a stale-base error without acknowledging the save", async () => {
    // Given
    saveReply.current = () =>
      Promise.resolve(
        Response.json({ error: "disk changed" }, { status: 409 }),
      );
    seedBuffers(
      createFileBuffer("a.ts", {
        content: "v1",
        originalContent: "base",
        isDirty: true,
      }),
    );
    const { invalidateQueries } = renderFileTabs([
      { panelId: "tab-a", path: "a.ts" },
    ]);

    // When
    clickSave();

    // Then
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("disk changed"),
    );
    expect(useEditorStore.getState().openFiles[0]).toMatchObject({
      originalContent: "base",
      isDirty: true,
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});

describe("FileTabPanel previews", () => {
  it("previews an image instead of loading it as text", async () => {
    // When
    renderFileTabs([{ panelId: "tab-logo", path: "assets/logo.png" }]);

    // Then
    expect(
      await screen.findByRole("img", { name: "logo.png" }),
    ).toHaveAttribute(
      "src",
      "/api/files/raw?workspaceId=ws1&path=assets%2Flogo.png",
    );
    expect(fileContentRequests()).toEqual([]);
    expect(screen.queryByText(/File not found/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-tab-save")).not.toBeInTheDocument();
    expect(useEditorStore.getState().openFiles[0]?.language).toBe(
      IMAGE_LANGUAGE,
    );
  });

  it("renders the PDF viewer instead of the text editor", () => {
    // Given
    seedBuffers(
      createFileBuffer("docs/spec.pdf", {
        content: "",
        originalContent: "",
        language: PDF_LANGUAGE,
      }),
    );

    // When
    renderFileTabs([{ panelId: "tab-spec", path: "docs/spec.pdf" }]);

    // Then
    expect(screen.getByTestId("pdf-viewer")).toHaveAttribute(
      "src",
      "/api/files/raw?workspaceId=ws1&path=docs%2Fspec.pdf",
    );
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-tab-save")).not.toBeInTheDocument();
  });

  it("offers a download of the raw PDF", () => {
    // Given
    seedBuffers(
      createFileBuffer("docs/spec.pdf", {
        content: "",
        originalContent: "",
        language: PDF_LANGUAGE,
      }),
    );

    // When
    renderFileTabs([{ panelId: "tab-spec", path: "docs/spec.pdf" }]);

    // Then
    const downloadLink = screen.getByRole("link", { name: "Download file" });
    expect(downloadLink).toHaveAttribute(
      "href",
      "/api/files/raw?workspaceId=ws1&path=docs%2Fspec.pdf",
    );
    expect(downloadLink).toHaveAttribute("download", "spec.pdf");
  });

  it("offers a download for a file the editor cannot display", async () => {
    // Given
    fileContentReply.current = () =>
      Promise.resolve(Response.json({ error: "binary" }, { status: 415 }));

    // When
    renderFileTabs([{ panelId: "tab-zip", path: "build/app.zip" }]);

    // Then
    expect(
      await screen.findByText("This file can't be displayed in the editor."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-tab-save")).not.toBeInTheDocument();
    for (const name of ["Download", "Download file"]) {
      const downloadLink = screen.getByRole("link", { name });
      expect(downloadLink).toHaveAttribute(
        "href",
        "/api/files/raw?workspaceId=ws1&path=build%2Fapp.zip&download=1",
      );
      expect(downloadLink).toHaveAttribute("download", "app.zip");
    }
  });
});

describe("FileTabPanel editor/diff toggle", () => {
  it("opens a file git lists as changed in the editor with the toggle shown", async () => {
    // Given
    doubles.gitStatus.current = createGitStatus({ unstaged: ["src/a.ts"] });
    seedBuffers(createFileBuffer("src/a.ts"));

    // When
    renderFileTabs([{ panelId: "tab-a", path: "src/a.ts" }]);

    // Then
    expect(await screen.findByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.getByTestId("file-view-toggle-editor")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches the body to the working-tree diff", async () => {
    // Given
    doubles.gitStatus.current = createGitStatus({ unstaged: ["src/a.ts"] });
    seedBuffers(createFileBuffer("src/a.ts"));
    renderFileTabs([{ panelId: "tab-a", path: "src/a.ts" }]);
    await screen.findByTestId("monaco-editor");

    // When
    fireEvent.click(screen.getByTestId("file-view-toggle-diff"));

    // Then
    expect(screen.getByTestId("workbench-diff-view")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-editor")).not.toBeInTheDocument();
    expect(doubles.diffViewProps.at(-1)).toEqual({
      workspaceId: WORKSPACE_ID,
      filePath: "src/a.ts",
      staged: false,
    });
    expect(useEditorStore.getState().fileViewModes).toEqual({
      "ws1:src/a.ts": "diff",
    });
  });

  it("diffs the staged change of a file with nothing unstaged", () => {
    // Given
    doubles.gitStatus.current = createGitStatus({ staged: ["src/a.ts"] });
    seedBuffers(createFileBuffer("src/a.ts"));
    renderFileTabs([{ panelId: "tab-a", path: "src/a.ts" }]);

    // When
    fireEvent.click(screen.getByTestId("file-view-toggle-diff"));

    // Then
    expect(doubles.diffViewProps.at(-1)?.staged).toBe(true);
  });

  it("switches back to the editor and keeps that choice", async () => {
    // Given
    doubles.gitStatus.current = createGitStatus({ unstaged: ["src/a.ts"] });
    useEditorStore.setState({ fileViewModes: { "ws1:src/a.ts": "diff" } });
    seedBuffers(createFileBuffer("src/a.ts"));
    renderFileTabs([{ panelId: "tab-a", path: "src/a.ts" }]);
    expect(screen.getByTestId("workbench-diff-view")).toBeInTheDocument();

    // When
    fireEvent.click(screen.getByTestId("file-view-toggle-editor"));

    // Then
    expect(await screen.findByTestId("monaco-editor")).toBeInTheDocument();
    expect(useEditorStore.getState().fileViewModes["ws1:src/a.ts"]).toBe(
      "editor",
    );
  });

  it.each([
    ["has no changes", createGitStatus()],
    ["is outside a git repository", createGitStatus({ isRepo: false })],
  ])("hides the toggle when the file %s", async (_, status) => {
    // Given
    doubles.gitStatus.current = status;
    seedBuffers(createFileBuffer("src/a.ts"));

    // When
    renderFileTabs([{ panelId: "tab-a", path: "src/a.ts" }]);

    // Then
    expect(await screen.findByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("file-view-toggle")).not.toBeInTheDocument();
  });

  it("never renders a stored diff for a file without changes", async () => {
    // Given
    useEditorStore.setState({ fileViewModes: { "ws1:src/a.ts": "diff" } });
    seedBuffers(createFileBuffer("src/a.ts"));

    // When
    renderFileTabs([{ panelId: "tab-a", path: "src/a.ts" }]);

    // Then
    expect(await screen.findByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("workbench-diff-view")).not.toBeInTheDocument();
  });

  it("ignores the view mode another workspace stored for the same path", async () => {
    // Given
    doubles.gitStatus.current = createGitStatus({ unstaged: ["src/a.ts"] });
    useEditorStore.setState({ fileViewModes: { "ws2:src/a.ts": "diff" } });
    seedBuffers(createFileBuffer("src/a.ts"));

    // When
    renderFileTabs([{ panelId: "tab-a", path: "src/a.ts" }]);

    // Then
    expect(await screen.findByTestId("monaco-editor")).toBeInTheDocument();
    expect(screen.queryByTestId("workbench-diff-view")).not.toBeInTheDocument();
  });

  // Monaco's diff panes force `visibility: visible`, so a hidden tab's diff
  // would paint through dockview's hidden overlay.
  it("keeps the diff unmounted while another tab of its group is shown", async () => {
    // Given
    doubles.gitStatus.current = createGitStatus({ unstaged: ["src/a.ts"] });
    useEditorStore.setState({ fileViewModes: { "ws1:src/a.ts": "diff" } });
    seedBuffers(createFileBuffer("src/a.ts"), createFileBuffer("src/b.ts"));

    // When
    renderFileTabs([
      { panelId: "tab-a", path: "src/a.ts" },
      { panelId: "tab-b", path: "src/b.ts" },
    ]);
    await screen.findByTestId("monaco-editor");

    // Then
    expect(screen.queryByTestId("workbench-diff-view")).not.toBeInTheDocument();
  });

  it("mounts the diff once its tab is shown", async () => {
    // Given
    doubles.gitStatus.current = createGitStatus({ unstaged: ["src/a.ts"] });
    useEditorStore.setState({ fileViewModes: { "ws1:src/a.ts": "diff" } });
    seedBuffers(createFileBuffer("src/a.ts"), createFileBuffer("src/b.ts"));
    const { api } = renderFileTabs([
      { panelId: "tab-a", path: "src/a.ts" },
      { panelId: "tab-b", path: "src/b.ts" },
    ]);
    await screen.findByTestId("monaco-editor");

    // When
    act(() => api.getPanel("tab-a")?.api.setActive());

    // Then
    expect(screen.getByTestId("workbench-diff-view")).toBeInTheDocument();
  });
});

describe("FileTabPanel with Neovim", () => {
  function seedTwoBuffers(): void {
    seedBuffers(createFileBuffer("a.ts"), createFileBuffer("b.ts"));
  }

  it("mounts Neovim only in the last focused of two visible file tabs", async () => {
    // Given
    seedTwoBuffers();

    // When
    renderFileTabs(
      [
        { panelId: "tab-a", path: "a.ts" },
        { panelId: "tab-b", path: "b.ts", isBeside: true },
      ],
      { editorType: "neovim" },
    );

    // Then
    expect(await screen.findByTestId("neovim-editor")).toHaveAttribute(
      "data-path",
      "b.ts",
    );
    expect(screen.getAllByTestId("neovim-editor")).toHaveLength(1);
    expect(doubles.neovimMountPaths).toEqual(["b.ts"]);
    expect(
      screen.getAllByRole("button", { name: "Click to edit in Neovim" }),
    ).toHaveLength(1);
  });

  it("activates a placeholder tab when its button is clicked", async () => {
    // Given
    seedTwoBuffers();
    const { setActiveSpies } = renderFileTabs(
      [
        { panelId: "tab-a", path: "a.ts" },
        { panelId: "tab-b", path: "b.ts", isBeside: true },
      ],
      { editorType: "neovim" },
    );
    await screen.findByTestId("neovim-editor");

    // When
    act(() =>
      fireEvent.click(
        screen.getByRole("button", { name: "Click to edit in Neovim" }),
      ),
    );

    // Then
    expect(setActiveSpies.get("tab-a")).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("neovim-editor")).toHaveAttribute(
        "data-path",
        "a.ts",
      ),
    );
    expect(screen.getAllByTestId("neovim-editor")).toHaveLength(1);
  });

  it("renders no editor in a last-focused file tab that is hidden", async () => {
    // Given
    seedTwoBuffers();
    renderFileTabs(
      [
        { panelId: "tab-a", path: "a.ts" },
        { panelId: "tab-b", path: "b.ts" },
      ],
      { editorType: "neovim" },
    );

    // When
    act(() =>
      useWorkbenchStore.getState().setFocusedPanel({
        workspaceId: WORKSPACE_ID,
        panelId: "tab-a",
        params: fileTabParams("a.ts"),
      }),
    );

    // Then
    expect(
      await screen.findAllByRole("button", { name: "Click to edit in Neovim" }),
    ).toHaveLength(1);
    expect(screen.queryByTestId("neovim-editor")).not.toBeInTheDocument();
    expect(doubles.neovimMountPaths).not.toContain("a.ts");
  });
});

describe("FileTabPanel leader actions", () => {
  function renderTwoTabs() {
    seedBuffers(
      createFileBuffer("a.ts", { content: "a1", isDirty: true }),
      createFileBuffer("b.ts", { content: "b1", isDirty: true }),
    );
    return renderFileTabs([
      { panelId: "tab-a", path: "a.ts" },
      { panelId: "tab-b", path: "b.ts", isBeside: true },
    ]);
  }

  function registeredCount(actionId: string): number {
    return doubles.registerAction.mock.calls.filter(
      ([action]) => action.id === actionId,
    ).length;
  }

  function runLeaderAction(actionId: string): void {
    const handler = doubles.registeredLeaderActions.get(actionId);
    if (!handler) throw new Error(`${actionId} is not registered`);
    act(() => handler());
  }

  it("registers the files actions for the focused tab only", () => {
    // When
    renderTwoTabs();

    // Then
    expect(registeredCount("files:save")).toBe(1);
    expect([...doubles.registeredLeaderActions.keys()].sort()).toEqual([
      "files:focus-editor",
      "files:focus-search",
      "files:focus-tree",
      "files:save",
    ]);
    expect(getFocusedFileTabCommands()?.tabId).toBe("tab-b");
  });

  it("saves the newly focused tab's file through files:save", async () => {
    // Given
    const { api } = renderTwoTabs();
    act(() => api.getPanel("tab-a")?.api.setActive());

    // When
    runLeaderAction("files:save");

    // Then
    await waitFor(() => expect(savedBodies()).toHaveLength(1));
    expect(savedBodies()[0]).toMatchObject({ path: "a.ts", content: "a1" });
    expect(registeredCount("files:save")).toBe(2);
    expect(doubles.deregisterAction).toHaveBeenCalledWith("files:save");
  });

  it("focuses the focused tab's editor through files:focus-editor", async () => {
    // Given
    renderTwoTabs();
    await waitFor(() =>
      expect(screen.getAllByTestId("monaco-editor")).toHaveLength(2),
    );

    // When
    runLeaderAction("files:focus-editor");

    // Then
    expect(doubles.focusedEditorPaths).toEqual(["b.ts"]);
  });

  it("opens the explorer and asks it to focus the tree", () => {
    // Given
    renderTwoTabs();
    useContextSidebarStore.setState({ isOpen: false, view: "changes" });

    // When
    runLeaderAction("files:focus-tree");

    // Then
    expect(useContextSidebarStore.getState()).toMatchObject({
      isOpen: true,
      view: "explorer",
      focusRequest: "tree",
    });
  });

  it("opens the explorer file search and asks it to take focus", () => {
    // Given
    renderTwoTabs();
    useContentSearchStore.getState().setSidebarView("search");

    // When
    runLeaderAction("files:focus-search");

    // Then
    expect(useContentSearchStore.getState().sidebarView).toBe("explorer");
    expect(useContextSidebarStore.getState()).toMatchObject({
      isOpen: true,
      view: "explorer",
      focusRequest: "file-search",
    });
  });
});
