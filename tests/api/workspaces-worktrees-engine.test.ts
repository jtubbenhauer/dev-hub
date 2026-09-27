// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();
const mockWhere = vi.fn();
const mockValues = vi.fn();
const mockAddWorktree = vi.fn();
const mockGetBranches = vi.fn();

vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: mockWhere })),
    })),
    insert: vi.fn(() => ({ values: mockValues })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn() })),
    })),
  },
}));
vi.mock("@/drizzle/schema", () => ({
  workspaces: {
    id: "id",
    userId: "user_id",
    path: "path",
    engine: "engine",
    worktreeSymlinks: "worktree_symlinks",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ column, value })),
  and: vi.fn((...conditions) => ({ conditions })),
}));
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    statSync: vi.fn(),
  },
}));
vi.mock("@/lib/git/worktrees", () => ({
  getWorktreeBaseDir: vi.fn(() => "/worktrees"),
  createSymlinks: vi.fn(),
}));
vi.mock("@/lib/workspaces/backend", () => ({
  toWorkspace: vi.fn((row) => ({ ...row, worktreeSymlinks: null })),
  getBackend: vi.fn(() => ({
    getBranches: mockGetBranches,
    addWorktree: mockAddWorktree,
  })),
}));
vi.mock("@/lib/workspace-colors", () => ({
  getAutoColorForNewWorkspace: vi.fn().mockResolvedValue("blue"),
}));
vi.mock("@/lib/workspaces/ssh-target", () => ({
  backfillSshTargets: vi.fn((rows) => rows),
}));
vi.mock("@/lib/engine/resolve-engine", () => ({
  resolveWorkspaceEngine: vi.fn().mockResolvedValue("opencode"),
}));

const parentWorkspace = {
  id: "parent-1",
  userId: "user-1",
  name: "Parent",
  path: "/repo",
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
  engine: "omo",
  createdAt: new Date(0),
  lastAccessedAt: new Date(0),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockWhere.mockResolvedValue([parentWorkspace]);
  mockValues.mockResolvedValue(undefined);
  mockGetBranches.mockResolvedValue([{ name: "feature" }]);
  mockAddWorktree.mockResolvedValue("/worktrees/feature");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "ok" }),
    }),
  );
});

describe("workspace engine creation", () => {
  it("copies the parent engine to a new worktree", async () => {
    const { POST } = await import("@/app/api/workspaces/worktrees/route");

    const response = await POST(
      new NextRequest("http://localhost/api/workspaces/worktrees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parentWorkspaceId: "parent-1",
          branch: "feature",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "omo", type: "worktree" }),
    );
  });

  it("allows an omo remote workspace without an OpenCode URL", async () => {
    const { POST } = await import("@/app/api/workspaces/route");

    const response = await POST(
      new NextRequest("http://localhost/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          backend: "remote",
          engine: "omo",
          agentUrl: "http://agent.test",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "omo", opencodeUrl: null }),
    );
  });

  it("requires an OpenCode URL for an opencode remote workspace", async () => {
    const { POST } = await import("@/app/api/workspaces/route");

    const response = await POST(
      new NextRequest("http://localhost/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          backend: "remote",
          engine: "opencode",
          agentUrl: "http://agent.test",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockValues).not.toHaveBeenCalled();
  });
});
