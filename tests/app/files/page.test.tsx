import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { FileTreeEntry, Workspace } from "@/types";

interface LeaderRegistration {
  action: { id: string };
  handler: () => void;
}

let searchParams = new URLSearchParams();
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

vi.mock("@/components/editor/open-editors", () => ({
  OpenEditors: () => null,
}));

vi.mock("@/components/editor/file-tabs", () => ({
  FileTabs: () => null,
}));

vi.mock("@/components/editor/editor-switcher", () => ({
  EditorSwitcher: () => <div data-testid="editor-switcher" />,
}));

vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-settings")>()),
  useFileTabsSetting: () => ({ isFileTabsDisabled: false, isLoading: false }),
}));

vi.mock("@/hooks/use-git", () => ({
  useGitStatus: () => ({ data: undefined }),
}));

vi.mock("@/hooks/use-diagnostics", () => ({
  useLintOnSave: () => ({ lintFile: vi.fn() }),
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

beforeEach(() => {
  vi.unstubAllGlobals();
  searchParams = new URLSearchParams();
  leaderRegistrations = [];
  useWorkspaceStore.setState({
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
  });
  useEditorStore.setState({
    openFiles: [],
    activeFilePath: null,
    isFileTreeOpen: true,
    workspaceFileStates: {},
  });
});

describe("FilesPage image preview", () => {
  it("previews an image clicked in the explorer instead of loading it as text", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<FilesPage />);

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

    render(<FilesPage />);

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

    render(<FilesPage />);

    await waitFor(() =>
      expect(useEditorStore.getState().openFiles).toHaveLength(2),
    );
    expect(useEditorStore.getState().activeFilePath).toBe("assets/logo.png");
    expect(screen.getByRole("img", { name: "logo.png" })).toHaveAttribute(
      "src",
      RAW_LOGO_URL,
    );
  });

  it("never writes an image tab back to disk from the save shortcut", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<FilesPage />);
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
