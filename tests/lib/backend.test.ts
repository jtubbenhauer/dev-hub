// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  toWorkspace,
  getBackend,
  LocalBackend,
  RemoteBackend,
} from "@/lib/workspaces/backend";

const { mockIsRemoteHostReachable } = vi.hoisted(() => ({
  mockIsRemoteHostReachable: vi.fn(),
}));

vi.mock("@/lib/workspaces/remote-reachability", () => ({
  isRemoteHostReachable: mockIsRemoteHostReachable,
}));

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    userId: "user-1",
    name: "Test",
    path: "/home/user/dev/test",
    type: "repo" as const,
    parentRepoPath: null,
    packageManager: "pnpm" as const,
    quickCommands: null,
    backend: "local" as const,
    provider: null,
    opencodeUrl: null,
    agentUrl: null,
    providerMeta: null,
    shellCommand: null,
    sshTarget: null,
    sshPath: null,
    engine: null,
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date("2025-01-01"),
    lastAccessedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

describe("toWorkspace", () => {
  it("passes through null quickCommands", () => {
    const ws = toWorkspace(makeRow({ quickCommands: null }));
    expect(ws.quickCommands).toBeNull();
  });

  it("parses valid quickCommands", () => {
    const commands = [
      { label: "Dev", command: "pnpm dev" },
      { label: "Build", command: "pnpm build" },
    ];
    const ws = toWorkspace(makeRow({ quickCommands: commands }));
    expect(ws.quickCommands).toEqual(commands);
  });

  it("returns null for invalid quickCommands (not an array)", () => {
    const ws = toWorkspace(makeRow({ quickCommands: "not-an-array" }));
    expect(ws.quickCommands).toBeNull();
  });

  it("returns null for quickCommands with items missing required fields", () => {
    const ws = toWorkspace(makeRow({ quickCommands: [{ label: "oops" }] }));
    expect(ws.quickCommands).toBeNull();
  });

  it("passes through null providerMeta", () => {
    const ws = toWorkspace(makeRow({ providerMeta: null }));
    expect(ws.providerMeta).toBeNull();
  });

  it("parses valid providerMeta object", () => {
    const meta = { region: "us-east-1", instanceId: "i-123" };
    const ws = toWorkspace(makeRow({ providerMeta: meta }));
    expect(ws.providerMeta).toEqual(meta);
  });

  it("returns null for providerMeta that is an array", () => {
    const ws = toWorkspace(makeRow({ providerMeta: [1, 2, 3] }));
    expect(ws.providerMeta).toBeNull();
  });

  it("returns null for providerMeta that is a string", () => {
    const ws = toWorkspace(makeRow({ providerMeta: "nope" }));
    expect(ws.providerMeta).toBeNull();
  });
});

describe("toWorkspace linkedTaskMeta", () => {
  it("passes through null linkedTaskMeta", () => {
    const ws = toWorkspace(makeRow({ linkedTaskMeta: null }));
    expect(ws.linkedTaskMeta).toBeNull();
  });

  it("parses valid linkedTaskMeta", () => {
    const meta = {
      name: "Fix login bug",
      customId: "DEV-123",
      url: "https://app.clickup.com/t/abc123",
      status: "in progress",
      provider: "clickup",
    };
    const ws = toWorkspace(makeRow({ linkedTaskMeta: meta }));
    expect(ws.linkedTaskMeta).toEqual(meta);
  });

  it("returns null for linkedTaskMeta missing required fields", () => {
    const ws = toWorkspace(makeRow({ linkedTaskMeta: { name: "oops" } }));
    expect(ws.linkedTaskMeta).toBeNull();
  });

  it("returns null for linkedTaskMeta that is an array", () => {
    const ws = toWorkspace(makeRow({ linkedTaskMeta: [1, 2, 3] }));
    expect(ws.linkedTaskMeta).toBeNull();
  });

  it("returns null for linkedTaskMeta that is a string", () => {
    const ws = toWorkspace(makeRow({ linkedTaskMeta: "nope" }));
    expect(ws.linkedTaskMeta).toBeNull();
  });

  it("preserves linkedTaskId as-is", () => {
    const ws = toWorkspace(makeRow({ linkedTaskId: "task-abc-123" }));
    expect(ws.linkedTaskId).toBe("task-abc-123");
  });
});

describe("getBackend", () => {
  it("returns a LocalBackend for local workspaces", () => {
    const ws = toWorkspace(makeRow({ backend: "local" }));
    const backend = getBackend(ws);
    expect(backend).toBeInstanceOf(LocalBackend);
  });

  it("returns a RemoteBackend for remote workspaces with URLs", () => {
    const ws = toWorkspace(
      makeRow({
        backend: "remote",
        agentUrl: "http://localhost:4000",
        opencodeUrl: "http://localhost:3000",
      }),
    );
    const backend = getBackend(ws);
    expect(backend).toBeInstanceOf(RemoteBackend);
  });

  it("throws for remote workspaces missing agentUrl", () => {
    const ws = toWorkspace(
      makeRow({
        backend: "remote",
        agentUrl: null,
        opencodeUrl: "http://localhost:3000",
      }),
    );
    expect(() => getBackend(ws)).toThrow("missing agent or opencode URLs");
  });

  it("throws for remote workspaces missing opencodeUrl", () => {
    const ws = toWorkspace(
      makeRow({
        backend: "remote",
        agentUrl: "http://localhost:4000",
        opencodeUrl: null,
      }),
    );
    expect(() => getBackend(ws)).toThrow("missing agent or opencode URLs");
  });
});

describe("RemoteBackend agent requests", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    mockIsRemoteHostReachable.mockReset();
    fetchSpy.mockReset();
  });

  afterEach(() => {
    fetchSpy.mockReset();
  });

  it("fails a read at once, without calling the agent, when its host is down", async () => {
    mockIsRemoteHostReachable.mockResolvedValue(false);
    const backend = new RemoteBackend(
      "http://dev-rig:10001",
      "http://dev-rig:15001",
    );

    await expect(backend.getGitStatus()).rejects.toThrow(
      "Cannot reach the remote agent at dev-rig:10001",
    );
    expect(mockIsRemoteHostReachable).toHaveBeenCalledWith(
      "http://dev-rig:10001",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still sends a write to the agent when the last host check said it was down", async () => {
    mockIsRemoteHostReachable.mockResolvedValue(false);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const backend = new RemoteBackend(
      "http://dev-rig:10001",
      "http://dev-rig:15001",
    );

    await expect(backend.writeFile("a.txt", "x")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://dev-rig:10001/files/write",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockIsRemoteHostReachable).not.toHaveBeenCalled();
  });

  it("calls the agent when its host is reachable", async () => {
    mockIsRemoteHostReachable.mockResolvedValue(true);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ branch: "main", files: [] }), {
        status: 200,
      }),
    );
    const backend = new RemoteBackend(
      "http://dev-rig:10001",
      "http://dev-rig:15001",
    );

    await expect(backend.getGitStatus()).resolves.toEqual({
      branch: "main",
      files: [],
    });
    expect(fetchSpy).toHaveBeenCalledWith("http://dev-rig:10001/git/status");
  });
});
