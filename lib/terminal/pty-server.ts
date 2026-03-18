import { createServer, type IncomingMessage } from "node:http"
import { existsSync } from "node:fs"
import { WebSocketServer, WebSocket } from "ws"
import type { IPty } from "node-pty"

const DEFAULT_PORT = 7600
const HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_SCROLLBACK = 5000
const IDLE_TTL_MS = 5 * 60 * 1000

class OutputBuffer {
  private chunks: string[] = []
  private totalBytes = 0
  private maxBytes: number

  constructor(scrollbackLines: number) {
    this.maxBytes = scrollbackLines * 120
  }

  push(data: string) {
    this.chunks.push(data)
    this.totalBytes += data.length

    while (this.totalBytes > this.maxBytes && this.chunks.length > 1) {
      const removed = this.chunks.shift()!
      this.totalBytes -= removed.length
    }
  }

  getAll(): string {
    return this.chunks.join("")
  }

  clear() {
    this.chunks = []
    this.totalBytes = 0
  }
}

interface PtySession {
  pty: IPty
  buffer: OutputBuffer
  ws: WebSocket | null
  exited: boolean
  exitCode: number | null
  createdAt: number
  idleTimer: ReturnType<typeof setTimeout> | null
  shellCommand: string | null
  cwd: string
}

const sessions = new Map<string, PtySession>()
let wss: WebSocketServer | null = null
let httpServer: ReturnType<typeof createServer> | null = null

function getShell(): string {
  return process.env.SHELL || "/bin/zsh"
}

const STANDARD_PATH_DIRS = [
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
]

function buildEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>
  env.TERM = "xterm-256color"

  const existingPath = env.PATH || ""
  const pathDirs = existingPath.split(":")
  for (const dir of STANDARD_PATH_DIRS) {
    if (!pathDirs.includes(dir)) {
      pathDirs.push(dir)
    }
  }
  env.PATH = pathDirs.join(":")

  return env
}

function resolveValidCwd(requested: string): string {
  if (existsSync(requested)) return requested
  return process.env.HOME || "/"
}

function parseQuery(url: string | undefined): URLSearchParams {
  if (!url) return new URLSearchParams()
  const idx = url.indexOf("?")
  if (idx === -1) return new URLSearchParams()
  return new URLSearchParams(url.slice(idx + 1))
}

function startIdleTimer(workspaceId: string, session: PtySession) {
  if (session.idleTimer) clearTimeout(session.idleTimer)
  session.idleTimer = setTimeout(() => {
    if (session.ws) return
    session.pty.kill()
    sessions.delete(workspaceId)
  }, IDLE_TTL_MS)
}

function clearIdleTimer(session: PtySession) {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer)
    session.idleTimer = null
  }
}

function spawnPty(
  cwd: string,
  cols: number,
  rows: number,
  shellCommand: string | null,
): IPty {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePty = require("node-pty") as typeof import("node-pty")
  const env = buildEnv()

  if (shellCommand) {
    const parts = shellCommand.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [shellCommand]
    const file = parts[0]
    const args = parts.slice(1).map((a: string) => a.replace(/^["']|["']$/g, ""))
    return nodePty.spawn(file, args, { name: "xterm-256color", cols, rows, cwd, env })
  }

  return nodePty.spawn(getShell(), [], { name: "xterm-256color", cols, rows, cwd, env })
}

function attachWs(workspaceId: string, session: PtySession, ws: WebSocket) {
  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
    session.ws.close()
  }
  session.ws = ws
  clearIdleTimer(session)

  if (session.exited) {
    ws.send(JSON.stringify({ type: "exit", exitCode: session.exitCode }))
    ws.close()
    sessions.delete(workspaceId)
    return
  }

  ws.on("message", (raw: Buffer | string) => {
    const str = typeof raw === "string" ? raw : raw.toString()
    try {
      if (str.startsWith("{")) {
        const parsed = JSON.parse(str) as { type: string; cols?: number; rows?: number }
        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          session.pty.resize(parsed.cols, parsed.rows)
          return
        }
      }
      session.pty.write(str)
    } catch {
      session.pty.write(str)
    }
  })

  ws.on("close", () => {
    if (session.ws === ws) {
      session.ws = null
      if (!session.exited) {
        startIdleTimer(workspaceId, session)
      }
    }
  })

  ws.on("error", () => {
    if (session.ws === ws) {
      session.ws = null
      if (!session.exited) {
        startIdleTimer(workspaceId, session)
      }
    }
  })
}

function createSession(
  workspaceId: string,
  ws: WebSocket,
  cols: number,
  rows: number,
  cwd: string,
  shellCommand: string | null,
  scrollback: number,
): boolean {
  let pty: IPty
  try {
    pty = spawnPty(cwd, cols, rows, shellCommand)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to spawn PTY"
    ws.send(JSON.stringify({ type: "error", data: message }))
    ws.close()
    return false
  }

  const buffer = new OutputBuffer(scrollback)
  const session: PtySession = {
    pty,
    buffer,
    ws: null,
    exited: false,
    exitCode: null,
    createdAt: Date.now(),
    idleTimer: null,
    shellCommand,
    cwd,
  }

  pty.onData((data) => {
    buffer.push(data)
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(data)
    }
  })

  pty.onExit(({ exitCode }) => {
    session.exited = true
    session.exitCode = exitCode
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({ type: "exit", exitCode }))
      session.ws.close()
    }
    session.ws = null
    clearIdleTimer(session)
    setTimeout(() => {
      if (sessions.get(workspaceId) === session) {
        sessions.delete(workspaceId)
      }
    }, 30_000)
  })

  sessions.set(workspaceId, session)
  attachWs(workspaceId, session, ws)
  return true
}

function handleConnection(ws: WebSocket, req: IncomingMessage) {
  const params = parseQuery(req.url)
  const workspaceId = params.get("workspaceId")
  const cols = parseInt(params.get("cols") ?? "80", 10)
  const rows = parseInt(params.get("rows") ?? "24", 10)
  const cwd = resolveValidCwd(params.get("cwd") || process.env.HOME || "/")
  const shellCommand = params.get("shellCommand") || null
  const scrollback = parseInt(params.get("scrollback") ?? String(DEFAULT_SCROLLBACK), 10)

  if (!workspaceId) {
    ws.send(JSON.stringify({ type: "error", data: "workspaceId is required" }))
    ws.close()
    return
  }

  const existing = sessions.get(workspaceId)
  if (existing && !existing.exited) {
    existing.pty.resize(cols, rows)
    attachWs(workspaceId, existing, ws)
    return
  }

  createSession(workspaceId, ws, cols, rows, cwd, shellCommand, scrollback)
}

export function startPtyServer(): number {
  const port = parseInt(process.env.PTY_SERVER_PORT ?? String(DEFAULT_PORT), 10)

  if (wss) return port

  httpServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "ok", sessions: sessions.size }))
  })

  wss = new WebSocketServer({ server: httpServer })
  wss.on("connection", handleConnection)

  const heartbeat = setInterval(() => {
    if (!wss) return
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.ping()
      }
    }
  }, HEARTBEAT_INTERVAL_MS)

  wss.on("close", () => {
    clearInterval(heartbeat)
  })

  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`[terminal] PTY WebSocket server listening on ws://127.0.0.1:${port}`)
  })

  return port
}

export function stopPtyServer() {
  for (const [id, session] of sessions) {
    clearIdleTimer(session)
    session.pty.kill()
    session.ws?.close()
    sessions.delete(id)
  }
  wss?.close()
  httpServer?.close()
  wss = null
  httpServer = null
}
