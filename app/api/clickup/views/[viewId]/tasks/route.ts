import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { settings } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import type { ClickUpTask } from "@/types"

const CLICKUP_API_BASE = "https://api.clickup.com/api/v2"

interface ViewTasksResponse {
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ viewId: string }> }
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const token = await getSetting(session.user.id, "clickup-api-token")
  if (!token) {
    return NextResponse.json({ error: "ClickUp not configured" }, { status: 422 })
  }

  const { viewId } = await params
  const page = request.nextUrl.searchParams.get("page") ?? "0"

  const url = new URL(`${CLICKUP_API_BASE}/view/${viewId}/task`)
  url.searchParams.set("page", page)

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

    const data = (await upstream.json()) as ViewTasksResponse
    return NextResponse.json({ tasks: data.tasks ?? [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed"
    console.error(`[clickup] view tasks fetch failed (${viewId}): ${message}`)
    return NextResponse.json({ error: "Failed to fetch view tasks", detail: message }, { status: 502 })
  }
}
