// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAuth = vi.fn();
const mockWhere = vi.fn();
const mockValues = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: mockWhere })) })),
    insert: vi.fn(() => ({ values: mockValues })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: mockUpdateWhere })),
    })),
  },
}));
vi.mock("@/drizzle/schema", () => ({
  workspaces: { id: "id", userId: "user_id" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column, value) => ({ column, value })),
  and: vi.fn((...conditions) => ({ conditions })),
}));
vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(() => false), statSync: vi.fn() },
}));
vi.mock("@/lib/git/worktrees", () => ({
  removeWorktree: vi.fn(),
  pruneWorktrees: vi.fn(),
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

const existingWorkspace = {
  id: "ws-1",
  userId: "user-1",
  name: "Workspace",
  agentUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockAuth.mockResolvedValue({ user: { id: "user-1" } });
  mockWhere.mockResolvedValue([existingWorkspace]);
  mockUpdateWhere.mockResolvedValue(undefined);
  mockValues.mockResolvedValue(undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "ok" }),
    }),
  );
});

describe("POST /api/workspaces agentUrl scheme validation", () => {
  it("rejects a non-loopback http agentUrl with 400", async () => {
    const { POST } = await import("@/app/api/workspaces/route");

    const response = await POST(
      new NextRequest("http://localhost/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          backend: "remote",
          agentUrl: "http://10.0.0.1:7500",
          opencodeUrl: "http://10.0.0.1:4096",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockValues).not.toHaveBeenCalled();
  });

  it("accepts a loopback http agentUrl", async () => {
    const { POST } = await import("@/app/api/workspaces/route");

    const response = await POST(
      new NextRequest("http://localhost/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          backend: "remote",
          agentUrl: "http://127.0.0.1:7500",
          opencodeUrl: "http://127.0.0.1:4096",
        }),
      }),
    );

    expect(response.status).toBe(201);
  });

  it("accepts a non-loopback https agentUrl", async () => {
    const { POST } = await import("@/app/api/workspaces/route");

    const response = await POST(
      new NextRequest("http://localhost/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          backend: "remote",
          agentUrl: "https://agent.example.com:7500",
          opencodeUrl: "https://agent.example.com:4096",
        }),
      }),
    );

    expect(response.status).toBe(201);
  });
});

describe("PUT /api/workspaces/:id agentUrl scheme validation", () => {
  it("rejects a non-loopback http agentUrl with 400", async () => {
    const { PUT } = await import("@/app/api/workspaces/[id]/route");

    const response = await PUT(
      new NextRequest("http://localhost/api/workspaces/ws-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentUrl: "http://10.0.0.1:7500" }),
      }),
      { params: Promise.resolve({ id: "ws-1" }) },
    );

    expect(response.status).toBe(400);
    expect(mockUpdateWhere).not.toHaveBeenCalled();
  });

  it("accepts a non-loopback https agentUrl", async () => {
    const { PUT } = await import("@/app/api/workspaces/[id]/route");

    const response = await PUT(
      new NextRequest("http://localhost/api/workspaces/ws-1", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentUrl: "https://agent.example.com:7500" }),
      }),
      { params: Promise.resolve({ id: "ws-1" }) },
    );

    expect(response.status).toBe(200);
  });
});
