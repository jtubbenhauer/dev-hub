import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { GitStatusResult, Workspace } from "@/types";

vi.mock("@/hooks/use-git", () => ({
  useGitStatus: vi.fn(),
}));

vi.mock("@/components/chat/git-tab-panel", () => ({
  GitTabPanel: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="git-tab-panel">git:{workspaceId}</div>
  ),
}));

vi.mock("@/components/chat/git-branch-compare-panel", () => ({
  GitBranchComparePanel: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="git-branch-compare-panel">compare:{workspaceId}</div>
  ),
}));

vi.mock("@/components/chat/split-panel-files", () => ({
  SplitPanelFiles: () => <div data-testid="split-panel-files" />,
}));

vi.mock("@/components/chat/mcp-status", () => ({
  McpStatusPanel: () => <div data-testid="mcp-status" />,
}));

vi.mock("@/components/chat/session-files-panel", () => ({
  SessionFilesPanel: () => <div data-testid="session-files" />,
}));

vi.mock("@/components/chat/task-progress", () => ({
  TaskProgressPanel: () => <div data-testid="task-progress" />,
}));

vi.mock("@/components/chat/workspace-context-panel", () => ({
  WorkspaceContextPanel: () => <div data-testid="workspace-context" />,
}));

import { SidePanel } from "@/components/chat/side-panel";
import { useGitStatus } from "@/hooks/use-git";
import { useSidePanelStore } from "@/stores/side-panel-store";

const mockUseGitStatus = useGitStatus as unknown as ReturnType<typeof vi.fn>;

function makeStatus(overrides: Partial<GitStatusResult>): GitStatusResult {
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

const workspace = { id: "ws-1", name: "repo" } as unknown as Workspace;

function renderPanel() {
  return render(
    <TooltipProvider>
      <SidePanel
        width={320}
        handleDragStart={vi.fn()}
        workspaceId="ws-1"
        workspace={workspace}
        activeTodos={[]}
        messages={[]}
        workspacePath="/repo"
      />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useSidePanelStore.getState().setActivePanelTab("status");
  mockUseGitStatus.mockReturnValue({ data: makeStatus({}) });
});

describe("SidePanel tabs", () => {
  it("renders tab buttons: Status, Files, Git, Compare", () => {
    renderPanel();

    expect(
      screen.getByRole("button", { name: "Branch comparison" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Status/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Files/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Working changes" }),
    ).toBeInTheDocument();
  });

  it("activates GitTabPanel when the Git tab is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.queryByTestId("git-tab-panel")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Working changes" }));

    expect(screen.getByTestId("git-tab-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-status")).not.toBeInTheDocument();
  });

  it("activates GitBranchComparePanel when the Compare tab is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "Branch comparison" }));

    expect(screen.getByTestId("git-branch-compare-panel")).toHaveTextContent(
      "compare:ws-1",
    );
    expect(screen.queryByTestId("git-tab-panel")).not.toBeInTheDocument();
    expect(useSidePanelStore.getState().activePanelTab).toBe("compare");
  });

  it("shows the unique-path count badge (conflicted/staged+unstaged counted once)", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "a.ts", index: "M", workingDir: " " }],
        unstaged: [
          { path: "a.ts", index: "M", workingDir: "M" },
          { path: "b.ts", index: " ", workingDir: "M" },
        ],
        untracked: ["c.ts"],
        conflicted: ["a.ts"],
      }),
    });

    renderPanel();

    // Unique paths across all buckets: a.ts, b.ts, c.ts => 3
    expect(
      screen.getByRole("button", { name: "Working changes" }),
    ).toHaveTextContent("3");
  });

  it("does not render a badge when there are no changes", () => {
    mockUseGitStatus.mockReturnValue({ data: makeStatus({}) });

    renderPanel();

    const gitButton = screen.getByRole("button", { name: "Working changes" });
    expect(gitButton).toHaveTextContent("");
    expect(gitButton.querySelector("span")).toBeNull();
  });

  it("does not count paths when isRepo is false", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        isRepo: false,
        staged: [{ path: "a.ts", index: "M", workingDir: " " }],
      }),
    });

    renderPanel();

    const gitButton = screen.getByRole("button", { name: "Working changes" });
    expect(gitButton.querySelector("span")).toBeNull();
  });
});
