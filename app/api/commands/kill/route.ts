import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { killProcess, getProcess } from "@/lib/commands/process-manager"
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

  const { sessionId } = body
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 }
    )
  }

  const managed = getProcess(sessionId)
  if (!managed) {
    return NextResponse.json({ error: "Process not found" }, { status: 404 })
  }

  const killed = killProcess(sessionId)
  return NextResponse.json({ killed, sessionId })
}
