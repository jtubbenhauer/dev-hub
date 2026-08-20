import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export interface ServerState {
  process: ChildProcess;
  url: string;
  port: number;
  pid: number | null;
  status: "starting" | "ready" | "error" | "stopped";
  abortController: AbortController;
  lastActivity: number;
  errorMessage?: string;
}

export interface SharedServer {
  abortController: AbortController;
  startPromise: Promise<ServerState>;
  state: ServerState | null;
}

declare global {
  var __devHubOpenCodeServer: SharedServer | undefined;
}

export function getSharedServer(): SharedServer | undefined {
  return globalThis.__devHubOpenCodeServer;
}

export function createSharedServer(
  start: (abortController: AbortController) => Promise<ServerState>,
): SharedServer {
  const abortController = new AbortController();
  return {
    abortController,
    startPromise: start(abortController),
    state: null,
  };
}

export function setSharedServer(server: SharedServer): void {
  globalThis.__devHubOpenCodeServer = server;
}

export function markSharedServerReady(
  expected: SharedServer,
  state: ServerState,
): void {
  if (globalThis.__devHubOpenCodeServer === expected) {
    expected.state = state;
  }
}

export function clearSharedServer(expected?: SharedServer): void {
  if (!expected || globalThis.__devHubOpenCodeServer === expected) {
    globalThis.__devHubOpenCodeServer = undefined;
  }
}

export function clearSharedServerState(state: ServerState): void {
  if (globalThis.__devHubOpenCodeServer?.state === state) {
    globalThis.__devHubOpenCodeServer = undefined;
  }
}

export function findOpenCodeBinary(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return process.env.OPENCODE_BIN || `${homeDir}/.opencode/bin/opencode`;
}

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

export function waitForServerUrl(
  process: ChildProcess,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    let isSettled = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      process.stdout?.removeListener("data", handleStdout);
      process.stderr?.removeListener("data", handleStderr);
      process.removeListener("exit", handleExit);
      process.removeListener("error", handleError);
      process.stdout?.resume();
      process.stderr?.resume();
    };
    const settleWithError = (error: Error) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      reject(error);
    };
    const settleWithUrl = (url: string) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      resolve(url);
    };
    const handleStdout = (chunk: Buffer) => {
      output += chunk.toString();
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.startsWith("opencode server listening")) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          if (match) {
            settleWithUrl(match[1]);
            return;
          }
        }
      }
    };
    const handleStderr = (chunk: Buffer) => {
      output += chunk.toString();
    };
    const handleExit = (code: number | null) => {
      settleWithError(new Error(`Server exited with code ${code}\n${output}`));
    };
    const handleError = (error: Error) => settleWithError(error);
    const timeoutId = setTimeout(
      () =>
        settleWithError(
          new Error(`OpenCode server startup timed out after ${timeoutMs}ms`),
        ),
      timeoutMs,
    );

    process.stdout?.on("data", handleStdout);
    process.stderr?.on("data", handleStderr);
    process.on("exit", handleExit);
    process.on("error", handleError);
  });
}
