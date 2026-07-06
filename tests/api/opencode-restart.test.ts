import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Workspace } from "@/types";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));

const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockDbChain = {
  from: mockFrom,
  where: mockWhere,
};

mockFrom.mockReturnValue(mockDbChain);
mockSelect.mockReturnValue(mockDbChain);
mockWhere.mockResolvedValue([]);

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

vi.mock("@/drizzle/schema", () => ({
  workspaces: { id: "id", userId: "userId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
}));

const mockToWorkspace = vi.fn();
vi.mock("@/lib/workspaces/backend", () => ({
  toWorkspace: (...args: unknown[]) => mockToWorkspace(...args),
}));

const mockStopServer = vi.fn();
vi.mock("@/lib/opencode/server-pool", () => ({
  stopServer: mockStopServer,
}));

function makeLocalWorkspace(): Workspace {
  return {
    id: "ws-local",
    userId: "user-1",
    name: "local-1",
    path: "/Users/test/code/repo",
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
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  };
}

function makeRemoteWorkspace(agentUrl: string | null): Workspace {
  return {
    ...makeLocalWorkspace(),
    id: "ws-remote",
    backend: "remote",
    provider: "rig",
    opencodeUrl: "http://10.0.0.1:4096",
    agentUrl,
  };
}

describe("POST /api/opencode/restart", () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-1" } });
    mockWhere.mockResolvedValue([]);

    const mod = await import("@/app/api/opencode/restart/route");
    POST = mod.POST;
  });

  it("returns 401 when unauthorized", async () => {
    mockAuth.mockResolvedValue(null);

    const response = await POST(
      new NextRequest("http://localhost:3000/api/opencode/restart", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mockStopServer).not.toHaveBeenCalled();
  });

  it("restarts the shared local server when no workspaceId is provided", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/opencode/restart", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ restarted: true, target: "local" });
    expect(mockStopServer).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when workspace is not found", async () => {
    mockWhere.mockResolvedValue([]);

    const response = await POST(
      new NextRequest(
        "http://localhost:3000/api/opencode/restart?workspaceId=missing",
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(404);
    expect(mockStopServer).not.toHaveBeenCalled();
  });

  it("calls stopServer for a local workspace", async () => {
    mockWhere.mockResolvedValue([{ id: "ws-local" }]);
    mockToWorkspace.mockReturnValue(makeLocalWorkspace());

    const response = await POST(
      new NextRequest(
        "http://localhost:3000/api/opencode/restart?workspaceId=ws-local",
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ restarted: true, target: "local" });
    expect(mockStopServer).toHaveBeenCalledTimes(1);
  });

  it("proxies restart to the agent for a remote workspace", async () => {
    mockWhere.mockResolvedValue([{ id: "ws-remote" }]);
    mockToWorkspace.mockReturnValue(
      makeRemoteWorkspace("http://10.0.0.1:7500"),
    );

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ restarted: true, killedCount: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new NextRequest(
        "http://localhost:3000/api/opencode/restart?workspaceId=ws-remote",
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      restarted: true,
      target: "remote",
      killedCount: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://10.0.0.1:7500/opencode/restart",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockStopServer).not.toHaveBeenCalled();
  });

  it("falls back to the remote command API when the agent has no restart route", async () => {
    mockWhere.mockResolvedValue([{ id: "ws-remote" }]);
    mockToWorkspace.mockReturnValue(
      makeRemoteWorkspace("http://10.0.0.1:7500"),
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("404 Not Found", {
          status: 404,
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          [
            'event: session\ndata: {"sessionId":"restart-1"}\n',
            'event: exit\ndata: {"exitCode":0}\n',
            "\n",
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new NextRequest(
        "http://localhost:3000/api/opencode/restart?workspaceId=ws-remote",
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      restarted: true,
      target: "remote",
      killedCount: null,
      fallback: "commands/run",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://10.0.0.1:7500/opencode/restart",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://10.0.0.1:7500/commands/run",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          command: "pkill -TERM -f '[o]pencode serve' || true",
        }),
      }),
    );
    expect(mockStopServer).not.toHaveBeenCalled();
  });

  it("returns 400 when a remote workspace has no agentUrl", async () => {
    mockWhere.mockResolvedValue([{ id: "ws-remote" }]);
    mockToWorkspace.mockReturnValue(makeRemoteWorkspace(null));

    const response = await POST(
      new NextRequest(
        "http://localhost:3000/api/opencode/restart?workspaceId=ws-remote",
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(400);
    expect(mockStopServer).not.toHaveBeenCalled();
  });

  it("returns 502 when the agent is unreachable", async () => {
    mockWhere.mockResolvedValue([{ id: "ws-remote" }]);
    mockToWorkspace.mockReturnValue(
      makeRemoteWorkspace("http://10.0.0.1:7500"),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    const response = await POST(
      new NextRequest(
        "http://localhost:3000/api/opencode/restart?workspaceId=ws-remote",
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(502);
  });

  it("returns 502 when the agent returns a non-ok response", async () => {
    mockWhere.mockResolvedValue([{ id: "ws-remote" }]);
    mockToWorkspace.mockReturnValue(
      makeRemoteWorkspace("http://10.0.0.1:7500"),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("opencode not found", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    const response = await POST(
      new NextRequest(
        "http://localhost:3000/api/opencode/restart?workspaceId=ws-remote",
        { method: "POST" },
      ),
    );

    expect(response.status).toBe(502);
  });
});
