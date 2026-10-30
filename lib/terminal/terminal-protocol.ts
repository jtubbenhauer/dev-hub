// Binary frames carry PTY bytes; text frames carry JSON control messages only.

export const DEFAULT_TERMINAL_SESSION_ID = "default";
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 5;

export const SESSION_REPLACED_CLOSE_CODE = 4001;
export const SESSION_ENDED_CLOSE_CODE = 4002;
export const POLICY_VIOLATION_CLOSE_CODE = 1008;

export type TerminalSessionKind = "shell" | "editor";

export interface TerminalFinishedCommand {
  name: string;
  durationMs: number;
  finishedAt: number;
}

export interface TerminalSessionInfo {
  workspaceId: string;
  sessionId: string;
  kind: TerminalSessionKind;
  isPinned: boolean;
  isAttached: boolean;
  hasExited: boolean;
  exitCode: number | null;
  createdAt: number;
  lastOutputAt: number;
  runningCommand: string | null;
  lastFinishedCommand: TerminalFinishedCommand | null;
  idleExpiresAt: number | null;
}

export type TerminalServerMessage =
  | { type: "exit"; exitCode: number | null }
  | { type: "error"; data: string; isFatal: boolean };

export type TerminalClientMessage =
  | { type: "resize"; cols: number; rows: number }
  | { type: "clear" };

export function terminalSessionKey(
  workspaceId: string,
  sessionId: string,
): string {
  return `${workspaceId}:${sessionId}`;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseServerMessage(raw: string): TerminalServerMessage | null {
  const message = parseJsonObject(raw);
  if (!message) return null;
  if (message.type === "exit") {
    return {
      type: "exit",
      exitCode: typeof message.exitCode === "number" ? message.exitCode : null,
    };
  }
  if (message.type === "error") {
    return {
      type: "error",
      data: typeof message.data === "string" ? message.data : "Unknown error",
      isFatal: message.isFatal === true,
    };
  }
  return null;
}

function isTerminalDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 2000
  );
}

export function parseClientMessage(raw: string): TerminalClientMessage | null {
  const message = parseJsonObject(raw);
  if (!message) return null;
  if (
    message.type === "resize" &&
    isTerminalDimension(message.cols) &&
    isTerminalDimension(message.rows)
  ) {
    return { type: "resize", cols: message.cols, rows: message.rows };
  }
  if (message.type === "clear") return { type: "clear" };
  return null;
}

// "0" means never end a detached session; missing or invalid falls back to the default.
export function parseIdleTimeoutMs(raw: string | null): number | null {
  const minutes = raw === null ? NaN : Number(raw);
  if (minutes === 0) return null;
  const effectiveMinutes =
    Number.isFinite(minutes) && minutes > 0
      ? minutes
      : DEFAULT_IDLE_TIMEOUT_MINUTES;
  return effectiveMinutes * 60 * 1000;
}
