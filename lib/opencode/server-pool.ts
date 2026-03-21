import { spawn, type ChildProcess } from "node:child_process";
import type { OpenCodeInstance } from "./types";

const DEFAULT_PORT = 4096;
const STARTUP_TIMEOUT_MS = 10000;
const HEALTH_CHECK_INTERVAL_MS = 30000;

interface ServerState {
  process: ChildProcess;
  url: string;
  port: number;
  pid: number | null;
  status: "starting" | "ready" | "error" | "stopped";
  abortController: AbortController;
  lastActivity: number;
  errorMessage?: string;
}

let serverState: ServerState | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

function findOpenCodeBinary(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return process.env.OPENCODE_BIN || `${homeDir}/.opencode/bin/opencode`;
}

async function tryAdoptExistingServer(
  port: number,
): Promise<ServerState | null> {
  const url = `http://127.0.0.1:${port}`;
  try {
    const response = await fetch(`${url}/session`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;

    console.log(`[opencode] Adopted existing server at ${url}`);
    const abortController = new AbortController();
    const state: ServerState = {
      process: null as unknown as ChildProcess,
      url,
      port,
      pid: null,
      status: "ready",
      abortController,
      lastActivity: Date.now(),
    };
    serverState = state;
    startHealthChecks();
    return state;
  } catch {
    return null;
  }
}

async function startServer(port = DEFAULT_PORT): Promise<ServerState> {
  if (serverState?.status === "ready") {
    return serverState;
  }

  if (serverState?.status === "starting") {
    return waitForReady(serverState);
  }

  // Check if a server is already running on the port (survives HMR / state loss)
  const adopted = await tryAdoptExistingServer(port);
  if (adopted) return adopted;

  const abortController = new AbortController();
  const binary = findOpenCodeBinary();

  const args = ["serve", `--hostname=127.0.0.1`, `--port=${port}`];

  const proc = spawn(binary, args, {
    signal: abortController.signal,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const state: ServerState = {
    process: proc,
    url: "",
    port,
    pid: proc.pid ?? null,
    status: "starting",
    abortController,
    lastActivity: Date.now(),
  };

  serverState = state;

  try {
    const url = await waitForServerUrl(proc, STARTUP_TIMEOUT_MS);
    state.url = url;
    state.status = "ready";
    state.lastActivity = Date.now();

    proc.on("exit", (code) => {
      console.error(`[opencode] Server exited with code ${code}`);
      state.status = "stopped";
      if (serverState === state) {
        serverState = null;
      }
    });

    startHealthChecks();
    console.log(`[opencode] Server ready at ${url}`);
    return state;
  } catch (error) {
    state.status = "error";
    state.errorMessage = error instanceof Error ? error.message : String(error);
    proc.kill();
    serverState = null;
    throw error;
  }
}

function waitForServerUrl(
  proc: ChildProcess,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(
        new Error(`OpenCode server startup timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);

    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.startsWith("opencode server listening")) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          if (match) {
            clearTimeout(timeoutId);
            resolve(match[1]);
            return;
          }
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("exit", (code) => {
      clearTimeout(timeoutId);
      reject(new Error(`Server exited with code ${code}\n${output}`));
    });

    proc.on("error", (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

async function waitForReady(state: ServerState): Promise<ServerState> {
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      if (state.status === "ready") {
        clearInterval(checkInterval);
        resolve(state);
      } else if (state.status === "error" || state.status === "stopped") {
        clearInterval(checkInterval);
        reject(new Error(state.errorMessage || "Server failed to start"));
      }
    }, 100);

    setTimeout(() => {
      clearInterval(checkInterval);
      reject(new Error("Timed out waiting for server to become ready"));
    }, STARTUP_TIMEOUT_MS);
  });
}

function startHealthChecks() {
  if (healthCheckTimer) return;

  healthCheckTimer = setInterval(async () => {
    if (!serverState || serverState.status !== "ready") {
      stopHealthChecks();
      return;
    }

    try {
      const response = await fetch(`${serverState.url}/session`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        console.warn(`[opencode] Health check returned ${response.status}`);
      }
      serverState.lastActivity = Date.now();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[opencode] Health check failed: ${message}`);
      if (serverState.process) {
        serverState.abortController.abort();
        serverState.process.kill();
      }
      serverState.status = "stopped";
      serverState = null;
      stopHealthChecks();
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function stopHealthChecks() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

export async function getOrStartServer(): Promise<{
  url: string;
  port: number;
}> {
  const state = await startServer();
  state.lastActivity = Date.now();
  return { url: state.url, port: state.port };
}

export function stopServer() {
  stopHealthChecks();
  if (serverState) {
    if (serverState.process) {
      serverState.abortController.abort();
      serverState.process.kill();
    }
    serverState.status = "stopped";
    serverState = null;
  }
}

export function getServerStatus(): OpenCodeInstance | null {
  if (!serverState) return null;

  return {
    workspaceId: "shared",
    workspacePath: "",
    port: serverState.port,
    url: serverState.url,
    pid: serverState.pid,
    status: serverState.status,
    lastActivity: serverState.lastActivity,
    errorMessage: serverState.errorMessage,
  };
}

export function isServerRunning(): boolean {
  return serverState?.status === "ready";
}
