import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces, commandHistory } from "@/drizzle/schema"
import { eq } from "drizzle-orm"
import {
  spawnProcess,
  subscribe,
  getOutputBuffer,
  getProcess,
} from "@/lib/commands/process-manager"
import type { RunCommandRequest } from "@/lib/commands/types"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: RunCommandRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { command, workspaceId } = body
  if (!command || !workspaceId) {
    return NextResponse.json(
      { error: "command and workspaceId are required" },
      { status: 400 }
    )
  }

  const [workspace] = await db
    .select({ path: workspaces.path, userId: workspaces.userId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1)

  if (!workspace || workspace.userId !== session.user.id) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  const sessionId = crypto.randomUUID()

  spawnProcess(sessionId, command, workspace.path, workspaceId)

  const managed = getProcess(sessionId)
  if (!managed) {
    return NextResponse.json(
      { error: "Failed to spawn process" },
      { status: 500 }
    )
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Send the sessionId so the client can reference it for kill/reconnect
      controller.enqueue(
        encoder.encode(`event: session\ndata: ${JSON.stringify({ sessionId })}\n\n`)
      )

      // Replay buffered output for reconnection support
      const buffer = getOutputBuffer(sessionId)
      for (const chunk of buffer) {
        controller.enqueue(
          encoder.encode(`event: data\ndata: ${JSON.stringify({ data: chunk })}\n\n`)
        )
      }

      // If the process already exited before we subscribed, send the exit event
      if (managed.exited) {
        controller.enqueue(
          encoder.encode(
            `event: exit\ndata: ${JSON.stringify({ exitCode: managed.exitCode })}\n\n`
          )
        )
        controller.close()
        return
      }

      const unsubscribe = subscribe(sessionId, (event) => {
        try {
          controller.enqueue(encoder.encode(event))

          // Close the stream after exit/error events
          if (event.startsWith("event: exit") || event.startsWith("event: error")) {
            recordToHistory(workspaceId, command, managed.exitCode)
            unsubscribe?.()
            controller.close()
          }
        } catch {
          unsubscribe?.()
        }
      })

      // Clean up if the client disconnects
      request.signal.addEventListener("abort", () => {
        unsubscribe?.()
      })
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-session-id": sessionId,
    },
  })
}

async function recordToHistory(
  workspaceId: string,
  command: string,
  exitCode: number | null
): Promise<void> {
  try {
    await db.insert(commandHistory).values({ workspaceId, command, exitCode })
  } catch (err) {
    console.error("[commands/run] Failed to record command history:", err)
  }
}

export const maxDuration = 300
