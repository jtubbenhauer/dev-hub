import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq, and, inArray } from "drizzle-orm"
import { getBackend, toWorkspace } from "@/lib/workspaces/backend"

export const maxDuration = 300

interface UpstreamTarget {
  workspaceId: string
  url: string
}

async function resolveTargets(
  workspaceIds: string[],
  userId: string
): Promise<UpstreamTarget[]> {
  if (workspaceIds.length === 0) return []

  const rows = await db
    .select()
    .from(workspaces)
    .where(and(inArray(workspaces.id, workspaceIds), eq(workspaces.userId, userId)))

  const targets: UpstreamTarget[] = []
  for (const row of rows) {
    try {
      const workspace = toWorkspace(row)
      const backend = getBackend(workspace)
      const serverUrl = await backend.getOpenCodeUrl()
      const eventUrl = new URL("/event", serverUrl)
      if (workspace.backend !== "remote") {
        eventUrl.searchParams.set("directory", workspace.path)
      }
      targets.push({ workspaceId: row.id, url: eventUrl.toString() })
    } catch {
      continue
    }
  }
  return targets
}

function readUpstream(
  target: UpstreamTarget,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  signal: AbortSignal
) {
  ;(async () => {
    try {
      const response = await fetch(target.url, {
        headers: { accept: "text/event-stream" },
        signal,
      })
      if (!response.body) return

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (!signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        for (
          let idx = buffer.indexOf("\n\n");
          idx !== -1;
          idx = buffer.indexOf("\n\n")
        ) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)

          for (const line of block.split("\n")) {
            if (line.startsWith("data:")) {
              const data = line.slice(5).trimStart()
              try {
                const event = JSON.parse(data)
                const wrapped = JSON.stringify({
                  workspaceId: target.workspaceId,
                  event,
                })
                controller.enqueue(encoder.encode(`data: ${wrapped}\n\n`))
              } catch {
                continue
              }
            }
          }
        }
      }
    } catch (err) {
      if (!signal.aborted) {
        console.error(
          `[sse-mux] Upstream disconnected for workspace ${target.workspaceId}:`,
          err instanceof Error ? err.message : err
        )
      }
    }
  })()
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const workspaceIdsParam = url.searchParams.get("workspaceIds")
  if (!workspaceIdsParam) {
    return NextResponse.json(
      { error: "workspaceIds query param required" },
      { status: 400 }
    )
  }

  const workspaceIds = workspaceIdsParam.split(",").filter(Boolean)
  const targets = await resolveTargets(workspaceIds, session.user.id)

  const abortController = new AbortController()
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const target of targets) {
        readUpstream(target, controller, encoder, abortController.signal)
      }
    },
    cancel() {
      abortController.abort()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  })
}
