// @vitest-environment node

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal()),
  spawn: mockSpawn,
}));

class FakeOpenCodeProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly pid = 12345;
  readonly kill = vi.fn(() => true);
}

describe("OpenCode server pool", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("not running")));
  });

  afterEach(async () => {
    const { stopServer } = await import("@/lib/opencode/server-pool");
    stopServer();
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
});
