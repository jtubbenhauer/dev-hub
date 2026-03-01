import * as pty from "node-pty"
import { EventEmitter } from "node:events"
import os from "node:os"

export interface CommandSession {
  id: string
  workspaceId: string
  command: string
  cwd: string
  pid: number
  kill: () => void
  on: (event: "data" | "exit", listener: (...args: unknown[]) => void) => void
  off: (event: "data" | "exit", listener: (...args: unknown[]) => void) => void
  resize: (cols: number, rows: number) => void
}

const shell = os.platform() === "win32" ? "cmd.exe" : (process.env.SHELL || "/bin/bash")

// Active sessions keyed by session ID
const activeSessions = new Map<string, { ptyProcess: pty.IPty; emitter: EventEmitter }>()

export function spawnCommand(
  sessionId: string,
  command: string,
  cwd: string,
  cols = 120,
  rows = 30
): CommandSession {
  const emitter = new EventEmitter()

  const ptyProcess = pty.spawn(shell, ["-c", command], {
    name: "xterm-color",
    cols,
    rows,
    cwd,
    env: { ...process.env } as Record<string, string>,
  })

  ptyProcess.onData((data) => emitter.emit("data", data))
  ptyProcess.onExit(({ exitCode }) => {
    emitter.emit("exit", exitCode)
    activeSessions.delete(sessionId)
  })

  activeSessions.set(sessionId, { ptyProcess, emitter })

  return {
    id: sessionId,
    workspaceId: "",
    command,
    cwd,
    pid: ptyProcess.pid,
    kill: () => {
      ptyProcess.kill()
      activeSessions.delete(sessionId)
    },
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    resize: (c, r) => ptyProcess.resize(c, r),
  }
}

export function getSession(sessionId: string): CommandSession | null {
  const entry = activeSessions.get(sessionId)
  if (!entry) return null

  const { ptyProcess, emitter } = entry
  return {
    id: sessionId,
    workspaceId: "",
    command: "",
    cwd: "",
    pid: ptyProcess.pid,
    kill: () => {
      ptyProcess.kill()
      activeSessions.delete(sessionId)
    },
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    resize: (c, r) => ptyProcess.resize(c, r),
  }
}

export function killSession(sessionId: string): void {
  const entry = activeSessions.get(sessionId)
  if (entry) {
    entry.ptyProcess.kill()
    activeSessions.delete(sessionId)
  }
}
