import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { EventEmitter } from "node:events";
import type { DEFAULT_PROVIDER_BEHAVIOUR, Workspace } from "@/types";

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
mockWhere.mockResolvedValue([]);
mockSelect.mockReturnValue(mockDbChain);

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

vi.mock("@/drizzle/schema", () => ({
  workspaces: { id: "id", userId: "userId" },
  settings: { userId: "userId", key: "key" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
}));

const mockToWorkspace = vi.fn();
vi.mock("@/lib/workspaces/backend", () => ({
  toWorkspace: (...args: unknown[]) => mockToWorkspace(...args),
}));

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => {
  return {
    spawn: mockSpawn,
    __esModule: true,
    default: { spawn: mockSpawn },
  };
});

const authedSession = { user: { id: "user-1" } };

const autoSuspendBehaviour: typeof DEFAULT_PROVIDER_BEHAVIOUR = {
  inactiveHealthIntervalMs: 30_000,
  activeHealthIntervalMs: 30_000,
  gitStatusIntervalMs: 10_000,
  sseWhenInactive: true,
  branchPollWhenInactive: true,
  supportsAutoSuspend: true,
  resumeTimeSeconds: 30,
};

const autoSuspendProvider = {
  id: "provider-1",
  name: "rig",
  binaryPath: "/usr/bin/rig-cli",
  commands: {
    create: "{binary} create",
    destroy: "{binary} destroy",
    status: "{binary} status --json",
    start: "{binary} start {name}",
  },
  behaviour: autoSuspendBehaviour,
};

const noAutoSuspendProvider = {
  id: "provider-2",
  name: "basic",
  binaryPath: "/usr/bin/basic-cli",
  commands: {
    create: "{binary} create",
    destroy: "{binary} destroy",
    status: "{binary} status",
  },
};

function makeLocalWorkspaceRow() {
  return {
    id: "ws-local",
    userId: "user-1",
    name: "local-ws",
    path: "/home/user/code",
    backend: "local",
  };
}

function makeRemoteWorkspaceRow() {
  return {
    id: "ws-remote",
    userId: "user-1",
    name: "my-rig",
    path: "/workspace",
    backend: "remote",
    agentUrl: "http://10.0.0.1:7500",
    providerMeta: {
      providerId: "provider-1",
      providerWorkspaceId: "rig-ws-123",
    } as Record<string, unknown> | null,
  };
}

function makeLocalWorkspace() {
  return {
    id: "ws-local",
    userId: "user-1",
    name: "local-ws",
    path: "/home/user/code",
    type: "repo" as const,
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "local" as const,
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

function makeRemoteWorkspace(): Workspace {
  return {
    id: "ws-remote",
    userId: "user-1",
    name: "my-rig",
    path: "/workspace",
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "remote",
    provider: "rig",
    opencodeUrl: "http://10.0.0.1:3000",
    agentUrl: "http://10.0.0.1:7500",
    providerMeta: {
      providerId: "provider-1",
      providerWorkspaceId: "rig-ws-123",
    },
    shellCommand: null,
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  };
}

function makeChildProcess(stdout: string, exitCode: number) {
  const child = new EventEmitter();
  const stdoutEmitter = new EventEmitter();
  (child as unknown as Record<string, unknown>).stdout = stdoutEmitter;
  (child as unknown as Record<string, unknown>).kill = vi.fn();

  queueMicrotask(() => {
    if (stdout) {
      stdoutEmitter.emit("data", Buffer.from(stdout));
    }
    child.emit("close", exitCode);
  });

  return child;
}

function makeRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/workspaces/${id}/health`);
}

const fetchSpy = vi.spyOn(globalThis, "fetch");

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockFrom.mockReturnValue(mockDbChain);
  mockWhere.mockResolvedValue([]);
  mockSelect.mockReturnValue(mockDbChain);
  fetchSpy.mockReset();
});

describe("GET /api/workspaces/[id]/health", () => {
  let GET: (
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import("@/app/api/workspaces/[id]/health/route");
    GET = mod.GET;
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET(makeRequest("ws-1"), {
      params: Promise.resolve({ id: "ws-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when workspace not found", async () => {
    mockWhere.mockResolvedValueOnce([]);
    const res = await GET(makeRequest("ws-missing"), {
      params: Promise.resolve({ id: "ws-missing" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns ok with backend:local for local workspaces", async () => {
    mockWhere.mockResolvedValueOnce([makeLocalWorkspaceRow()]);
    mockToWorkspace.mockReturnValueOnce(makeLocalWorkspace());

    const res = await GET(makeRequest("ws-local"), {
      params: Promise.resolve({ id: "ws-local" }),
    });
    const body = await res.json();
    expect(body).toEqual({ status: "ok", backend: "local" });
  });

  it("returns ok when remote agent is healthy", async () => {
    mockWhere.mockResolvedValueOnce([makeRemoteWorkspaceRow()]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok", workspacePath: "/ws" }), {
        status: 200,
      }),
    );

    const res = await GET(makeRequest("ws-remote"), {
      params: Promise.resolve({ id: "ws-remote" }),
    });
    const body = await res.json();
    expect(body).toEqual({
      status: "ok",
      backend: "remote",
      workspacePath: "/ws",
    });
  });

  it("returns suspended when agent unreachable and provider status says stopped", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [autoSuspendProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const statusJson = JSON.stringify([
      { name: "my-rig", status: "stopped", region: "ewr" },
    ]);
    mockSpawn.mockImplementationOnce(() => makeChildProcess(statusJson, 0));

    const res = await GET(makeRequest("ws-remote"), {
      params: Promise.resolve({ id: "ws-remote" }),
    });
    const body = await res.json();
    expect(body).toEqual({ status: "suspended" });
  });

  it("returns suspended when matched by providerWorkspaceId", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [autoSuspendProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const statusJson = JSON.stringify([
      { name: "rig-ws-123", status: "suspended", region: "ewr" },
    ]);
    mockSpawn.mockImplementationOnce(() => makeChildProcess(statusJson, 0));

    const res = await GET(makeRequest("ws-remote"), {
      params: Promise.resolve({ id: "ws-remote" }),
    });
    const body = await res.json();
    expect(body).toEqual({ status: "suspended" });
  });

  it("returns unreachable when agent unreachable and no auto-suspend provider", async () => {
    const workspace = makeRemoteWorkspace();
    workspace.providerMeta = {
      providerId: "provider-2",
      providerWorkspaceId: "basic-123",
    };
    const row = makeRemoteWorkspaceRow();
    row.providerMeta = workspace.providerMeta;

    mockWhere
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ value: [noAutoSuspendProvider] }]);
    mockToWorkspace.mockReturnValueOnce(workspace);
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await GET(makeRequest("ws-remote"), {
      params: Promise.resolve({ id: "ws-remote" }),
    });
    const body = await res.json();
    expect(body.status).toBe("unreachable");
  });

  it("returns unreachable when status command fails (non-zero exit)", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [autoSuspendProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    mockSpawn.mockImplementationOnce(() => makeChildProcess("", 1));

    const res = await GET(makeRequest("ws-remote"), {
      params: Promise.resolve({ id: "ws-remote" }),
    });
    const body = await res.json();
    expect(body.status).toBe("unreachable");
  });

  it("returns unreachable when status output is not valid JSON", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [autoSuspendProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    mockSpawn.mockImplementationOnce(() =>
      makeChildProcess("not valid json", 0),
    );

    const res = await GET(makeRequest("ws-remote"), {
      params: Promise.resolve({ id: "ws-remote" }),
    });
    const body = await res.json();
    expect(body.status).toBe("unreachable");
  });

  it("returns unreachable when status shows running (not stopped/suspended)", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [autoSuspendProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const statusJson = JSON.stringify([
      { name: "my-rig", status: "running", region: "ewr" },
    ]);
    mockSpawn.mockImplementationOnce(() => makeChildProcess(statusJson, 0));

    const res = await GET(makeRequest("ws-remote"), {
      params: Promise.resolve({ id: "ws-remote" }),
    });
    const body = await res.json();
    expect(body.status).toBe("unreachable");
  });

  it("returns unreachable when no matching container in status output", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [autoSuspendProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const statusJson = JSON.stringify([
      { name: "other-workspace", status: "stopped", region: "ewr" },
    ]);
    mockSpawn.mockImplementationOnce(() => makeChildProcess(statusJson, 0));

    const res = await GET(makeRequest("ws-remote"), {
      params: Promise.resolve({ id: "ws-remote" }),
    });
    const body = await res.json();
    expect(body.status).toBe("unreachable");
  });

  it("returns unreachable when workspace has no providerMeta", async () => {
    const workspace = makeRemoteWorkspace();
    workspace.providerMeta = null;
    const row = makeRemoteWorkspaceRow();
    row.providerMeta = null;

    mockWhere.mockResolvedValueOnce([row]);
    mockToWorkspace.mockReturnValueOnce(workspace);
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await GET(makeRequest("ws-remote"), {
      params: Promise.resolve({ id: "ws-remote" }),
    });
    const body = await res.json();
    expect(body.status).toBe("unreachable");
  });

  it("returns unreachable when no provider settings exist", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await GET(makeRequest("ws-remote"), {
      params: Promise.resolve({ id: "ws-remote" }),
    });
    const body = await res.json();
    expect(body.status).toBe("unreachable");
  });
});
