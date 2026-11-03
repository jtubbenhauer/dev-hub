import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskWorktreeDialog } from "@/components/dashboard/task-worktree-dialog";
import { createWorkbenchHref } from "@/lib/workbench/workbench-href";
import { usePendingChatStore } from "@/stores/pending-chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ClickUpTask, Workspace } from "@/types";

const navigation = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

const createdWorktree = vi.hoisted(() => ({
  workspace: {
    id: "ws-worktree",
    userId: "user-1",
    name: "repo/fix-the-login-flow",
    path: "/workspace/repo-worktrees/fix-the-login-flow",
    type: "worktree" as const,
    parentRepoPath: "/workspace/repo",
    packageManager: null,
    quickCommands: null,
    backend: "local" as const,
    provider: null,
    opencodeUrl: null,
    agentUrl: null,
    providerMeta: null,
    shellCommand: null,
    sshTarget: null,
    sshPath: null,
    worktreeSymlinks: null,
    linkedTaskId: "task-1",
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date("2025-01-01"),
    lastAccessedAt: new Date("2025-01-01"),
  },
}));

vi.mock("@/hooks/use-git", () => ({
  useCreateWorktree: () => ({
    isPending: false,
    mutate: (
      _input: unknown,
      options: { onSuccess: (data: { workspace: Workspace }) => void },
    ) => options.onSuccess({ workspace: createdWorktree.workspace }),
  }),
  useWorktreeSymlinks: () => ({ data: undefined }),
}));

const TASK: ClickUpTask = {
  id: "task-1",
  custom_id: null,
  name: "Fix the login flow",
  status: { status: "open", color: "#888888", type: "open" },
  priority: null,
  assignees: [],
  due_date: null,
  date_created: "1700000000000",
  date_updated: "1700000000000",
  date_closed: null,
  url: "https://app.clickup.com/t/task-1",
  list: { id: "list-1", name: "Backlog" },
  folder: { id: "folder-1", name: "hidden" },
  space: { id: "space-1" },
  tags: [],
};

const PARENT_REPO: Workspace = {
  ...createdWorktree.workspace,
  id: "ws-repo",
  name: "Parent Repo",
  path: "/workspace/repo",
  type: "repo",
  parentRepoPath: null,
  linkedTaskId: null,
};

beforeEach(() => {
  navigation.push.mockReset();
  useWorkspaceStore.setState({
    workspaces: [PARENT_REPO],
    activeWorkspaceId: PARENT_REPO.id,
  });
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
  usePendingChatStore.setState({ pending: null });
});

describe("TaskWorktreeDialog", () => {
  it("opens the new worktree's chat in the workbench after creating it", async () => {
    // Given
    render(
      <TaskWorktreeDialog task={TASK} open={true} onOpenChange={vi.fn()} />,
    );
    await userEvent.click(screen.getByText("Parent Repo"));

    // When
    await userEvent.click(
      screen.getByRole("button", { name: "Create Worktree" }),
    );

    // Then
    expect(navigation.push).toHaveBeenCalledWith(
      createWorkbenchHref({
        open: "chat",
        workspaceId: "ws-worktree",
        sessionId: null,
      }),
    );
  });
});
