// @vitest-environment node

import type { ExecFileException } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
) => void;

const { mockExecFile, mockExistsSync, mockHomedir } = vi.hoisted(() => ({
  mockExecFile:
    vi.fn<
      (
        bin: string,
        args: string[],
        options: { timeout: number },
        callback: ExecFileCallback,
      ) => void
    >(),
  mockExistsSync: vi.fn(),
  mockHomedir: vi.fn(() => "/home/tester"),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal()),
  execFile: mockExecFile,
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal()),
  existsSync: mockExistsSync,
}));

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal()),
  homedir: mockHomedir,
}));

import {
  assertSupportedPlatform,
  findOmoBinary,
  verifyOmoBinary,
} from "@/lib/omo/binary";
import { resolveOmoAgentDir, resolveOmoSocketPath } from "@/lib/omo/agent-dir";
import { OmoBinaryError, OmoUnsupportedPlatformError } from "@/lib/omo/errors";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("findOmoBinary", () => {
  it("uses OMO_BIN when the override is configured", () => {
    vi.stubEnv("OMO_BIN", "/opt/omo/bin/omo");
    mockExistsSync.mockReturnValue(true);

    expect(findOmoBinary()).toBe("/opt/omo/bin/omo");
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it("uses the Bun installation when it exists", () => {
    vi.stubEnv("OMO_BIN", "");
    mockExistsSync.mockReturnValue(true);

    expect(findOmoBinary()).toBe("/home/tester/.bun/bin/omo");
  });

  it("falls back to the executable name when the Bun installation is absent", () => {
    vi.stubEnv("OMO_BIN", "");
    mockExistsSync.mockReturnValue(false);

    expect(findOmoBinary()).toBe("omo");
  });
});

describe("verifyOmoBinary", () => {
  it("returns the omo and senpi versions from real launcher output", async () => {
    mockExecFile.mockImplementation((_bin, _args, _options, callback) => {
      callback(null, "omo 5.0.1 (engine: senpi 2026.9.27)\n", "");
    });

    await expect(verifyOmoBinary("/opt/omo")).resolves.toEqual({
      omoVersion: "5.0.1",
      senpiVersion: "2026.9.27",
    });
    expect(mockExecFile).toHaveBeenCalledWith(
      "/opt/omo",
      ["--version"],
      { timeout: 5000 },
      expect.any(Function),
    );
  });

  it("throws OmoBinaryError with stderr when output is malformed", async () => {
    mockExecFile.mockImplementation((_bin, _args, _options, callback) => {
      callback(null, "unexpected output\n", "launcher warning");
    });

    await expect(verifyOmoBinary("omo")).rejects.toMatchObject({
      name: "OmoBinaryError",
      stderr: "launcher warning",
    });
  });
});

describe("agent directory resolution", () => {
  it("prefers OMO_CODING_AGENT_DIR over the legacy Senpi override", () => {
    vi.stubEnv("OMO_CODING_AGENT_DIR", "/state/omo");
    vi.stubEnv("SENPI_CODING_AGENT_DIR", "/state/senpi");

    expect(resolveOmoAgentDir()).toBe("/state/omo");
  });

  it("uses the Senpi override before the default directory", () => {
    vi.stubEnv("OMO_CODING_AGENT_DIR", "");
    vi.stubEnv("SENPI_CODING_AGENT_DIR", "/state/senpi");

    expect(resolveOmoAgentDir()).toBe("/state/senpi");
  });

  it("defaults to the branded directory under the home directory", () => {
    vi.stubEnv("OMO_CODING_AGENT_DIR", "");
    vi.stubEnv("SENPI_CODING_AGENT_DIR", "");

    expect(resolveOmoAgentDir()).toBe("/home/tester/.omo/agent");
  });

  it("prefers OMO_RPC_SOCKET over the agent directory socket", () => {
    vi.stubEnv("OMO_RPC_SOCKET", "/run/omo.sock");

    expect(resolveOmoSocketPath("/state/omo")).toBe("/run/omo.sock");
  });

  it("defaults the socket path under the agent directory", () => {
    vi.stubEnv("OMO_RPC_SOCKET", "");

    expect(resolveOmoSocketPath("/state/omo")).toBe(
      join("/state/omo", "rpc", "rpc.sock"),
    );
  });
});

describe("platform support", () => {
  it("throws OmoUnsupportedPlatformError on win32", () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    expect(() => assertSupportedPlatform()).toThrow(
      OmoUnsupportedPlatformError,
    );
  });
});

describe("POSIX-only source", () => {
  it("does not include Windows handshake file handling", () => {
    const source = readFileSync("lib/omo/binary.ts", "utf8");

    expect(source).not.toContain(".secret");
    expect(OmoBinaryError).toBeDefined();
  });
});
