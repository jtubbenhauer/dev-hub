import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateWorktreeDialog } from "@/components/workspace/create-worktree-dialog";
import { useWorkspaceDialogStore } from "@/stores/workspace-dialog-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

// Cached query data keeps its reference between renders, like this constant.
const devHubSavedSymlinks = [".env"];

vi.mock("@/hooks/use-git", () => ({
  useCreateWorktree: () => ({ mutate: vi.fn(), isPending: false }),
  useGitBranches: () => ({ data: [], isLoading: false }),
  useWorktreeSymlinks: (repoId: string | null) => ({
    data: repoId === "dev-hub" ? devHubSavedSymlinks : undefined,
  }),
}));

function makeRepo(id: string): Workspace {
  return {
    id,
    userId: "user-1",
    name: id,
    path: `/code/${id}`,
    type: "repo",
    parentRepoPath: null,
    packageManager: "pnpm",
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

function openDialog(initialRepoId: string | null) {
  act(() =>
    useWorkspaceDialogStore
      .getState()
      .open({ kind: "create-worktree", initialRepoId }),
  );
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [makeRepo("dev-hub"), makeRepo("other")],
  });
  render(<CreateWorktreeDialog />);
});

afterEach(() => {
  act(() => useWorkspaceDialogStore.getState().close());
});

describe("CreateWorktreeDialog", () => {
  it("opens on the branch form of the repo it was opened for", () => {
    // When
    openDialog("dev-hub");

    // Then
    expect(
      screen.getByRole("heading", { name: "Create Worktree" }),
    ).toBeInTheDocument();
    expect(screen.getByText("dev-hub")).toBeInTheDocument();
    expect(screen.getByLabelText("Branch name")).toBeInTheDocument();
  });

  it("opens on the repo list when no repo is given", () => {
    // When
    openDialog(null);

    // Then
    expect(
      screen.getByRole("heading", { name: "Select Parent Repository" }),
    ).toBeInTheDocument();
  });

  it("applies the repo's saved symlinks again when reopened on it", async () => {
    // Given
    const user = userEvent.setup();
    openDialog("dev-hub");
    await user.keyboard("{Escape}");

    // When
    openDialog("dev-hub");

    // Then
    expect(screen.getByText(".env")).toBeInTheDocument();
  });

  it("forgets the typed branch name when reopened", async () => {
    // Given
    const user = userEvent.setup();
    openDialog("dev-hub");
    await user.type(screen.getByLabelText("Branch name"), "feature-x");
    await user.keyboard("{Escape}");

    // When
    openDialog("dev-hub");

    // Then
    expect(screen.getByLabelText("Branch name")).toHaveValue("");
  });
});
