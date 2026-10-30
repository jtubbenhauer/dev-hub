import type { IncomingMessage, ServerResponse } from "node:http";
import { TERMINAL_ADMIN_SCOPE, verifyTerminalToken } from "./terminal-auth";
import {
  endSession,
  listSessionInfo,
  sessionCount,
  setSessionPinned,
  toSessionInfo,
} from "./pty-sessions";
import { terminalSessionKey } from "./terminal-protocol";

const MAX_BODY_BYTES = 4096;
const SESSION_PATH_RE = /^\/sessions\/([^/]+)\/([^/]+)$/;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function handleSessionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  key: string,
): Promise<void> {
  if (req.method === "DELETE") {
    const hasEnded = endSession(key);
    sendJson(res, hasEnded ? 200 : 404, { ended: hasEnded });
    return;
  }
  if (req.method === "PATCH") {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const isPinned = (body as { isPinned?: unknown }).isPinned;
    if (typeof isPinned !== "boolean") {
      sendJson(res, 400, { error: "isPinned must be a boolean" });
      return;
    }
    const session = setSessionPinned(key, isPinned);
    if (!session) {
      sendJson(res, 404, { error: "Session not found" });
      return;
    }
    sendJson(res, 200, { session: toSessionInfo(session) });
    return;
  }
  sendJson(res, 405, { error: "Method not allowed" });
}

export function handlePtyHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

  if (path === "/" || path === "/health") {
    sendJson(res, 200, { status: "ok", sessions: sessionCount() });
    return;
  }

  if (!verifyTerminalToken(readBearerToken(req), TERMINAL_ADMIN_SCOPE)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  if (path === "/sessions" && req.method === "GET") {
    sendJson(res, 200, { sessions: listSessionInfo() });
    return;
  }

  const match = SESSION_PATH_RE.exec(path);
  if (match) {
    const key = terminalSessionKey(
      decodeURIComponent(match[1]),
      decodeURIComponent(match[2]),
    );
    void handleSessionRoute(req, res, key);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}
