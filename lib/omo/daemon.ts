import { execFile } from "node:child_process";
import { homedir } from "node:os";

import { resolveOmoAgentDir, resolveOmoSocketPath } from "./agent-dir";
import { findOmoBinary } from "./binary";
import {
  OmoDaemonNotRunningError,
  OmoDaemonUsageError,
  OmoEngineRefusedError,
  OmoUnsupportedPlatformError,
} from "./errors";

const DAEMON_COMMAND_TIMEOUT_MS = 60_000;
const DAEMON_PING_TIMEOUT_MS = 5_000;
const DAEMON_ENSURE_RETRY_THROTTLE_MS = 30_000;

export type OmoDaemonInfo = {
  readonly socket: string;
  readonly pid: number;
  readonly instanceId: string;
  readonly engineVersion: string;
  readonly action: string;
};

export type OmoDaemonStatus = {
  readonly reachable: boolean;
  readonly [key: string]: unknown;
};

export type EnsureOmoDaemonOptions = {
  readonly bin?: string;
  readonly agentDir?: string;
};

export type OmoDaemonHealthClient = {
  readonly request: (
    record: { readonly type: "get_protocol_info" },
    options: { readonly timeoutMs: number },
  ) => Promise<unknown>;
};

type OmoDaemonCommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: Error | null;
};

type OmoDaemonStart = {
  readonly promise: Promise<OmoDaemonInfo>;
  startedAt: number | undefined;
};

declare global {
  var __devhubOmoDaemonStart: OmoDaemonStart | undefined;
}

function readExitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "number" ? error.code : undefined;
}

function runOmoDaemonCommand(
  bin: string,
  agentDir: string,
  args: readonly string[],
): Promise<OmoDaemonCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      [...args],
      {
        env: { ...process.env, OMO_CODING_AGENT_DIR: agentDir },
        // The shared daemon inherits this cwd; never tie it to a checkout.
        cwd: homedir(),
        timeout: DAEMON_COMMAND_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ exitCode: 0, stdout, stderr, error: null });
          return;
        }

        const exitCode = readExitCode(error);
        if (exitCode === undefined) {
          reject(error);
          return;
        }
        resolve({ exitCode, stdout, stderr, error });
      },
    );
  });
}

function parseLastJsonLine(stdout: string): unknown {
  const line = stdout
    .split("\n")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
    .at(-1);
  return JSON.parse(line ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDaemonInfo(stdout: string, agentDir: string): OmoDaemonInfo {
  const value = parseLastJsonLine(stdout);
  if (
    !isRecord(value) ||
    (value.socket !== undefined && typeof value.socket !== "string") ||
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid) ||
    typeof value.instanceId !== "string" ||
    typeof value.engineVersion !== "string" ||
    typeof value.action !== "string"
  ) {
    throw new SyntaxError("Invalid omo daemon response");
  }
  return {
    socket: value.socket ?? resolveOmoSocketPath(agentDir),
    pid: value.pid,
    instanceId: value.instanceId,
    engineVersion: value.engineVersion,
    action: value.action,
  };
}

function parseDaemonStatus(stdout: string): OmoDaemonStatus {
  const value = parseLastJsonLine(stdout);
  if (!isRecord(value) || typeof value.reachable !== "boolean") {
    throw new SyntaxError("Invalid omo daemon status response");
  }
  return { ...value, reachable: value.reachable };
}

async function startOmoDaemon(
  bin: string,
  agentDir: string,
): Promise<OmoDaemonInfo> {
  const result = await runOmoDaemonCommand(bin, agentDir, [
    "daemon",
    "run",
    "--json",
  ]);

  switch (result.exitCode) {
    case 0: {
      return parseDaemonInfo(result.stdout, agentDir);
    }
    case 2:
      throw new OmoDaemonUsageError();
    case 3:
      throw new OmoDaemonNotRunningError();
    case 4:
      throw new OmoUnsupportedPlatformError();
    case 5:
      throw new OmoEngineRefusedError(result.stderr);
    default:
      throw result.error ?? new OmoEngineRefusedError(result.stderr);
  }
}

export function ensureOmoDaemon(
  options: EnsureOmoDaemonOptions = {},
): Promise<OmoDaemonInfo> {
  const currentStart = globalThis.__devhubOmoDaemonStart;
  if (currentStart) return currentStart.promise;

  const bin = options.bin ?? findOmoBinary();
  const agentDir = options.agentDir ?? resolveOmoAgentDir();
  const start: OmoDaemonStart = {
    promise: startOmoDaemon(bin, agentDir),
    startedAt: undefined,
  };
  globalThis.__devhubOmoDaemonStart = start;
  void start.promise.then(
    () => {
      start.startedAt = Date.now();
    },
    () => {
      if (globalThis.__devhubOmoDaemonStart !== start) return;
      // Throttle: keep serving this rejection instead of allowing an immediate re-spawn.
      const timer = setTimeout(() => {
        if (globalThis.__devhubOmoDaemonStart === start) {
          globalThis.__devhubOmoDaemonStart = undefined;
        }
      }, DAEMON_ENSURE_RETRY_THROTTLE_MS);
      timer.unref?.();
    },
  );
  return start.promise;
}

// omo stops its daemon after a period without sessions, so a remembered start
// can outlive the daemon. Forgetting it makes the next ensureOmoDaemon() run
// `omo daemon run` again. Starts in progress, throttled failures and starts
// from the last 30 seconds are kept.
export function forgetStartedOmoDaemon(): void {
  const start = globalThis.__devhubOmoDaemonStart;
  if (start?.startedAt === undefined) return;
  if (Date.now() - start.startedAt < DAEMON_ENSURE_RETRY_THROTTLE_MS) return;
  globalThis.__devhubOmoDaemonStart = undefined;
}

export async function getOmoDaemonStatus(): Promise<OmoDaemonStatus> {
  const result = await runOmoDaemonCommand(
    findOmoBinary(),
    resolveOmoAgentDir(),
    ["daemon", "status", "--json"],
  );
  if (result.exitCode === 3) return { reachable: false };
  if (result.exitCode === 2) throw new OmoDaemonUsageError();
  if (result.exitCode === 4) throw new OmoUnsupportedPlatformError();
  if (result.exitCode === 5) throw new OmoEngineRefusedError(result.stderr);
  if (result.exitCode !== 0) {
    throw result.error ?? new OmoEngineRefusedError(result.stderr);
  }
  return parseDaemonStatus(result.stdout);
}

export async function pingOmoDaemon(
  client: OmoDaemonHealthClient,
): Promise<void> {
  await client.request(
    { type: "get_protocol_info" },
    { timeoutMs: DAEMON_PING_TIMEOUT_MS },
  );
}
