import { homedir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

type ExecFileCallback = (
  error: (Error & { code?: number }) | null,
  stdout: string,
  stderr: string,
) => void;

function respondWith(exitCode: number, stdout: string, stderr = ""): void {
  execFileMock.mockImplementationOnce(
    (
      _bin: string,
      _args: string[],
      _options: unknown,
      callback: ExecFileCallback,
    ) => {
      if (exitCode === 0) {
        callback(null, stdout, stderr);
        return;
      }
      const error = new Error(
        `command failed with exit code ${exitCode}`,
      ) as Error & {
        code?: number;
      };
      error.code = exitCode;
      callback(error, stdout, stderr);
    },
  );
}

describe("ensureOmoDaemon / getOmoDaemonStatus", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    delete process.env.OMO_BIN;
    delete process.env.OMO_CODING_AGENT_DIR;
    delete process.env.SENPI_CODING_AGENT_DIR;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns daemon info on exit code 0", async () => {
    const { ensureOmoDaemon } = await import("../../src/omo/daemon.js");
    respondWith(
      0,
      `${JSON.stringify({
        socket: "/tmp/rpc.sock",
        pid: 1234,
        instanceId: "instance-1",
        engineVersion: "1.2.3",
        action: "started",
      })}\n`,
    );

    const info = await ensureOmoDaemon();
    expect(info).toEqual({
      socket: "/tmp/rpc.sock",
      pid: 1234,
      instanceId: "instance-1",
      engineVersion: "1.2.3",
      action: "started",
    });
  });

  it("starts the shared daemon from the home directory, not the caller's cwd", async () => {
    const { ensureOmoDaemon } = await import("../../src/omo/daemon.js");
    respondWith(
      0,
      `${JSON.stringify({
        socket: "/tmp/rpc.sock",
        pid: 1,
        instanceId: "instance-1",
        engineVersion: "1.2.3",
        action: "running",
      })}\n`,
    );

    await ensureOmoDaemon();

    expect(execFileMock.mock.calls[0]?.[2]).toMatchObject({ cwd: homedir() });
  });

  it("maps exit code 2 to a usage error", async () => {
    const { ensureOmoDaemon, OmoDaemonError } =
      await import("../../src/omo/daemon.js");
    respondWith(2, "");

    await expect(ensureOmoDaemon()).rejects.toMatchObject(
      new OmoDaemonError(
        "usage",
        "The omo daemon command rejected its arguments",
      ),
    );
  });

  it("maps exit code 3 to a not_running error on ensure", async () => {
    const { ensureOmoDaemon } = await import("../../src/omo/daemon.js");
    respondWith(3, "");

    await expect(ensureOmoDaemon()).rejects.toMatchObject({
      kind: "not_running",
    });
  });

  it("maps exit code 4 to an unsupported_platform error", async () => {
    const { ensureOmoDaemon } = await import("../../src/omo/daemon.js");
    respondWith(4, "");

    await expect(ensureOmoDaemon()).rejects.toMatchObject({
      kind: "unsupported_platform",
    });
  });

  it("maps exit code 5 to an engine_refused error", async () => {
    const { ensureOmoDaemon } = await import("../../src/omo/daemon.js");
    respondWith(5, "", "engine exploded");

    await expect(ensureOmoDaemon()).rejects.toMatchObject({
      kind: "engine_refused",
      message: expect.stringContaining("engine exploded"),
    });
  });

  it("treats exit code 3 as reachable:false on status, not an error", async () => {
    const { getOmoDaemonStatus } = await import("../../src/omo/daemon.js");
    respondWith(3, "");

    await expect(getOmoDaemonStatus()).resolves.toEqual({ reachable: false });
  });

  it("returns parsed status on exit code 0", async () => {
    const { getOmoDaemonStatus } = await import("../../src/omo/daemon.js");
    respondWith(0, `${JSON.stringify({ reachable: true, pid: 55 })}\n`);

    await expect(getOmoDaemonStatus()).resolves.toEqual({
      reachable: true,
      pid: 55,
    });
  });

  it("maps exit code 5 to engine_refused on status", async () => {
    const { getOmoDaemonStatus } = await import("../../src/omo/daemon.js");
    respondWith(5, "", "refused");

    await expect(getOmoDaemonStatus()).rejects.toMatchObject({
      kind: "engine_refused",
    });
  });
});
