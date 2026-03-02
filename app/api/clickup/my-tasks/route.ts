import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { settings } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import type { ClickUpTask } from "@/types"

const CLICKUP_API_BASE = "https://api.clickup.com/api/v2"

interface ClickUpTasksResponse {
  tasks: ClickUpTask[]
}

async function getSetting(userId: string, key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, key)))
  const value = row?.value
  return typeof value === "string" && value.length > 0 ? value : null
}

export async function GET(): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [token, teamId, userId] = await Promise.all([
    getSetting(session.user.id, "clickup-api-token"),
    getSetting(session.user.id, "clickup-team-id"),
    getSetting(session.user.id, "clickup-user-id"),
  ])

  if (!token || !teamId) {
    return NextResponse.json({ error: "ClickUp not configured" }, { status: 422 })
  }

  const url = new URL(`${CLICKUP_API_BASE}/team/${teamId}/task`)
  url.searchParams.set("order_by", "updated")
  url.searchParams.set("reverse", "false")
  url.searchParams.set("page", "0")
  url.searchParams.set("include_closed", "false")
  if (userId) url.searchParams.append("assignees[]", userId)

  try {
    const upstream = await fetch(url.toString(), {
      headers: { Authorization: token },
      next: { revalidate: 60 },
    })

    if (!upstream.ok) {
      const body: unknown = await upstream.json().catch(() => ({}))
      return NextResponse.json(
        { error: "ClickUp API error", detail: body },
        { status: upstream.status }
      )
    }

    const data = (await upstream.json()) as ClickUpTasksResponse
    return NextResponse.json({ tasks: data.tasks ?? [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed"
    console.error(`[clickup] my-tasks fetch failed: ${message}`)
    return NextResponse.json({ error: "Failed to fetch tasks", detail: message }, { status: 502 })
  }
}
