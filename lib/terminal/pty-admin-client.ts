import {
  createTerminalToken,
  TERMINAL_ADMIN_SCOPE,
  TERMINAL_ADMIN_TOKEN_TTL_MS,
} from "./terminal-auth";
import type { TerminalSessionInfo } from "./terminal-protocol";

const DEFAULT_PTY_PORT = 7600;

function ptyServerUrl(path: string): string {
  const port = parseInt(
    process.env.PTY_SERVER_PORT ?? String(DEFAULT_PTY_PORT),
    10,
  );
  return `http://127.0.0.1:${port}${path}`;
}

function sessionPath(workspaceId: string, sessionId: string): string {
  return `/sessions/${encodeURIComponent(workspaceId)}/${encodeURIComponent(sessionId)}`;
}

async function requestPtyServer(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = createTerminalToken(
    TERMINAL_ADMIN_SCOPE,
    TERMINAL_ADMIN_TOKEN_TTL_MS,
  );
  return fetch(ptyServerUrl(path), {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
}

export async function listPtySessions(): Promise<TerminalSessionInfo[]> {
  const res = await requestPtyServer("/sessions");
  if (!res.ok) throw new Error(`PTY server returned ${res.status}`);
  const body = (await res.json()) as { sessions?: TerminalSessionInfo[] };
  return Array.isArray(body.sessions) ? body.sessions : [];
}

export async function setPtySessionPinned(
  workspaceId: string,
  sessionId: string,
  isPinned: boolean,
): Promise<TerminalSessionInfo | null> {
  const res = await requestPtyServer(sessionPath(workspaceId, sessionId), {
    method: "PATCH",
    body: JSON.stringify({ isPinned }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`PTY server returned ${res.status}`);
  const body = (await res.json()) as { session: TerminalSessionInfo };
  return body.session;
}

export async function endPtySession(
  workspaceId: string,
  sessionId: string,
): Promise<boolean> {
  const res = await requestPtyServer(sessionPath(workspaceId, sessionId), {
    method: "DELETE",
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`PTY server returned ${res.status}`);
  return true;
}
