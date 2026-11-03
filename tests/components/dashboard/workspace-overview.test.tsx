import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceOverview } from "@/components/dashboard/workspace-overview";
import { createWorkbenchHref } from "@/lib/workbench/workbench-href";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

vi.mock("@/hooks/use-git", () => ({
  useGitStatus: () => ({ data: undefined, isLoading: false }),
}));

function makeWorkspace(id: string): Workspace {
  return {
    id,
    userId: "user-1",
    name: `Workspace ${id}`,
    path: `/workspace/${id}`,
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
    createdAt: new Date("2025-01-01"),
    lastAccessedAt: new Date("2025-01-01"),
  };
}

afterEach(() => {
  cleanup();
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
});

describe("WorkspaceOverview links", () => {
  it("links each workspace's Chat to its chat in the workbench", () => {
    // Given
    useWorkspaceStore.setState({ workspaces: [makeWorkspace("ws-7")] });

    // When
    render(<WorkspaceOverview />);

    // Then
    expect(screen.getByRole("link", { name: /Chat/i })).toHaveAttribute(
      "href",
      createWorkbenchHref({
        open: "chat",
        workspaceId: "ws-7",
        sessionId: null,
      }),
    );
  });
});
