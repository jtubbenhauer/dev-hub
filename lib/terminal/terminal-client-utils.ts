import {
  SESSION_ENDED_CLOSE_CODE,
  SESSION_REPLACED_CLOSE_CODE,
} from "./terminal-protocol";

export const MAX_RECONNECT_ATTEMPTS = 8;
const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10_000;

export function reconnectDelayMs(attempt: number): number {
  return Math.min(
    BASE_RECONNECT_DELAY_MS * 2 ** attempt,
    MAX_RECONNECT_DELAY_MS,
  );
}

export type SocketCloseOutcome =
  | "replaced"
  | "ended"
  | "exited"
  | "fatal"
  | "reconnect"
  | "give-up";

export function classifySocketClose(options: {
  closeCode: number;
  hasExited: boolean;
  hasFatalError: boolean;
  attempt: number;
}): SocketCloseOutcome {
  if (options.hasExited) return "exited";
  if (options.hasFatalError) return "fatal";
  if (options.closeCode === SESSION_REPLACED_CLOSE_CODE) return "replaced";
  if (options.closeCode === SESSION_ENDED_CLOSE_CODE) return "ended";
  if (options.attempt >= MAX_RECONNECT_ATTEMPTS) return "give-up";
  return "reconnect";
}

export type TerminalShortcut = "search" | "clear" | null;

// Cmd on macOS; Ctrl+Shift elsewhere, because plain Ctrl+F/K are readline keys.
export function matchTerminalShortcut(
  event: KeyboardEvent,
  isMac: boolean,
): TerminalShortcut {
  if (event.type !== "keydown" || event.altKey) return null;
  const hasModifier = isMac
    ? event.metaKey && !event.ctrlKey && !event.shiftKey
    : event.ctrlKey && event.shiftKey && !event.metaKey;
  if (!hasModifier) return null;
  const key = event.key.toLowerCase();
  if (key === "f") return "search";
  if (key === "k") return "clear";
  return null;
}

export function isMacPlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  );
}
