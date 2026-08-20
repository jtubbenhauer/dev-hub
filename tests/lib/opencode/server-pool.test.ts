// @vitest-environment node

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateServer, mockSpawn } = vi.hoisted(() => ({
  mockCreateServer: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal()),
  spawn: mockSpawn,
}));

vi.mock("node:net", async (importOriginal) => ({
  ...(await importOriginal()),
  createServer: mockCreateServer,
}));

class FakeOpenCodeProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly pid = 12345;
  readonly kill = vi.fn(() => true);
}

class FakePortProbe extends EventEmitter {
  readonly close = vi.fn((callback: () => void) => callback());

  constructor(private readonly isOccupied: boolean) {
    super();
  }

  listen(): this {
    queueMicrotask(() => {
      if (this.isOccupied) {
        this.emit(
          "error",
          Object.assign(new Error("address in use"), {
            code: "EADDRINUSE",
          }),
        );
        return;
      }
      this.emit("listening");
    });
    return this;
  }
}

describe("OpenCode server pool", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("not running")));
    mockCreateServer.mockReturnValue(new FakePortProbe(false));
  });

  afterEach(async () => {
    const { stopServer } = await import("@/lib/opencode/server-pool");
    stopServer();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("stops retaining OpenCode output after startup completes", async () => {
    const process = new FakeOpenCodeProcess();
    mockSpawn.mockReturnValue(process);
    const { getOrStartServer } = await import("@/lib/opencode/server-pool");

    const serverPromise = getOrStartServer();
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledOnce());
    process.stdout.write(
      "opencode server listening on http://127.0.0.1:4096\n",
    );

    await expect(serverPromise).resolves.toEqual({
      url: "http://127.0.0.1:4096",
      port: 4096,
    });

    expect(process.stdout.listenerCount("data")).toBe(0);
    expect(process.stderr.listenerCount("data")).toBe(0);
    expect(process.stdout.readableFlowing).toBe(true);
    expect(process.stderr.readableFlowing).toBe(true);
  });

  it("uses an OS-assigned port when the default port is occupied by an unresponsive server", async () => {
    const process = new FakeOpenCodeProcess();
    mockCreateServer.mockReturnValue(new FakePortProbe(true));
    mockSpawn.mockReturnValue(process);
    const { getOrStartServer } = await import("@/lib/opencode/server-pool");

    const serverPromise = getOrStartServer();
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledOnce());
    process.stdout.write(
      "opencode server listening on http://127.0.0.1:43127\n",
    );

    await expect(serverPromise).resolves.toEqual({
      url: "http://127.0.0.1:43127",
      port: 43127,
    });
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      ["serve", "--hostname=127.0.0.1", "--port=0"],
      expect.any(Object),
    );
  });

  it("shares a server startup across reloaded module instances", async () => {
    const firstProcess = new FakeOpenCodeProcess();
    const duplicateProcess = new FakeOpenCodeProcess();
    mockSpawn
      .mockReturnValueOnce(firstProcess)
      .mockReturnValueOnce(duplicateProcess);

    const firstModule = await import("@/lib/opencode/server-pool");
    const firstServerPromise = firstModule.getOrStartServer();
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledOnce());

    vi.resetModules();
    const reloadedModule = await import("@/lib/opencode/server-pool");
    const reloadedServerPromise = reloadedModule.getOrStartServer();

    firstProcess.stdout.write(
      "opencode server listening on http://127.0.0.1:4096\n",
    );
    duplicateProcess.stdout.write(
      "opencode server listening on http://127.0.0.1:43127\n",
    );

    await expect(
      Promise.all([firstServerPromise, reloadedServerPromise]),
    ).resolves.toEqual([
      { url: "http://127.0.0.1:4096", port: 4096 },
      { url: "http://127.0.0.1:4096", port: 4096 },
    ]);
    expect(mockSpawn).toHaveBeenCalledOnce();
  });

  it("cancels an in-flight startup before starting its replacement", async () => {
    mockSpawn.mockReset();
    let releaseFirstProbe: (() => void) | undefined;
    const firstProbe = new Promise<Response>((resolve) => {
      releaseFirstProbe = () => resolve(new Response(null, { status: 503 }));
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(firstProbe)
        .mockRejectedValue(new Error("not running")),
    );
    const replacementProcess = new FakeOpenCodeProcess();
    const cancelledProcess = new FakeOpenCodeProcess();
    mockSpawn
      .mockReturnValueOnce(replacementProcess)
      .mockReturnValueOnce(cancelledProcess);

    const firstModule = await import("@/lib/opencode/server-pool");
    const cancelledServerPromise = firstModule.getOrStartServer();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    firstModule.stopServer();
    const replacementModule = firstModule;
    const replacementServerPromise = replacementModule.getOrStartServer();
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledOnce());
    replacementProcess.stdout.write(
      "opencode server listening on http://127.0.0.1:4096\n",
    );

    const cancelledServerResult = expect(
      cancelledServerPromise,
    ).rejects.toThrow("This operation was aborted");
    releaseFirstProbe?.();
    cancelledProcess.stdout.write(
      "opencode server listening on http://127.0.0.1:43127\n",
    );

    await cancelledServerResult;
    await expect(replacementServerPromise).resolves.toEqual({
      url: "http://127.0.0.1:4096",
      port: 4096,
    });
    expect(mockSpawn).toHaveBeenCalledOnce();
  });

  it("ignores a stale health-check failure after starting a replacement", async () => {
    vi.useFakeTimers();
    mockSpawn.mockReset();
    let rejectHealthCheck: ((error: Error) => void) | undefined;
    const healthCheck = new Promise<Response>((_resolve, reject) => {
      rejectHealthCheck = reject;
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("not running"))
        .mockReturnValueOnce(healthCheck)
        .mockRejectedValue(new Error("not running")),
    );
    const firstProcess = new FakeOpenCodeProcess();
    const replacementProcess = new FakeOpenCodeProcess();
    mockSpawn
      .mockReturnValueOnce(firstProcess)
      .mockReturnValueOnce(replacementProcess);

    const firstModule = await import("@/lib/opencode/server-pool");
    const firstServerPromise = firstModule.getOrStartServer();
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledOnce());
    firstProcess.stdout.write(
      "opencode server listening on http://127.0.0.1:4096\n",
    );
    await firstServerPromise;

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    firstModule.stopServer();

    const replacementModule = firstModule;
    const replacementServerPromise = replacementModule.getOrStartServer();
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(2));
    replacementProcess.stdout.write(
      "opencode server listening on http://127.0.0.1:4096\n",
    );
    await replacementServerPromise;

    rejectHealthCheck?.(new Error("stale server failed"));
    await vi.advanceTimersByTimeAsync(0);

    expect(replacementProcess.kill).not.toHaveBeenCalled();
    expect(replacementModule.getServerStatus()?.status).toBe("ready");
  });

  it("requires repeated control-plane failures before stopping the server", async () => {
    vi.useFakeTimers();
    mockSpawn.mockReset();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("not running"))
        .mockRejectedValue(new Error("health unavailable")),
    );
    const process = new FakeOpenCodeProcess();
    mockSpawn.mockReturnValue(process);

    const { getOrStartServer } = await import("@/lib/opencode/server-pool");
    const serverPromise = getOrStartServer();
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledOnce());
    process.stdout.write(
      "opencode server listening on http://127.0.0.1:4096\n",
    );
    await serverPromise;

    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetch).toHaveBeenLastCalledWith(
      "http://127.0.0.1:4096/global/health",
      expect.any(Object),
    );
    expect(process.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(process.kill).toHaveBeenCalledOnce();
  });
});
