import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel";
import { createWorkbenchHref } from "@/lib/workbench/workbench-href";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ClickUpTask, Workspace } from "@/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/use-clickup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-clickup")>()),
  useClickUpTaskDetail: () => ({
    data: undefined,
    isLoading: false,
    error: null,
  }),
  useClickUpTaskComments: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-settings")>()),
  useWorkspaceProviders: () => ({ providers: [] }),
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

function makeLinkedWorkspace(id: string): Workspace {
  return {
    id,
    userId: "user-1",
    name: `Workspace ${id}`,
    path: `/workspace/${id}`,
    type: "worktree",
    parentRepoPath: "/workspace/repo",
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
    linkedTaskId: TASK.id,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date("2025-01-01"),
    lastAccessedAt: new Date("2025-01-01"),
  };
}

afterEach(() => {
  cleanup();
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
});

describe("TaskDetailPanel linked workspace links", () => {
  it("links Open chat to the linked workspace's chat in the workbench", () => {
    // Given
    useWorkspaceStore.setState({ workspaces: [makeLinkedWorkspace("ws-9")] });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    // When
    render(
      <QueryClientProvider client={queryClient}>
        <TaskDetailPanel task={TASK} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    // Then
    expect(screen.getByTitle("Open chat")).toHaveAttribute(
      "href",
      createWorkbenchHref({
        open: "chat",
        workspaceId: "ws-9",
        sessionId: null,
      }),
    );
  });
});
