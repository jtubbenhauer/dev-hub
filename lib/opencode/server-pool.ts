import { spawn, type ChildProcess } from "node:child_process";
import type { OpenCodeInstance } from "./types";
import {
  clearSharedServer,
  clearSharedServerState,
  createSharedServer,
  findOpenCodeBinary,
  getSharedServer,
  hasStoppedListening,
  isPortAvailable,
  markSharedServerReady,
  setSharedServer,
  type ServerState,
  type SharedServer,
  waitForServerUrl,
} from "./server-runtime";

const DEFAULT_PORT = 4096;
const STARTUP_TIMEOUT_MS = 10000;
const HEALTH_CHECK_INTERVAL_MS = 30000;
// OpenCode stops every reply at 32,000 tokens, thinking included, unless told
// otherwise. Opus at the max thinking level can spend all of it thinking and
// end with no answer. Each model is still held to its own output limit.
const DEFAULT_OUTPUT_TOKEN_MAX = "128000";

let serverState: ServerState | null = null;
let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

async function tryAdoptExistingServer(
  port: number,
  abortController: AbortController,
): Promise<ServerState | null> {
  const url = `http://127.0.0.1:${port}`;
  try {
    const response = await fetch(`${url}/session`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;

    console.log(`[opencode] Adopted existing server at ${url}`);
    return {
      process: null as unknown as ChildProcess,
      url,
      port,
      pid: null,
      status: "ready",
      abortController,
      lastActivity: Date.now(),
    };
  } catch {
    return null;
  }
}

async function startServer(
  abortController: AbortController,
  port = DEFAULT_PORT,
): Promise<ServerState> {
  abortController.signal.throwIfAborted();
  if (serverState?.status === "ready") {
    return serverState;
  }

  if (serverState?.status === "starting") {
    return waitForReady(serverState);
  }

  // Check if a server is already running on the port (survives HMR / state loss)
  const adopted = await tryAdoptExistingServer(port, abortController);
  abortController.signal.throwIfAborted();
  if (adopted) {
    serverState = adopted;
    startHealthChecks();
    return adopted;
  }

  const spawnPort = (await isPortAvailable(port)) ? port : 0;
  abortController.signal.throwIfAborted();

  const binary = findOpenCodeBinary();

  const args = ["serve", `--hostname=127.0.0.1`, `--port=${spawnPort}`];

  const proc = spawn(binary, args, {
    signal: abortController.signal,
    env: {
      ...process.env,
      OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX:
        process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX ??
        DEFAULT_OUTPUT_TOKEN_MAX,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const state: ServerState = {
    process: proc,
    url: "",
    port: spawnPort,
    pid: proc.pid ?? null,
    status: "starting",
    abortController,
    lastActivity: Date.now(),
  };

  serverState = state;

  try {
    const url = await waitForServerUrl(proc, STARTUP_TIMEOUT_MS);
    state.url = url;
    state.port = Number(new URL(url).port);
    state.status = "ready";
    state.lastActivity = Date.now();

    proc.on("exit", (code, signal) => {
      console.error("[opencode] Server exited", {
        code,
        signal,
        pid: state.pid,
      });
      state.status = "stopped";
      clearSharedServerState(state);
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
    const checkedState = serverState;
    if (!checkedState || checkedState.status !== "ready") {
      stopHealthChecks();
      return;
    }

    try {
      const response = await fetch(`${checkedState.url}/global/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (serverState !== checkedState) return;
      if (!response.ok) {
        throw new Error(`Health check returned ${response.status}`);
      }
      checkedState.lastActivity = Date.now();
    } catch (error) {
      if (serverState !== checkedState) return;
      const message = error instanceof Error ? error.message : String(error);
      // A busy server answers health checks slowly but still accepts
      // connections, and stopping it would abort every running session.
      const hasStopped = await hasStoppedListening(checkedState.url);
      if (serverState !== checkedState) return;
      if (!hasStopped) {
        console.warn(
          "[opencode] Health check failed; server still accepts connections, keeping it",
          { message, pid: checkedState.pid },
        );
        return;
      }
      console.error(
        "[opencode] Health check failed and server stopped accepting connections",
        { message, pid: checkedState.pid },
      );
      if (checkedState.process) {
        checkedState.abortController.abort();
        checkedState.process.kill();
      }
      clearSharedServerState(checkedState);
      checkedState.status = "stopped";
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

function handOutServer(state: ServerState): { url: string; port: number } {
  serverState = state;
  state.lastActivity = Date.now();
  return { url: state.url, port: state.port };
}

// Adopted servers have no exit event, so without this a server that died
// (for example one adopted from a dev server that was shutting down) was only
// dropped by the next health check, up to 30 seconds later.
function forgetStoppedServer(
  sharedServer: SharedServer,
  state: ServerState,
): void {
  if (getSharedServer() !== sharedServer) return;
  console.warn("[opencode] Server stopped accepting connections", {
    url: state.url,
    pid: state.pid,
  });
  clearSharedServer(sharedServer);
  state.status = "stopped";
  if (serverState === state) {
    serverState = null;
    stopHealthChecks();
  }
}

export async function getOrStartServer(): Promise<{
  url: string;
  port: number;
}> {
  const sharedServer = getSharedServer();
  if (sharedServer) {
    const state = await sharedServer.startPromise;
    if (!(await hasStoppedListening(state.url))) return handOutServer(state);
    forgetStoppedServer(sharedServer, state);
    // Another request may already have started the replacement.
    const replacement = getSharedServer();
    if (replacement) return handOutServer(await replacement.startPromise);
  }

  const serverLifecycle = createSharedServer((abortController) =>
    startServer(abortController),
  );
  setSharedServer(serverLifecycle);
  let state: ServerState;
  try {
    state = await serverLifecycle.startPromise;
  } catch (error) {
    clearSharedServer(serverLifecycle);
    throw error;
  }
  markSharedServerReady(serverLifecycle, state);
  state.lastActivity = Date.now();
  return { url: state.url, port: state.port };
}

export function stopServer() {
  stopHealthChecks();
  const sharedServer = getSharedServer();
  sharedServer?.abortController.abort();
  clearSharedServer(sharedServer);
  const state = sharedServer?.state ?? serverState;
  if (state) {
    if (state.process) {
      state.abortController.abort();
      state.process.kill();
    }
    state.status = "stopped";
    if (serverState === state) {
      serverState = null;
    }
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
