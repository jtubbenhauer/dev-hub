import type { Workspace } from "@/types";

// The repo a new worktree for this workspace branches from: the workspace
// itself when it is a repo, or the registered repo a worktree was made from.
export function findWorktreeParentRepo(
  workspaces: readonly Workspace[],
  workspaceId: string | null,
): Workspace | null {
  const workspace = workspaces.find(
    (candidate) => candidate.id === workspaceId,
  );
  if (!workspace) return null;
  if (workspace.type === "repo") return workspace;
  return (
    workspaces.find(
      (candidate) =>
        candidate.type === "repo" &&
        candidate.path === workspace.parentRepoPath,
    ) ?? null
  );
}
