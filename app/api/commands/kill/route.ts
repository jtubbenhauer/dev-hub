import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import { killProcess, getProcess } from "@/lib/commands/process-manager"
import { toWorkspace } from "@/lib/workspaces/backend"
import type { KillCommandRequest } from "@/lib/commands/types"

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: KillCommandRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { sessionId, workspaceId } = body
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 }
    )
  }

  if (workspaceId) {
    const [row] = await db
      .select()
      .from(workspaces)
      .where(
        and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id))
      )
      .limit(1)

    if (row) {
      const workspace = toWorkspace(row)
      if (workspace.backend === "remote" && workspace.agentUrl) {
        return proxyRemoteKill(workspace.agentUrl, sessionId)
      }
    }
  }

  const managed = getProcess(sessionId)
  if (!managed) {
    return NextResponse.json({ error: "Process not found" }, { status: 404 })
  }

  const killed = killProcess(sessionId)
  return NextResponse.json({ killed, sessionId })
}

async function proxyRemoteKill(
  agentUrl: string,
  sessionId: string
): Promise<NextResponse> {
  try {
    const url = new URL("/commands/kill", agentUrl)
    const agentResponse = await globalThis.fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })

    if (!agentResponse.ok) {
      const text = await agentResponse.text()
      return NextResponse.json(
        { error: `Agent error: ${text}` },
        { status: agentResponse.status }
      )
    }

    const result = await agentResponse.json()
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reach agent"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
