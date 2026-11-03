import type { Workspace } from "@/types";

export function createWorkspace(id: string): Workspace {
  return {
    id,
    userId: "user-1",
    name: `Workspace ${id}`,
    path: `/home/user/dev/${id}`,
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
