import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DAEMON_COMMAND_TIMEOUT_MS = 60_000;

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

export type OmoDaemonErrorKind =
  | "usage"
  | "not_running"
  | "unsupported_platform"
  | "engine_refused";

export class OmoDaemonError extends Error {
  readonly kind: OmoDaemonErrorKind;

  constructor(kind: OmoDaemonErrorKind, message: string) {
    super(message);
    this.name = "OmoDaemonError";
    this.kind = kind;
  }
}

export function findOmoBinary(): string {
  const configuredBinary = process.env.OMO_BIN;
  if (configuredBinary) return configuredBinary;

  const bunBinary = join(homedir(), ".bun", "bin", "omo");
  return existsSync(bunBinary) ? bunBinary : "omo";
}

export function resolveOmoAgentDir(): string {
  return (
    process.env.OMO_CODING_AGENT_DIR ||
    process.env.SENPI_CODING_AGENT_DIR ||
    join(homedir(), ".omo", "agent")
  );
}

function resolveOmoSocketPath(agentDir: string): string {
  return process.env.OMO_RPC_SOCKET || join(agentDir, "rpc", "rpc.sock");
}

type OmoDaemonCommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: Error | null;
};

function readExitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
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
    socket:
      (value.socket as string | undefined) ?? resolveOmoSocketPath(agentDir),
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

function throwForExitCode(
  exitCode: number,
  stderr: string,
  fallback: Error | null,
): never {
  switch (exitCode) {
    case 2:
      throw new OmoDaemonError(
        "usage",
        "The omo daemon command rejected its arguments",
      );
    case 3:
      throw new OmoDaemonError("not_running", "The omo daemon is not running");
    case 4:
      throw new OmoDaemonError(
        "unsupported_platform",
        "OmO Native requires a POSIX platform with Unix socket support",
      );
    case 5:
      throw new OmoDaemonError(
        "engine_refused",
        stderr || "The omo engine refused to start",
      );
    default:
      throw (
        fallback ??
        new OmoDaemonError(
          "engine_refused",
          stderr || "The omo daemon command failed",
        )
      );
  }
}

export async function ensureOmoDaemon(): Promise<OmoDaemonInfo> {
  const bin = findOmoBinary();
  const agentDir = resolveOmoAgentDir();
  const result = await runOmoDaemonCommand(bin, agentDir, [
    "daemon",
    "run",
    "--json",
  ]);
  if (result.exitCode === 0) return parseDaemonInfo(result.stdout, agentDir);
  throwForExitCode(result.exitCode, result.stderr, result.error);
}

export async function getOmoDaemonStatus(): Promise<OmoDaemonStatus> {
  const bin = findOmoBinary();
  const agentDir = resolveOmoAgentDir();
  const result = await runOmoDaemonCommand(bin, agentDir, [
    "daemon",
    "status",
    "--json",
  ]);
  if (result.exitCode === 3) return { reachable: false };
  if (result.exitCode === 0) return parseDaemonStatus(result.stdout);
  throwForExitCode(result.exitCode, result.stderr, result.error);
}
