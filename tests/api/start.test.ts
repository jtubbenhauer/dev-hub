import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { EventEmitter } from "node:events";
import type { Workspace } from "@/types";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/config", () => ({ auth: mockAuth }));

const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockSet = vi.fn();
const mockUpdate = vi.fn();

const mockDbChain = {
  from: mockFrom,
  where: mockWhere,
  set: mockSet,
  update: mockUpdate,
};

mockFrom.mockReturnValue(mockDbChain);
mockWhere.mockResolvedValue([]);
mockSelect.mockReturnValue(mockDbChain);
mockSet.mockReturnValue(mockDbChain);
mockUpdate.mockReturnValue(mockDbChain);

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect, update: mockUpdate },
}));

vi.mock("@/drizzle/schema", () => ({
  workspaces: {
    id: "id",
    userId: "userId",
    opencodeUrl: "opencodeUrl",
    agentUrl: "agentUrl",
  },
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

const mockInterpolateProviderCommand = vi.fn();
vi.mock("@/lib/workspaces/resume", () => ({
  interpolateProviderCommand: (...args: unknown[]) =>
    mockInterpolateProviderCommand(...args),
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

const testProvider = {
  id: "provider-1",
  name: "rig",
  binaryPath: "/usr/bin/rig-cli",
  commands: {
    create: "{binary} create",
    destroy: "{binary} destroy",
    status: "{binary} status --json",
    start: "{binary} start {name}",
  },
  behaviour: {
    inactiveHealthIntervalMs: 30_000,
    activeHealthIntervalMs: 30_000,
    gitStatusIntervalMs: 10_000,
    sseWhenInactive: true,
    branchPollWhenInactive: true,
    supportsAutoSuspend: true,
    resumeTimeSeconds: 30,
  },
};

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

function makeLocalWorkspaceRow() {
  return {
    id: "ws-local",
    userId: "user-1",
    name: "local-ws",
    path: "/home/user/code",
    backend: "local",
  };
}

function makeLocalWorkspace(): Workspace {
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

function makeChildProcess(
  stdout: string,
  exitCode: number,
  delayMs: number = 0,
) {
  const child = new EventEmitter();
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  (child as unknown as Record<string, unknown>).stdout = stdoutEmitter;
  (child as unknown as Record<string, unknown>).stderr = stderrEmitter;
  (child as unknown as Record<string, unknown>).kill = vi.fn();

  setTimeout(() => {
    if (stdout) {
      stdoutEmitter.emit("data", Buffer.from(stdout));
    }
    child.emit("close", exitCode);
  }, delayMs);

  return child;
}

function makeRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/workspaces/${id}/start`, {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockFrom.mockReturnValue(mockDbChain);
  mockWhere.mockResolvedValue([]);
  mockSelect.mockReturnValue(mockDbChain);
  mockSet.mockReturnValue(mockDbChain);
  mockUpdate.mockReturnValue(mockDbChain);
  mockInterpolateProviderCommand.mockReturnValue("rig start my-rig");
});

describe("POST /api/workspaces/[id]/start", () => {
  let POST: (
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response>;

  beforeEach(async () => {
    const mod = await import("@/app/api/workspaces/[id]/start/route");
    POST = mod.POST;
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(makeRequest("ws-1"), {
      params: Promise.resolve({ id: "ws-1" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when workspace not found", async () => {
    mockWhere.mockResolvedValueOnce([]);
    const res = await POST(makeRequest("ws-missing"), {
      params: Promise.resolve({ id: "ws-missing" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  it("returns 400 when workspace is local (not remote)", async () => {
    mockWhere.mockResolvedValueOnce([makeLocalWorkspaceRow()]);
    mockToWorkspace.mockReturnValueOnce(makeLocalWorkspace());

    const res = await POST(makeRequest("ws-local"), {
      params: Promise.resolve({ id: "ws-local" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not a remote provider workspace");
  });

  it("returns 400 when workspace has no providerMeta", async () => {
    const row = makeRemoteWorkspaceRow();
    row.providerMeta = null;
    mockWhere.mockResolvedValueOnce([row]);
    const workspace = makeRemoteWorkspace();
    workspace.providerMeta = null;
    mockToWorkspace.mockReturnValueOnce(workspace);

    const res = await POST(makeRequest("ws-remote"), {
      params: Promise.resolve({ id: "ws-remote" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not a remote provider workspace");
  });

  it("returns 400 when provider has no start command", async () => {
    const providerWithoutStart = {
      ...testProvider,
      commands: {
        create: "{binary} create",
        destroy: "{binary} destroy",
        status: "{binary} status --json",
      },
    };
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [providerWithoutStart] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());

    const res = await POST(makeRequest("ws-no-start"), {
      params: Promise.resolve({ id: "ws-no-start" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("does not support start");
  });

  it("returns 400 when no providers configured", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());

    const res = await POST(makeRequest("ws-no-providers"), {
      params: Promise.resolve({ id: "ws-no-providers" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No providers configured");
  });

  it("returns 409 when workspace is already starting (dedup)", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [testProvider] }])
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [testProvider] }]);
    mockToWorkspace
      .mockReturnValueOnce(makeRemoteWorkspace())
      .mockReturnValueOnce(makeRemoteWorkspace());

    mockSpawn.mockImplementationOnce(() =>
      makeChildProcess('{"status":"ok"}', 0, 100),
    );

    const firstPromise = POST(makeRequest("ws-dedup"), {
      params: Promise.resolve({ id: "ws-dedup" }),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondRes = await POST(makeRequest("ws-dedup"), {
      params: Promise.resolve({ id: "ws-dedup" }),
    });
    expect(secondRes.status).toBe(409);
    const body = await secondRes.json();
    expect(body.error).toContain("already starting");

    await firstPromise;
  });

  it("returns 200 with status:started on successful spawn", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [testProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());

    const responseJson = JSON.stringify({ status: "ok" });
    mockSpawn.mockImplementationOnce(() => makeChildProcess(responseJson, 0));

    const res = await POST(makeRequest("ws-success"), {
      params: Promise.resolve({ id: "ws-success" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("started");
  });

  it("returns 200 and updates DB endpoints when spawn response includes them", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [testProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());

    const responseJson = JSON.stringify({
      status: "ok",
      endpoints: {
        opencode: "http://10.0.0.1:3001",
        agent: "http://10.0.0.1:7501",
      },
    });
    mockSpawn.mockImplementationOnce(() => makeChildProcess(responseJson, 0));

    const res = await POST(makeRequest("ws-endpoints"), {
      params: Promise.resolve({ id: "ws-endpoints" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("started");
    expect(body.endpoints).toEqual({
      opencode: "http://10.0.0.1:3001",
      agent: "http://10.0.0.1:7501",
    });

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith({
      opencodeUrl: "http://10.0.0.1:3001",
      agentUrl: "http://10.0.0.1:7501",
    });
  });

  it("returns 500 when spawn fails with non-zero exit code", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [testProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());

    mockSpawn.mockImplementationOnce(() => makeChildProcess("", 1));

    const res = await POST(makeRequest("ws-exit-fail"), {
      params: Promise.resolve({ id: "ws-exit-fail" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("exited with code 1");
  });

  it("returns 500 when spawn fails with error event", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [testProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());

    mockSpawn.mockImplementationOnce(() => {
      const child = new EventEmitter();
      const stdoutEmitter = new EventEmitter();
      const stderrEmitter = new EventEmitter();
      (child as unknown as Record<string, unknown>).stdout = stdoutEmitter;
      (child as unknown as Record<string, unknown>).stderr = stderrEmitter;
      (child as unknown as Record<string, unknown>).kill = vi.fn();

      queueMicrotask(() => {
        child.emit("error", new Error("ENOENT: spawn failed"));
      });

      return child;
    });

    const res = await POST(makeRequest("ws-spawn-error"), {
      params: Promise.resolve({ id: "ws-spawn-error" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("spawn failed");
  });

  it("returns 500 when spawn output is not valid JSON", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [testProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());

    mockSpawn.mockImplementationOnce(() =>
      makeChildProcess("not valid json", 0),
    );

    const res = await POST(makeRequest("ws-bad-json"), {
      params: Promise.resolve({ id: "ws-bad-json" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("cleans up dedup map after successful start", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [testProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());

    const responseJson = JSON.stringify({ status: "ok" });
    mockSpawn.mockImplementationOnce(() => makeChildProcess(responseJson, 0));

    const res = await POST(makeRequest("ws-cleanup-success"), {
      params: Promise.resolve({ id: "ws-cleanup-success" }),
    });
    expect(res.status).toBe(200);

    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [testProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());
    mockSpawn.mockImplementationOnce(() => makeChildProcess(responseJson, 0));

    const res2 = await POST(makeRequest("ws-cleanup-success"), {
      params: Promise.resolve({ id: "ws-cleanup-success" }),
    });
    expect(res2.status).toBe(200);
  });

  it("cleans up dedup map after failed start", async () => {
    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [testProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());

    mockSpawn.mockImplementationOnce(() => makeChildProcess("", 1));

    const res = await POST(makeRequest("ws-cleanup-fail"), {
      params: Promise.resolve({ id: "ws-cleanup-fail" }),
    });
    expect(res.status).toBe(500);

    mockWhere
      .mockResolvedValueOnce([makeRemoteWorkspaceRow()])
      .mockResolvedValueOnce([{ value: [testProvider] }]);
    mockToWorkspace.mockReturnValueOnce(makeRemoteWorkspace());
    mockSpawn.mockImplementationOnce(() =>
      makeChildProcess('{"status":"ok"}', 0),
    );

    const res2 = await POST(makeRequest("ws-cleanup-fail"), {
      params: Promise.resolve({ id: "ws-cleanup-fail" }),
    });
    expect(res2.status).toBe(200);
  });
});
