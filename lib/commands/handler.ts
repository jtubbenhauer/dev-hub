import type { WebSocket } from "ws"
import { parse } from "node:url"
import { spawnCommand, killSession } from "./runner"
import { recordCommand } from "./autocomplete"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq } from "drizzle-orm"
import type { ClientMessage, ServerMessage } from "./types"

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

async function resolveWorkspacePath(workspaceId: string): Promise<string | null> {
  const [workspace] = await db
    .select({ path: workspaces.path })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)

  return workspace?.path ?? null
}

export function handleCommandWebSocket(ws: WebSocket, req: import("node:http").IncomingMessage): void {
  const { query } = parse(req.url || "", true)
  const defaultWorkspaceId = typeof query.workspaceId === "string" ? query.workspaceId : ""

  ws.on("message", async (raw) => {
    let message: ClientMessage

    try {
      message = JSON.parse(raw.toString()) as ClientMessage
    } catch {
      return
    }

    switch (message.type) {
      case "run": {
        const { sessionId, command, workspaceId, cols = 120, rows = 30 } = message
        const resolvedWorkspaceId = workspaceId || defaultWorkspaceId

        const workspacePath = resolvedWorkspaceId
          ? await resolveWorkspacePath(resolvedWorkspaceId)
          : null

        const cwd = workspacePath ?? process.cwd()

        try {
          const session = spawnCommand(sessionId, command, cwd, cols, rows)

          send(ws, { type: "started", sessionId, pid: session.pid })

          session.on("data", (data) => {
            send(ws, { type: "data", sessionId, data: data as string })
          })

          session.on("exit", async (exitCode) => {
            const code = (exitCode as number | null) ?? null
            send(ws, { type: "exit", sessionId, exitCode: code })

            if (resolvedWorkspaceId) {
              try {
                await recordCommand(resolvedWorkspaceId, command, code)
              } catch {
                // History recording is best-effort
              }
            }
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to start command"
          send(ws, { type: "error", sessionId, message })
        }
        break
      }

      case "kill": {
        killSession(message.sessionId)
        break
      }

      case "resize": {
        const { sessionId, cols, rows } = message
        // Dynamically import to avoid loading session map here
        const { getSession } = await import("./runner")
        const session = getSession(sessionId)
        session?.resize(cols, rows)
        break
      }
    }
  })

  ws.on("close", () => {
    // Sessions are long-lived — don't kill on disconnect so user can reconnect
    // If you want auto-kill on disconnect, call killSession for each tracked sessionId
  })
}
