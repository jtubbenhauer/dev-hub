import { NextRequest, NextResponse } from "next/server"
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

export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [token, teamId] = await Promise.all([
    getSetting(session.user.id, "clickup-api-token"),
    getSetting(session.user.id, "clickup-team-id"),
  ])

  if (!token || !teamId) {
    return NextResponse.json({ error: "ClickUp not configured" }, { status: 422 })
  }

  const searchParams = request.nextUrl.searchParams
  const url = new URL(`${CLICKUP_API_BASE}/team/${teamId}/task`)

  const query = searchParams.get("query")
  if (query) url.searchParams.set("name", query)

  const page = searchParams.get("page") ?? "0"
  url.searchParams.set("page", page)

  const includeClosed = searchParams.get("include_closed") ?? "false"
  url.searchParams.set("include_closed", includeClosed)

  // Forward multi-value filter params
  for (const key of ["list_ids[]", "space_ids[]", "statuses[]", "assignees[]", "tags[]"]) {
    for (const value of searchParams.getAll(key)) {
      url.searchParams.append(key, value)
    }
  }

  const orderBy = searchParams.get("order_by")
  if (orderBy) url.searchParams.set("order_by", orderBy)

  try {
    const upstream = await fetch(url.toString(), {
      headers: { Authorization: token },
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
    console.error(`[clickup] search fetch failed: ${message}`)
    return NextResponse.json({ error: "Failed to search tasks", detail: message }, { status: 502 })
  }
}
