import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitPanel } from "@/components/git/git-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { OpenFileInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import type { GitStatusResult, Workspace } from "@/types";

const hoisted = vi.hoisted(() => {
  const gitStatus: GitStatusResult = {
    isRepo: true,
    branch: "main",
    tracking: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [{ path: "src/a.ts", index: " ", workingDir: "M" }],
    untracked: [],
    conflicted: [],
    lastCommit: null,
  };
  return {
    gitStatus,
    routerPush: vi.fn<(href: string) => void>(),
    openFileInWorkbench: vi.fn<
      (input: OpenFileInWorkbenchInput) => Promise<boolean>
    >(async () => true),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: hoisted.routerPush }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-settings")>()),
  useFileTabsSetting: () => ({ isFileTabsDisabled: true, isLoading: false }),
}));
vi.mock("@/components/providers/leader-key-provider", () => ({
  useLeaderKey: () => ({ registerAction: vi.fn(), deregisterAction: vi.fn() }),
}));
vi.mock("@/lib/workbench/open-in-workbench", () => ({
  openFileInWorkbench: hoisted.openFileInWorkbench,
}));
vi.mock("@/hooks/use-git", () => {
  const query = (data: unknown) => () => ({ data, isLoading: false });
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    useGitStatus: query(hoisted.gitStatus),
    useGitLog: query([]),
    useGitBranches: query([]),
    useGitStashList: query([]),
    useGitFileDiffs: () => new Map(),
    useGitChangedFiles: query([]),
    useGitFileContent: query({
      original: "export const a = 1;\n",
      current: "export const a = 2;\n",
      path: "src/a.ts",
      language: "typescript",
    }),
    useGitFileContentAtRef: query(undefined),
    useGitStage: mutation,
    useGitUnstage: mutation,
    useGitDiscard: mutation,
    useGitCommit: mutation,
    useGitPush: mutation,
    useGitPull: mutation,
    useGitFetch: mutation,
    useGitCreateBranch: mutation,
    useGitSwitchBranch: mutation,
    useGitDeleteBranch: mutation,
    useGitStashSave: mutation,
    useGitStashPop: mutation,
    useGitStashDrop: mutation,
  };
});
vi.mock("@/components/review/review-editor", () => ({
  ReviewEditor: ({ onOpenInEditor }: { onOpenInEditor?: () => void }) => (
    <button type="button" onClick={onOpenInEditor}>
      Open in editor
    </button>
  ),
}));
vi.mock("@/components/git/file-status", () => ({ FileStatusList: () => null }));
vi.mock("@/components/git/changed-file-list", () => ({
  ChangedFileList: () => null,
}));
vi.mock("@/components/git/commit-panel", () => ({ CommitPanel: () => null }));
vi.mock("@/components/git/branch-selector", () => ({
  BranchSelector: () => null,
}));
vi.mock("@/components/git/commit-log", () => ({ CommitLog: () => null }));

const workspace: Workspace = {
  id: "ws-1",
  userId: "user-1",
  name: "qa-repo",
  path: "/repos/qa-repo",
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

function renderPanelWithSelectedFile(path: string) {
  // The git picker hands the selected file over through this key.
  localStorage.setItem("dev-hub:git-picker-selected-file", path);
  render(
    <TooltipProvider>
      <GitPanel workspace={workspace} onClose={vi.fn()} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("GitPanel open in editor", () => {
  it("opens the selected file as a workbench tab", async () => {
    // Given
    renderPanelWithSelectedFile("src/a.ts");

    // When
    await userEvent.click(
      screen.getByRole("button", { name: "Open in editor" }),
    );

    // Then
    expect(hoisted.openFileInWorkbench).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        path: "src/a.ts",
        isFileTabsDisabled: true,
      }),
    );
    expect(hoisted.routerPush).not.toHaveBeenCalled();
  });

  it("routes the opener's navigation through the router", async () => {
    // Given
    renderPanelWithSelectedFile("src/a.ts");
    await userEvent.click(
      screen.getByRole("button", { name: "Open in editor" }),
    );

    // When
    hoisted.openFileInWorkbench.mock.lastCall?.[0].navigate("/workbench?x=1");

    // Then
    expect(hoisted.routerPush).toHaveBeenCalledExactlyOnceWith(
      "/workbench?x=1",
    );
  });
});
