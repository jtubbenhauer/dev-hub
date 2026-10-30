import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { IPty } from "node-pty";
import { WebSocket } from "ws";
import { TerminalMirror } from "./terminal-mirror";
import {
  parseClientMessage,
  SESSION_ENDED_CLOSE_CODE,
  SESSION_REPLACED_CLOSE_CODE,
  terminalSessionKey,
  type TerminalFinishedCommand,
  type TerminalServerMessage,
  type TerminalSessionInfo,
} from "./terminal-protocol";

const MAX_NVIM_SESSIONS = 1;
const SHELL_NAME_LEARN_DELAY_MS = 500;
const EXITED_SESSION_RETENTION_MS = 30_000;

export interface PtySession {
  key: string;
  workspaceId: string;
  sessionId: string;
  pty: IPty;
  mirror: TerminalMirror;
  ws: WebSocket | null;
  isReplaying: boolean;
  pendingLiveOutput: string[];
  hasExited: boolean;
  exitCode: number | null;
  createdAt: number;
  lastOutputAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  idleExpiresAt: number | null;
  idleTtlMs: number | null;
  isPinned: boolean;
  shellCommand: string | null;
  cwd: string;
  isTrackingCommands: boolean;
  shellProcessName: string | null;
  runningCommand: string | null;
  commandStartedAt: number | null;
  lastFinishedCommand: TerminalFinishedCommand | null;
}

export interface CreateSessionOptions {
  workspaceId: string;
  sessionId: string;
  cols: number;
  rows: number;
  cwd: string;
  shellCommand: string | null;
  scrollback: number;
  envOverrides?: Record<string, string>;
  idleTtlMs: number | null;
}

const sessions = new Map<string, PtySession>();

const STANDARD_PATH_DIRS = [
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
];

function getShell(): string {
  return process.env.SHELL || "/bin/zsh";
}

export function buildEnv(
  overrides?: Record<string, string>,
): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  env.TERM = "xterm-256color";
  // xterm.js renders 24-bit colour; advertise it so CLIs stop downgrading.
  env.COLORTERM = "truecolor";
  // BSD ls (macOS) only colours output when CLICOLOR is set.
  env.CLICOLOR = "1";

  const pathDirs = (env.PATH || "").split(":");
  for (const dir of STANDARD_PATH_DIRS) {
    if (!pathDirs.includes(dir)) pathDirs.push(dir);
  }
  env.PATH = pathDirs.join(":");

  if (overrides) Object.assign(env, overrides);
  return env;
}

export function resolveValidCwd(requested: string): string {
  if (existsSync(requested)) return requested;
  return process.env.HOME || "/";
}

function splitShellCommand(shellCommand: string): {
  file: string;
  args: string[];
} {
  const parts = shellCommand.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [
    shellCommand,
  ];
  return {
    file: parts[0],
    args: parts.slice(1).map((arg) => arg.replace(/^["']|["']$/g, "")),
  };
}

function spawnPty(options: CreateSessionOptions): IPty {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePty = require("node-pty") as typeof import("node-pty");
  const { file, args } = options.shellCommand
    ? splitShellCommand(options.shellCommand)
    : { file: getShell(), args: [] };
  return nodePty.spawn(file, args, {
    name: "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: buildEnv(options.envOverrides),
  });
}

function isNvimCommand(shellCommand: string | null): boolean {
  return shellCommand?.startsWith("nvim") ?? false;
}

function normalizeProcessName(name: string): string {
  return basename(name).replace(/^-/, "");
}

function sendControl(ws: WebSocket, message: TerminalServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function sendOutput(ws: WebSocket, data: string): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(data, "utf8"));
}

function clearIdleTimer(session: PtySession): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = null;
  session.idleExpiresAt = null;
}

function scheduleIdleEnd(session: PtySession): void {
  clearIdleTimer(session);
  if (
    session.ws ||
    session.hasExited ||
    session.isPinned ||
    session.idleTtlMs === null
  )
    return;
  session.idleExpiresAt = Date.now() + session.idleTtlMs;
  session.idleTimer = setTimeout(() => {
    if (!session.ws) endSession(session.key);
  }, session.idleTtlMs);
}

function evictNvimSessionsIfNeeded(): void {
  const liveNvimSessions = [...sessions.values()]
    .filter(
      (session) => isNvimCommand(session.shellCommand) && !session.hasExited,
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  if (liveNvimSessions.length < MAX_NVIM_SESSIONS) return;
  const victim =
    liveNvimSessions.find((session) => !session.ws) ?? liveNvimSessions[0];
  endSession(victim.key);
}

function handleSocketMessage(
  session: PtySession,
  raw: Buffer,
  isBinary: boolean,
): void {
  if (isBinary) {
    session.pty.write(raw.toString("utf8"));
    return;
  }
  const message = parseClientMessage(raw.toString("utf8"));
  if (message?.type === "resize") {
    session.pty.resize(message.cols, message.rows);
    session.mirror.resize(message.cols, message.rows);
  } else if (message?.type === "clear") {
    session.mirror.clear();
  }
}

export function getSession(
  workspaceId: string,
  sessionId: string,
): PtySession | undefined {
  return sessions.get(terminalSessionKey(workspaceId, sessionId));
}

export function createSession(options: CreateSessionOptions): PtySession {
  if (isNvimCommand(options.shellCommand)) evictNvimSessionsIfNeeded();

  const key = terminalSessionKey(options.workspaceId, options.sessionId);
  const pty = spawnPty(options);
  const now = Date.now();
  const session: PtySession = {
    key,
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
    pty,
    mirror: new TerminalMirror(options.cols, options.rows, options.scrollback),
    ws: null,
    isReplaying: false,
    pendingLiveOutput: [],
    hasExited: false,
    exitCode: null,
    createdAt: now,
    lastOutputAt: now,
    idleTimer: null,
    idleExpiresAt: null,
    idleTtlMs: options.idleTtlMs,
    isPinned: false,
    shellCommand: options.shellCommand,
    cwd: options.cwd,
    isTrackingCommands: !options.shellCommand,
    shellProcessName: null,
    runningCommand: null,
    commandStartedAt: null,
    lastFinishedCommand: null,
  };

  pty.onData((data) => {
    session.mirror.write(data);
    session.lastOutputAt = Date.now();
    if (!session.ws) return;
    if (session.isReplaying) session.pendingLiveOutput.push(data);
    else sendOutput(session.ws, data);
  });

  pty.onExit(({ exitCode }) => {
    session.hasExited = true;
    session.exitCode = exitCode;
    session.runningCommand = null;
    clearIdleTimer(session);
    if (session.ws) {
      sendControl(session.ws, { type: "exit", exitCode });
      session.ws.close(1000);
      session.ws = null;
    }
    setTimeout(() => {
      if (sessions.get(key) === session) removeSession(session);
    }, EXITED_SESSION_RETENTION_MS).unref?.();
  });

  sessions.set(key, session);
  return session;
}

// Live output that arrives while the snapshot is being built is queued, then
// flushed after it, so the client sees every byte exactly once and in order.
export function attachSocket(
  session: PtySession,
  ws: WebSocket,
  cols: number,
  rows: number,
): void {
  const previousSocket = session.ws;
  session.ws = ws;
  if (previousSocket && previousSocket.readyState === WebSocket.OPEN) {
    previousSocket.close(
      SESSION_REPLACED_CLOSE_CODE,
      "Session opened elsewhere",
    );
  }
  clearIdleTimer(session);

  session.pty.resize(cols, rows);
  session.mirror.resize(cols, rows);
  session.isReplaying = true;
  session.pendingLiveOutput = [];
  void session.mirror.snapshot().then((snapshot) => {
    if (session.ws !== ws) return;
    sendOutput(ws, snapshot);
    for (const chunk of session.pendingLiveOutput) sendOutput(ws, chunk);
    session.pendingLiveOutput = [];
    session.isReplaying = false;
  });

  ws.on("message", (raw: Buffer, isBinary: boolean) => {
    if (session.ws === ws) handleSocketMessage(session, raw, isBinary);
  });

  const detach = () => {
    if (session.ws !== ws) return;
    session.ws = null;
    session.isReplaying = false;
    session.pendingLiveOutput = [];
    scheduleIdleEnd(session);
  };
  ws.on("close", detach);
  ws.on("error", detach);
}

function removeSession(session: PtySession): void {
  clearIdleTimer(session);
  session.mirror.dispose();
  sessions.delete(session.key);
}

export function endSession(key: string): boolean {
  const session = sessions.get(key);
  if (!session) return false;
  const ws = session.ws;
  session.ws = null;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close(SESSION_ENDED_CLOSE_CODE, "Session ended");
  }
  if (!session.hasExited) session.pty.kill();
  removeSession(session);
  return true;
}

export function endAllSessions(): void {
  for (const key of [...sessions.keys()]) endSession(key);
}

export function setSessionPinned(
  key: string,
  isPinned: boolean,
): PtySession | null {
  const session = sessions.get(key);
  if (!session) return null;
  session.isPinned = isPinned;
  scheduleIdleEnd(session);
  return session;
}

export function setSessionIdleTtl(
  session: PtySession,
  idleTtlMs: number | null,
): void {
  session.idleTtlMs = idleTtlMs;
}

export function sessionCount(): number {
  return sessions.size;
}

export function toSessionInfo(session: PtySession): TerminalSessionInfo {
  return {
    workspaceId: session.workspaceId,
    sessionId: session.sessionId,
    kind: isNvimCommand(session.shellCommand) ? "editor" : "shell",
    isPinned: session.isPinned,
    isAttached: session.ws !== null,
    hasExited: session.hasExited,
    exitCode: session.exitCode,
    createdAt: session.createdAt,
    lastOutputAt: session.lastOutputAt,
    runningCommand: session.runningCommand,
    lastFinishedCommand: session.lastFinishedCommand,
    idleExpiresAt: session.idleExpiresAt,
  };
}

export function listSessionInfo(): TerminalSessionInfo[] {
  return [...sessions.values()].map(toSessionInfo);
}

function readForegroundProcess(pty: IPty): string | null {
  try {
    return normalizeProcessName(pty.process);
  } catch {
    return null;
  }
}

// Shell launchers exec into another name (macOS /bin/sh becomes "bash"), so the
// shell's name is learned once it has started. Seeing $SHELL's own name later
// corrects a guess taken while an early command was running.
function learnShellProcessName(
  session: PtySession,
  foreground: string,
  now: number,
): void {
  if (now - session.createdAt < SHELL_NAME_LEARN_DELAY_MS) return;
  if (
    session.shellProcessName === null ||
    foreground === normalizeProcessName(getShell())
  ) {
    session.shellProcessName = foreground;
  }
}

// node-pty reports the tty's foreground process. Anything other than the shell
// itself means a command is running; returning to the shell means it finished.
// Sessions started from a shellCommand (ssh, providers) are not tracked.
export function trackForegroundCommands(now: number = Date.now()): void {
  for (const session of sessions.values()) {
    if (session.hasExited || !session.isTrackingCommands) continue;
    const foreground = readForegroundProcess(session.pty);
    if (foreground === null) continue;
    learnShellProcessName(session, foreground, now);
    if (session.shellProcessName === null) continue;
    const isShellInForeground = foreground === session.shellProcessName;

    if (!isShellInForeground && session.runningCommand === null) {
      session.runningCommand = foreground;
      session.commandStartedAt = now;
    } else if (isShellInForeground && session.runningCommand !== null) {
      session.lastFinishedCommand = {
        name: session.runningCommand,
        durationMs: now - (session.commandStartedAt ?? now),
        finishedAt: now,
      };
      session.runningCommand = null;
      session.commandStartedAt = null;
    }
  }
}
