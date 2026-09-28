// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

const mockExecFile = vi.fn(
  (
    _bin: string,
    _args: string[],
    _options: unknown,
    callback: ExecFileCallback,
  ) => {
    callback(
      null,
      JSON.stringify({
        socket: "/agent/rpc/rpc.sock",
        pid: 1,
        instanceId: "instance",
        engineVersion: "1",
        action: "start",
      }),
      "",
    );
  },
);

vi.mock("node:child_process", () => ({
  execFile: (...args: Parameters<typeof mockExecFile>) => mockExecFile(...args),
}));

function disconnectedRuntime() {
  const client = {
    isConnected: false,
    connect: vi.fn(async () => ({
      protocolVersion: 1,
      mode: "multi",
      capabilities: [],
      serverVersion: "test-host",
    })),
    request: vi.fn(async () => ({ data: {} })),
  };
  const registry = {
    refreshIndexFromHost: vi.fn(async () => undefined),
    canonicalWorkspacePath: vi.fn(async () => "/workspace"),
    findBinding: vi.fn(() => undefined),
    bindingsForLifecycle: vi.fn(() => []),
    sessionStatusesForWorkspace: vi.fn(() => ({})),
    attach: vi.fn(async () => {
      throw new Error("attach should not be called by this test");
    }),
  };
  return { client, registry, dialogs: new Map(), catalog: new Map() };
}

beforeEach(() => {
  vi.resetModules();
  globalThis.__devhubOmoDaemon = undefined;
  mockExecFile.mockClear();
});

afterEach(() => {
  vi.doUnmock("@/lib/omo/agent-dir");
  vi.doUnmock("@/lib/omo/session-registry");
  vi.restoreAllMocks();
});

describe("first-request omo daemon ensure", () => {
  it("ensures the daemon exactly once for a disconnected local read, never stop/handoff", async () => {
    // Given
    vi.doMock("@/lib/omo/agent-dir", () => ({
      resolveOmoAgentDir: () => "/agent",
      resolveOmoSocketPath: () => "/agent/rpc/rpc.sock",
    }));
    const runtime = disconnectedRuntime();
    vi.doMock("@/lib/omo/session-registry", () => ({
      getOmoRuntime: () => runtime,
    }));
    const { handleOmoRead } = await import("@/lib/omo/facade/read");
    const workspace = {
      id: "workspace-1",
      path: "/workspace",
      backend: "local" as const,
    };

    // When
    const response = await handleOmoRead({
      method: "GET",
      path: "/global/health",
      query: new URLSearchParams(),
      workspace,
      userId: "user-1",
    });

    // Then
    expect(response.status).toBe(200);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      ["daemon", "run", "--json"],
      expect.anything(),
      expect.any(Function),
    );
    for (const call of mockExecFile.mock.calls) {
      expect(call[1]).not.toContain("stop");
      expect(call[1]).not.toContain("handoff");
    }
  });

  it("does not ensure the daemon for an already-connected local read", async () => {
    // Given
    vi.doMock("@/lib/omo/agent-dir", () => ({
      resolveOmoAgentDir: () => "/agent",
      resolveOmoSocketPath: () => "/agent/rpc/rpc.sock",
    }));
    const runtime = disconnectedRuntime();
    runtime.client.isConnected = true;
    vi.doMock("@/lib/omo/session-registry", () => ({
      getOmoRuntime: () => runtime,
    }));
    const { handleOmoRead } = await import("@/lib/omo/facade/read");
    const workspace = {
      id: "workspace-1",
      path: "/workspace",
      backend: "local" as const,
    };

    // When
    await handleOmoRead({
      method: "GET",
      path: "/global/health",
      query: new URLSearchParams(),
      workspace,
      userId: "user-1",
    });

    // Then
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("never ensures the local daemon for a remote workspace read", async () => {
    // Given
    const { handleOmoRead } = await import("@/lib/omo/facade/read");
    const workspace = {
      id: "workspace-1",
      path: "/workspace",
      backend: "remote" as const,
      agentUrl: null,
    };

    // When
    await handleOmoRead({
      method: "GET",
      path: "/permission",
      query: new URLSearchParams(),
      workspace,
      userId: "user-1",
    });

    // Then
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
