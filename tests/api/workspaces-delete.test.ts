import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));

const tables = {
  workspaces: { name: "workspaces", id: "workspace_id", userId: "user_id" },
  settings: { name: "settings", userId: "user_id", key: "key" },
  cachedSessions: {
    name: "cached_sessions",
    workspaceId: "workspace_id",
    userId: "user_id",
  },
  cachedMessages: {
    name: "cached_messages",
    workspaceId: "workspace_id",
    userId: "user_id",
  },
  recoveredMessages: {
    name: "recovered_messages",
    workspaceId: "workspace_id",
    userId: "user_id",
  },
};
vi.mock("@/drizzle/schema", () => tables);
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ column, value })),
  and: vi.fn((...conditions) => ({ conditions })),
}));

const mockWorkspace = {
  id: "workspace-1",
  userId: "user-1",
  type: "repo",
  parentRepoPath: null,
  path: "/workspace",
  backend: "local",
  providerMeta: null,
};
const mockSelectWhere = vi.fn().mockResolvedValue([mockWorkspace]);
const mockSelect = vi.fn(() => ({
  from: vi.fn(() => ({ where: mockSelectWhere })),
}));
const mockDelete = vi.fn();
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn(() => ({
  set: vi.fn(() => ({ where: mockUpdateWhere })),
}));
vi.mock("@/lib/db", () => ({
  db: { select: mockSelect, delete: mockDelete, update: mockUpdate },
}));

vi.mock("@/lib/git/worktrees", () => ({
  removeWorktree: vi.fn(),
  pruneWorktrees: vi.fn(),
}));

describe("DELETE /api/workspaces/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockSelectWhere.mockResolvedValue([mockWorkspace]);
    mockDelete.mockImplementation(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
  });

  it("does not return a workspace owned by another tenant after update", async () => {
    mockSelectWhere.mockResolvedValue([]);
    const { PUT } = await import("@/app/api/workspaces/[id]/route");

    const response = await PUT(
      new NextRequest("http://localhost/api/workspaces/workspace-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Updated" }),
      }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );

    expect(response.status).toBe(404);
  });

  it("deletes all workspace cache tables after the workspace row", async () => {
    const { DELETE } = await import("@/app/api/workspaces/[id]/route");

    const response = await DELETE(
      new NextRequest("http://localhost/api/workspaces/workspace-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mockDelete.mock.calls.map(([table]) => table.name)).toEqual([
      "workspaces",
      "cached_sessions",
      "cached_messages",
      "recovered_messages",
    ]);
  });

  it("keeps workspace deletion successful when cache cleanup fails", async () => {
    mockDelete.mockImplementation((table: { name: string }) => ({
      where:
        table.name === "cached_messages"
          ? vi.fn().mockRejectedValue(new Error("database busy"))
          : vi.fn().mockResolvedValue(undefined),
    }));
    const { DELETE } = await import("@/app/api/workspaces/[id]/route");

    const response = await DELETE(
      new NextRequest("http://localhost/api/workspaces/workspace-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "workspace-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(mockDelete.mock.calls[0][0]).toBe(tables.workspaces);
  });
});
