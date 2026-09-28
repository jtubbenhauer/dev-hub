import { homedir } from "node:os";
// @vitest-environment node

import { execFile, type ExecFileException } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
) => void;

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn<
    (
      bin: string,
      args: string[],
      options: {
        env: NodeJS.ProcessEnv;
        cwd: string;
        timeout: number;
      },
      callback: ExecFileCallback,
    ) => void
  >(),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal()),
  execFile: mockExecFile,
}));

import {
  ensureOmoDaemon,
  getOmoDaemonStatus,
  pingOmoDaemon,
} from "@/lib/omo/daemon";
import {
  OmoDaemonNotRunningError,
  OmoDaemonUsageError,
  OmoEngineRefusedError,
  OmoUnsupportedPlatformError,
} from "@/lib/omo/errors";

function exitError(code: number): ExecFileException {
  return Object.assign(new Error(`Exited with code ${code}`), { code });
}

beforeEach(() => {
  globalThis.__devhubOmoDaemon = undefined;
  vi.stubEnv("OMO_BIN", "/opt/omo/bin/omo");
  vi.stubEnv("OMO_CODING_AGENT_DIR", "/state/omo");
});

afterAll(() => {
  for (const [, args] of vi.mocked(execFile).mock.calls) {
    expect(args).not.toContain("stop");
    expect(args).not.toContain("handoff");
  }
  vi.unstubAllEnvs();
});

describe("ensureOmoDaemon", () => {
  it("parses the last non-empty stdout line after a warning", async () => {
    mockExecFile.mockImplementationOnce((_bin, _args, _options, callback) => {
      callback(
        null,
        'warning: using shared host\n{"socket":"/state/omo/rpc/rpc.sock","pid":42,"instanceId":"instance-1","engineVersion":"2026.9.27","action":"reuse"}\n\n',
        "",
      );
    });

    await expect(
      ensureOmoDaemon({ bin: "/opt/omo", agentDir: "/state/omo" }),
    ).resolves.toEqual({
      socket: "/state/omo/rpc/rpc.sock",
      pid: 42,
      instanceId: "instance-1",
      engineVersion: "2026.9.27",
      action: "reuse",
    });
    expect(mockExecFile).toHaveBeenLastCalledWith(
      "/opt/omo",
      ["daemon", "run", "--json"],
      {
        env: expect.objectContaining({ OMO_CODING_AGENT_DIR: "/state/omo" }),
        cwd: homedir(),
        timeout: 60_000,
      },
      expect.any(Function),
    );
  });

  it.each([
    [2, OmoDaemonUsageError],
    [3, OmoDaemonNotRunningError],
    [4, OmoUnsupportedPlatformError],
    [5, OmoEngineRefusedError],
  ])("maps exit code %i to %s", async (code, ErrorClass) => {
    mockExecFile.mockImplementationOnce((_bin, _args, _options, callback) => {
      callback(exitError(code), "", "engine diagnostic");
    });

    const result = ensureOmoDaemon({
      bin: "/opt/omo",
      agentDir: "/state/omo",
    });

    await expect(result).rejects.toBeInstanceOf(ErrorClass);
    if (code === 5) {
      await expect(result).rejects.toMatchObject({
        stderr: "engine diagnostic",
      });
    }
  });

  it("throttles a retry after a failed ensure to one attempt per 30s", async () => {
    vi.useFakeTimers();
    try {
      mockExecFile.mockImplementationOnce((_bin, _args, _options, callback) => {
        callback(exitError(3), "", "");
      });

      await expect(
        ensureOmoDaemon({ bin: "/opt/omo", agentDir: "/state/omo" }),
      ).rejects.toBeInstanceOf(OmoDaemonNotRunningError);
      const callsAfterFirstFailure = mockExecFile.mock.calls.length;

      await expect(
        ensureOmoDaemon({ bin: "/opt/omo", agentDir: "/state/omo" }),
      ).rejects.toBeInstanceOf(OmoDaemonNotRunningError);
      expect(mockExecFile.mock.calls.length).toBe(callsAfterFirstFailure);

      await vi.advanceTimersByTimeAsync(30_000);
      mockExecFile.mockImplementationOnce((_bin, _args, _options, callback) => {
        callback(
          null,
          '{"socket":"/state/omo/rpc/rpc.sock","pid":42,"instanceId":"instance-2","engineVersion":"2026.9.27","action":"start"}\n',
          "",
        );
      });

      await expect(
        ensureOmoDaemon({ bin: "/opt/omo", agentDir: "/state/omo" }),
      ).resolves.toMatchObject({ instanceId: "instance-2" });
      expect(mockExecFile.mock.calls.length).toBe(callsAfterFirstFailure + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares an in-flight ensure across HMR module instances", async () => {
    const callsBeforeEnsure = mockExecFile.mock.calls.length;
    mockExecFile.mockImplementationOnce((_bin, _args, _options, callback) => {
      callback(
        null,
        '{"socket":"/state/omo/rpc/rpc.sock","pid":42,"instanceId":"instance-1","engineVersion":"2026.9.27","action":"start"}\n',
        "",
      );
    });

    const first = ensureOmoDaemon({ bin: "/opt/omo", agentDir: "/state/omo" });
    const second = ensureOmoDaemon({ bin: "/opt/omo", agentDir: "/state/omo" });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mockExecFile.mock.calls).toHaveLength(callsBeforeEnsure + 1);
  });
});

describe("getOmoDaemonStatus", () => {
  it("returns unreachable when the status command exits with code 3", async () => {
    mockExecFile.mockImplementationOnce((_bin, _args, _options, callback) => {
      callback(exitError(3), '{"reachable":false}\n', "");
    });

    await expect(getOmoDaemonStatus()).resolves.toEqual({ reachable: false });
    expect(mockExecFile).toHaveBeenLastCalledWith(
      "/opt/omo/bin/omo",
      ["daemon", "status", "--json"],
      {
        env: expect.objectContaining({ OMO_CODING_AGENT_DIR: "/state/omo" }),
        cwd: homedir(),
        timeout: 60_000,
      },
      expect.any(Function),
    );
  });

  it("returns parsed reachable status", async () => {
    mockExecFile.mockImplementationOnce((_bin, _args, _options, callback) => {
      callback(
        null,
        'notice\n{"reachable":true,"socket":"/state/omo/rpc/rpc.sock","pid":42}\n',
        "",
      );
    });

    await expect(getOmoDaemonStatus()).resolves.toEqual({
      reachable: true,
      socket: "/state/omo/rpc/rpc.sock",
      pid: 42,
    });
  });
});

describe("pingOmoDaemon", () => {
  it("requests protocol info with a five second timeout", async () => {
    const request = vi.fn().mockResolvedValue({ protocolVersion: 1 });

    await pingOmoDaemon({ request });

    expect(request).toHaveBeenCalledWith(
      { type: "get_protocol_info" },
      { timeoutMs: 5000 },
    );
  });
});
