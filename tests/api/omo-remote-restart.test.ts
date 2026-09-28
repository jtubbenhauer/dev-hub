import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Workspace } from "@/types";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  reconnect: vi.fn(),
  resolveEngine: vi.fn(),
  restartLocalOmo: vi.fn(),
  proxyOmoRequest: vi.fn(),
  resolveOmoWorkspace: vi.fn(),
  stopServer: vi.fn(),
  toWorkspace: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/lib/auth/config", () => ({ auth: mocks.auth }));
vi.mock("@/lib/engine/resolve-engine", () => ({
  resolveWorkspaceEngine: mocks.resolveEngine,
}));
vi.mock("@/lib/omo/route-dispatch", () => ({
  proxyOmoRequest: mocks.proxyOmoRequest,
  resolveOmoWorkspaceOrResponse: mocks.resolveOmoWorkspace,
  restartOmoEngine: mocks.restartLocalOmo,
}));
vi.mock("@/lib/omo/runtime", () => ({
  getOmoRuntimeForWorkspace: vi.fn(() => ({
    runtime: { client: { reconnect: mocks.reconnect } },
  })),
}));
vi.mock("@/lib/opencode/server-pool", () => ({
  stopServer: mocks.stopServer,
}));
vi.mock("@/lib/workspaces/backend", () => ({
  toWorkspace: mocks.toWorkspace,
}));

const dbChain = {
  from: vi.fn(() => dbChain),
  where: mocks.where,
};
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(() => dbChain) },
}));
vi.mock("@/drizzle/schema", () => ({
  settings: { key: "key", userId: "userId" },
  workspaces: { id: "id", userId: "userId" },
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values: unknown[]) => ({ and: values })),
  eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

function remoteWorkspace(): Workspace {
  return {
    id: "ws-remote",
    userId: "user-1",
    name: "remote-omo",
    path: "/workspace",
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "remote",
    provider: "rig",
    opencodeUrl: null,
    agentUrl: "https://agent.example:7500",
    providerMeta: { providerId: "provider-1" },
    shellCommand: null,
    sshTarget: null,
    sshPath: null,
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  };
}

function restartRequest(): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/opencode/restart?workspaceId=ws-remote",
    { method: "POST" },
  );
}

function autoSuspendProviderRow() {
  return {
    value: [
      {
        id: "provider-1",
        behaviour: { supportsAutoSuspend: true },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.stubEnv("DEVHUB_AGENT_TOKEN", "agent-secret");
  vi.stubEnv("DEVHUB_AGENT_ALLOWED_ORIGINS", "https://agent.example:7500");
  const workspace = remoteWorkspace();
  mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
  mocks.resolveEngine.mockResolvedValue("omo");
  mocks.toWorkspace.mockReturnValue(workspace);
  mocks.resolveOmoWorkspace.mockResolvedValue(workspace);
  mocks.restartLocalOmo.mockResolvedValue(
    Response.json({ restarted: true, target: "omo" }),
  );
  mocks.proxyOmoRequest.mockResolvedValue(new Response(null, { status: 418 }));
  mocks.reconnect.mockResolvedValue({
    protocolVersion: 1,
    mode: "multi",
    capabilities: [],
  });
  mocks.where.mockResolvedValue([{ id: "ws-remote" }]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("remote omo restart and status", () => {
  it("ensures the remote daemon with bearer auth, reconnects, and never stops it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ pid: 42, action: "started" }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/opencode/restart/route");

    const response = await POST(restartRequest());

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agent.example:7500/omo/daemon/ensure",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer agent-secret" },
      }),
    );
    expect(mocks.reconnect).toHaveBeenCalledOnce();
    expect(mocks.restartLocalOmo).not.toHaveBeenCalled();
    expect(mocks.stopServer).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.map(([url]) => String(url)).join(" "),
    ).not.toContain("stop");
  });

  it("retries the remote ensure exactly once after an auto-suspend 503", async () => {
    vi.useFakeTimers();
    mocks.where
      .mockResolvedValueOnce([{ id: "ws-remote" }])
      .mockResolvedValueOnce([autoSuspendProviderRow()]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "waking" }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({ pid: 42, action: "started" }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/opencode/restart/route");

    const responsePromise = POST(restartRequest());
    await vi.advanceTimersByTimeAsync(2_000);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.reconnect).toHaveBeenCalledOnce();
  });

  it("surfaces the final error after one auto-suspend retry", async () => {
    vi.useFakeTimers();
    mocks.where
      .mockResolvedValueOnce([{ id: "ws-remote" }])
      .mockResolvedValueOnce([autoSuspendProviderRow()]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "waking" }, { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: "daemon unavailable" }, { status: 503 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/opencode/restart/route");

    const responsePromise = POST(restartRequest());
    await vi.advanceTimersByTimeAsync(2_000);
    const response = await responsePromise;

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: "engine_unavailable",
      detail: expect.stringContaining("daemon unavailable"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.reconnect).not.toHaveBeenCalled();
  });

  it("reads remote omo health from the authenticated daemon status route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ reachable: true, pid: 42 }));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/opencode/[...path]/route");

    const response = await GET(
      new NextRequest(
        "http://localhost:3000/api/opencode/global/health?workspaceId=ws-remote",
      ),
      { params: Promise.resolve({ path: ["global", "health"] }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ healthy: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agent.example:7500/omo/daemon/status",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer agent-secret" },
      }),
    );
    expect(mocks.proxyOmoRequest).not.toHaveBeenCalled();
  });
});
