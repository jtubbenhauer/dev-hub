import { createServer, type IncomingMessage } from "node:http"
import { existsSync } from "node:fs"
import { WebSocketServer, WebSocket } from "ws"
import type { IPty } from "node-pty"

const DEFAULT_PORT = 7600
const HEARTBEAT_INTERVAL_MS = 30_000

interface PtySession {
  pty: IPty
  ws: WebSocket
  createdAt: number
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

function handleConnection(ws: WebSocket, req: IncomingMessage) {
  const params = parseQuery(req.url)
  const cols = parseInt(params.get("cols") ?? "80", 10)
  const rows = parseInt(params.get("rows") ?? "24", 10)
  const cwd = resolveValidCwd(params.get("cwd") || process.env.HOME || "/")
  const shellCommand = params.get("shellCommand") || null
  const env = buildEnv()

  let pty: IPty
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePty = require("node-pty") as typeof import("node-pty")

    if (shellCommand) {
      const parts = shellCommand.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [shellCommand]
      const file = parts[0]
      const args = parts.slice(1).map((a: string) => a.replace(/^["']|["']$/g, ""))
      pty = nodePty.spawn(file, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      })
    } else {
      const shell = getShell()
      pty = nodePty.spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to spawn PTY"
    ws.send(JSON.stringify({ type: "error", data: message }))
    ws.close()
    return
  }

  const sessionId = crypto.randomUUID()
  sessions.set(sessionId, { pty, ws, createdAt: Date.now() })

  pty.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data)
    }
  })

  pty.onExit(({ exitCode }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode }))
      ws.close()
    }
    sessions.delete(sessionId)
  })

  ws.on("message", (raw: Buffer | string) => {
    const str = typeof raw === "string" ? raw : raw.toString()
    try {
      if (str.startsWith("{")) {
        const parsed = JSON.parse(str) as { type: string; cols?: number; rows?: number }
        if (parsed.type === "resize" && parsed.cols && parsed.rows) {
          pty.resize(parsed.cols, parsed.rows)
          return
        }
      }
      pty.write(str)
    } catch {
      pty.write(str)
    }
  })

  ws.on("close", () => {
    pty.kill()
    sessions.delete(sessionId)
  })

  ws.on("error", () => {
    pty.kill()
    sessions.delete(sessionId)
  })
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
    session.pty.kill()
    session.ws.close()
    sessions.delete(id)
  }
  wss?.close()
  httpServer?.close()
  wss = null
  httpServer = null
}
