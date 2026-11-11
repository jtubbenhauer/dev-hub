import { describe, expect, it } from "vitest";
import { findWorktreeParentRepo } from "@/lib/workspaces/worktree-parent-repo";
import type { Workspace } from "@/types";

function makeWorkspace(
  id: string,
  path: string,
  worktreeOf: string | null = null,
): Workspace {
  return {
    id,
    userId: "user-1",
    name: id,
    path,
    type: worktreeOf === null ? "repo" : "worktree",
    parentRepoPath: worktreeOf,
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

const devHub = makeWorkspace("dev-hub", "/code/dev-hub");
const otherRepo = makeWorkspace("other", "/code/other");
const featureWorktree = makeWorkspace(
  "dev-hub-feature",
  "/code/dev-hub-worktrees/feature",
  "/code/dev-hub",
);
const orphanWorktree = makeWorkspace(
  "orphan",
  "/code/gone-worktrees/fix",
  "/code/gone",
);
const workspaces = [otherRepo, devHub, featureWorktree, orphanWorktree];

describe("findWorktreeParentRepo", () => {
  it("returns a repo workspace itself", () => {
    expect(findWorktreeParentRepo(workspaces, "dev-hub")).toBe(devHub);
  });

  it("returns the registered repo a worktree was made from", () => {
    expect(findWorktreeParentRepo(workspaces, "dev-hub-feature")).toBe(devHub);
  });

  it("returns null for a worktree whose repo is not registered", () => {
    expect(findWorktreeParentRepo(workspaces, "orphan")).toBeNull();
  });

  it.each([null, "missing"])(
    "returns null when the workspace id is %s",
    (workspaceId) => {
      expect(findWorktreeParentRepo(workspaces, workspaceId)).toBeNull();
    },
  );
});
