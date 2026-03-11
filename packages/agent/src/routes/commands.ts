import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const OUTPUT_BUFFER_MAX_LINES = 500

interface ManagedProcess {
  process: ChildProcess
  command: string
  startedAt: number
  outputBuffer: string[]
  exitCode: number | null
  exited: boolean
  listeners: Set<(event: string) => void>
}

const processes = new Map<string, ManagedProcess>()

function formatSSEEvent(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
}

function spawnManagedProcess(
  sessionId: string,
  command: string,
  cwd: string
): ManagedProcess {
  const existing = processes.get(sessionId)
  if (existing && !existing.exited && existing.process.pid) {
    try {
      process.kill(-existing.process.pid, "SIGTERM")
    } catch {
      // already exited
    }
  }

  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "1", TERM: "xterm-256color" },
  })

  const managed: ManagedProcess = {
    process: child,
    command,
    startedAt: Date.now(),
    outputBuffer: [],
    exitCode: null,
    exited: false,
    listeners: new Set(),
  }

  processes.set(sessionId, managed)

  const pushOutput = (chunk: string) => {
    managed.outputBuffer.push(chunk)
    if (managed.outputBuffer.length > OUTPUT_BUFFER_MAX_LINES) {
      managed.outputBuffer.splice(0, managed.outputBuffer.length - OUTPUT_BUFFER_MAX_LINES)
    }
    const event = formatSSEEvent("data", { data: chunk })
    for (const listener of managed.listeners) {
      listener(event)
    }
  }

  child.stdout?.on("data", (buf: Buffer) => pushOutput(buf.toString()))
  child.stderr?.on("data", (buf: Buffer) => pushOutput(buf.toString()))

  child.on("error", (err) => {
    managed.exited = true
    const event = formatSSEEvent("error", { message: err.message })
    for (const listener of managed.listeners) {
      listener(event)
    }
  })

  child.on("close", (code) => {
    managed.exitCode = code
    managed.exited = true
    const event = formatSSEEvent("exit", { exitCode: code })
    for (const listener of managed.listeners) {
      listener(event)
    }
    setTimeout(() => processes.delete(sessionId), 60_000)
  })

  return managed
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(filePath, "utf-8")
  } catch {
    return null
  }
}

interface AutocompleteSuggestion {
  value: string
  label: string
  source: "alias" | "script" | "make" | "cargo"
}

async function parseShellAliases(): Promise<AutocompleteSuggestion[]> {
  const rcPaths = [
    path.join(os.homedir(), ".zshrc"),
    path.join(os.homedir(), ".bashrc"),
    path.join(os.homedir(), ".bash_aliases"),
  ]

  const suggestions: AutocompleteSuggestion[] = []
  const aliasPattern = /^alias\s+([^=]+)=['"](.+)['"]\s*$/

  for (const rcPath of rcPaths) {
    const content = await readFileOrNull(rcPath)
    if (!content) continue

    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      const match = trimmed.match(aliasPattern)
      if (match) {
        const [, name, command] = match
        suggestions.push({
          value: name.trim(),
          label: `${name.trim()} → ${command}`,
          source: "alias",
        })
      }
    }
  }

  return suggestions
}

async function parsePackageScripts(workspacePath: string): Promise<AutocompleteSuggestion[]> {
  const pkgPath = path.join(workspacePath, "package.json")
  const content = await readFileOrNull(pkgPath)
  if (!content) return []

  try {
    const pkg = JSON.parse(content) as { scripts?: Record<string, string> }
    if (!pkg.scripts) return []

    return Object.entries(pkg.scripts).map(([name, command]) => ({
      value: `npm run ${name}`,
      label: `npm run ${name} → ${command}`,
      source: "script" as const,
    }))
  } catch {
    return []
  }
}

async function parseMakeTargets(workspacePath: string): Promise<AutocompleteSuggestion[]> {
  const makefilePath = path.join(workspacePath, "Makefile")
  const content = await readFileOrNull(makefilePath)
  if (!content) return []

  const suggestions: AutocompleteSuggestion[] = []
  const targetPattern = /^([a-zA-Z0-9_-]+)\s*:/gm
  let match: RegExpExecArray | null

  while ((match = targetPattern.exec(content)) !== null) {
    const target = match[1]
    if (target && !target.startsWith(".")) {
      suggestions.push({
        value: `make ${target}`,
        label: `make ${target}`,
        source: "make",
      })
    }
  }

  return suggestions
}

async function parseCargoTargets(workspacePath: string): Promise<AutocompleteSuggestion[]> {
  const cargoPath = path.join(workspacePath, "Cargo.toml")
  const content = await readFileOrNull(cargoPath)
  if (!content) return []

  return [
    { value: "cargo build", label: "cargo build", source: "cargo" as const },
    { value: "cargo test", label: "cargo test", source: "cargo" as const },
    { value: "cargo run", label: "cargo run", source: "cargo" as const },
    { value: "cargo check", label: "cargo check", source: "cargo" as const },
    { value: "cargo clippy", label: "cargo clippy", source: "cargo" as const },
    { value: "cargo fmt", label: "cargo fmt", source: "cargo" as const },
  ]
}

export function commandRoutes(workspacePath: string): Hono {
  const app = new Hono()

  // POST /commands/run { command }
  // Returns SSE stream with session, data, exit, error events
  app.post("/run", async (c) => {
    const body = await c.req.json<{ command: string }>()
    if (!body.command) {
      return c.json({ error: "command is required" }, 400)
    }

    const sessionId = crypto.randomUUID()
    const managed = spawnManagedProcess(sessionId, body.command, workspacePath)

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "session", data: JSON.stringify({ sessionId }) })

      for (const chunk of managed.outputBuffer) {
        await stream.writeSSE({ event: "data", data: JSON.stringify({ data: chunk }) })
      }

      if (managed.exited) {
        await stream.writeSSE({ event: "exit", data: JSON.stringify({ exitCode: managed.exitCode }) })
        return
      }

      await new Promise<void>((resolve) => {
        const listener = (event: string) => {
          try {
            stream.write(event)
          } catch {
            managed.listeners.delete(listener)
            resolve()
            return
          }

          if (event.startsWith("event: exit") || event.startsWith("event: error")) {
            managed.listeners.delete(listener)
            resolve()
          }
        }

        managed.listeners.add(listener)

        c.req.raw.signal.addEventListener("abort", () => {
          managed.listeners.delete(listener)
          resolve()
        })
      })
    })
  })

  // POST /commands/kill { sessionId }
  app.post("/kill", async (c) => {
    const body = await c.req.json<{ sessionId: string }>()
    if (!body.sessionId) {
      return c.json({ error: "sessionId is required" }, 400)
    }

    const managed = processes.get(body.sessionId)
    if (!managed) {
      return c.json({ error: "Process not found" }, 404)
    }

    if (!managed.exited && managed.process.pid) {
      try {
        process.kill(-managed.process.pid, "SIGTERM")
      } catch {
        // already exited
      }
      setTimeout(() => {
        if (!managed.exited && managed.process.pid) {
          try {
            process.kill(-managed.process.pid, "SIGKILL")
          } catch {
            // already exited
          }
        }
      }, 3000)
    }

    return c.json({ killed: true, sessionId: body.sessionId })
  })

  // GET /commands/autocomplete?q=<query>
  app.get("/autocomplete", async (c) => {
    const query = c.req.query("q") ?? ""

    const [aliases, scripts, makeTargets, cargoTargets] = await Promise.all([
      parseShellAliases(),
      parsePackageScripts(workspacePath),
      parseMakeTargets(workspacePath),
      parseCargoTargets(workspacePath),
    ])

    const all: AutocompleteSuggestion[] = [
      ...aliases,
      ...scripts,
      ...makeTargets,
      ...cargoTargets,
    ]

    const seen = new Map<string, AutocompleteSuggestion>()
    for (const s of all) {
      if (!seen.has(s.value)) {
        seen.set(s.value, s)
      }
    }

    const filtered = Array.from(seen.values()).filter((s) =>
      s.value.toLowerCase().includes(query.toLowerCase())
    )

    const sourcePriority: Record<AutocompleteSuggestion["source"], number> = {
      script: 0,
      make: 1,
      cargo: 2,
      alias: 3,
    }

    filtered.sort((a, b) => sourcePriority[a.source] - sourcePriority[b.source])

    return c.json({ suggestions: filtered.slice(0, 20) })
  })

  return app
}
