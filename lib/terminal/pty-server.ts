import { createServer, type IncomingMessage, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  isAllowedTerminalOrigin,
  terminalSocketScope,
  verifyTerminalToken,
} from "./terminal-auth";
import { handlePtyHttpRequest } from "./pty-admin-routes";
import {
  attachSocket,
  createSession,
  endAllSessions,
  getSession,
  resolveValidCwd,
  setSessionIdleTtl,
  trackForegroundCommands,
} from "./pty-sessions";
import {
  DEFAULT_TERMINAL_SESSION_ID,
  parseIdleTimeoutMs,
  POLICY_VIOLATION_CLOSE_CODE,
  type TerminalServerMessage,
} from "./terminal-protocol";

const DEFAULT_PORT = 7600;
const HEARTBEAT_INTERVAL_MS = 30_000;
const FOREGROUND_POLL_INTERVAL_MS = 1_000;
const DEFAULT_SCROLLBACK = 5000;
const MAX_TERMINAL_DIMENSION = 2000;

let runningServer: PtyServerHandle | null = null;

export interface PtyServerHandle {
  httpServer: Server;
  wss: WebSocketServer;
  close: () => Promise<void>;
}

function parseQuery(url: string | undefined): URLSearchParams {
  if (!url) return new URLSearchParams();
  const idx = url.indexOf("?");
  if (idx === -1) return new URLSearchParams();
  return new URLSearchParams(url.slice(idx + 1));
}

function parseDimension(raw: string | null, fallback: number): number {
  const value = parseInt(raw ?? "", 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, MAX_TERMINAL_DIMENSION);
}

function parseEnvOverrides(
  params: URLSearchParams,
): Record<string, string> | undefined {
  const raw = params.get("env");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return undefined;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") result[k] = v;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

function rejectSocket(ws: WebSocket, message: string, closeCode: number) {
  const payload: TerminalServerMessage = {
    type: "error",
    data: message,
    isFatal: true,
  };
  ws.send(JSON.stringify(payload));
  ws.close(closeCode, message);
}

function handleConnection(ws: WebSocket, req: IncomingMessage) {
  if (!isAllowedTerminalOrigin(req.headers.origin)) {
    rejectSocket(ws, "Origin not allowed", POLICY_VIOLATION_CLOSE_CODE);
    return;
  }

  const params = parseQuery(req.url);
  const workspaceId = params.get("workspaceId");
  if (!workspaceId) {
    rejectSocket(ws, "workspaceId is required", POLICY_VIOLATION_CLOSE_CODE);
    return;
  }
  if (
    !verifyTerminalToken(params.get("token"), terminalSocketScope(workspaceId))
  ) {
    rejectSocket(
      ws,
      "Terminal token is missing or expired",
      POLICY_VIOLATION_CLOSE_CODE,
    );
    return;
  }

  const sessionId = params.get("sessionId") || DEFAULT_TERMINAL_SESSION_ID;
  const cols = parseDimension(params.get("cols"), 80);
  const rows = parseDimension(params.get("rows"), 24);
  const idleTtlMs = parseIdleTimeoutMs(params.get("idleTimeoutMinutes"));

  const existing = getSession(workspaceId, sessionId);
  if (existing && !existing.hasExited) {
    setSessionIdleTtl(existing, idleTtlMs);
    attachSocket(existing, ws, cols, rows);
    return;
  }

  let session;
  try {
    session = createSession({
      workspaceId,
      sessionId,
      cols,
      rows,
      cwd: resolveValidCwd(params.get("cwd") || process.env.HOME || "/"),
      shellCommand: params.get("shellCommand") || null,
      scrollback: parseDimension(params.get("scrollback"), DEFAULT_SCROLLBACK),
      envOverrides: parseEnvOverrides(params),
      idleTtlMs,
    });
  } catch (err) {
    rejectSocket(
      ws,
      err instanceof Error ? err.message : "Failed to spawn PTY",
      1011,
    );
    return;
  }
  attachSocket(session, ws, cols, rows);
}

export function createPtyServer(): PtyServerHandle {
  const httpServer = createServer(handlePtyHttpRequest);
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", handleConnection);

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  const foregroundPoll = setInterval(
    () => trackForegroundCommands(),
    FOREGROUND_POLL_INTERVAL_MS,
  );
  heartbeat.unref();
  foregroundPoll.unref();

  const close = async () => {
    clearInterval(heartbeat);
    clearInterval(foregroundPoll);
    endAllSessions();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  };

  return { httpServer, wss, close };
}

export function startPtyServer(): number {
  const port = parseInt(
    process.env.PTY_SERVER_PORT ?? String(DEFAULT_PORT),
    10,
  );

  if (runningServer) return port;
  const server = createPtyServer();
  runningServer = server;

  server.httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.log(
        `[terminal] Port ${port} in use — adopting existing PTY server`,
      );
      void server.close();
      runningServer = null;
      return;
    }
    throw err;
  });

  server.httpServer.listen(port, "127.0.0.1", () => {
    console.log(
      `[terminal] PTY WebSocket server listening on ws://127.0.0.1:${port}`,
    );
  });

  return port;
}
