import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import { getSuggestions } from "@/lib/commands/autocomplete"
import { toWorkspace } from "@/lib/workspaces/backend"
import type { AutocompleteSuggestion } from "@/lib/commands/types"

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = request.nextUrl
  const workspaceId = searchParams.get("workspaceId")
  const query = searchParams.get("q") ?? ""

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 })
  }

  const [row] = await db
    .select()
    .from(workspaces)
    .where(
      and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id))
    )
    .limit(1)

  if (!row) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  const workspace = toWorkspace(row)

  if (workspace.backend === "remote" && workspace.agentUrl) {
    return proxyRemoteAutocomplete(workspace.agentUrl, workspaceId, query)
  }

  const suggestions = await getSuggestions(workspaceId, workspace.path, query, session.user.id)

  return NextResponse.json({ suggestions })
}

async function proxyRemoteAutocomplete(
  agentUrl: string,
  workspaceId: string,
  query: string
): Promise<NextResponse> {
  try {
    const url = new URL("/commands/autocomplete", agentUrl)
    url.searchParams.set("q", query)

    const agentResponse = await globalThis.fetch(url.toString())

    if (!agentResponse.ok) {
      const text = await agentResponse.text()
      return NextResponse.json(
        { error: `Agent error: ${text}` },
        { status: agentResponse.status }
      )
    }

    const agentResult = await agentResponse.json() as {
      suggestions: AutocompleteSuggestion[]
    }

    // Agent doesn't have access to command history (stored in app DB).
    // Merge agent filesystem-based suggestions with local history.
    const { getSuggestions: getLocalSuggestions } = await import("@/lib/commands/autocomplete")
    const historySuggestions = await getHistorySuggestions(workspaceId, query)

    const merged = mergeAndDeduplicate(historySuggestions, agentResult.suggestions)

    return NextResponse.json({ suggestions: merged })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reach agent"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

async function getHistorySuggestions(
  workspaceId: string,
  query: string
): Promise<AutocompleteSuggestion[]> {
  const { db: appDb } = await import("@/lib/db")
  const { commandHistory } = await import("@/drizzle/schema")
  const { eq, desc, sql } = await import("drizzle-orm")

  const rows = await appDb
    .select({
      command: commandHistory.command,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(commandHistory)
    .where(eq(commandHistory.workspaceId, workspaceId))
    .groupBy(commandHistory.command)
    .orderBy(desc(sql`count(*)`))
    .limit(50)

  return rows
    .filter((row) => row.command.toLowerCase().includes(query.toLowerCase()))
    .map((row) => ({
      value: row.command,
      label: row.command,
      source: "history" as const,
      frequency: row.count,
    }))
}

function mergeAndDeduplicate(
  historySuggestions: AutocompleteSuggestion[],
  agentSuggestions: AutocompleteSuggestion[]
): AutocompleteSuggestion[] {
  const seen = new Map<string, AutocompleteSuggestion>()

  // History first so it takes priority
  for (const s of historySuggestions) {
    seen.set(s.value, s)
  }
  for (const s of agentSuggestions) {
    if (!seen.has(s.value)) {
      seen.set(s.value, s)
    }
  }

  const result = Array.from(seen.values())

  result.sort((a, b) => {
    const freqDiff = (b.frequency ?? 0) - (a.frequency ?? 0)
    if (freqDiff !== 0) return freqDiff
    const sourceOrder: Record<string, number> = {
      history: 0,
      script: 1,
      make: 2,
      cargo: 3,
      alias: 4,
      workspace: 5,
    }
    return (sourceOrder[a.source] ?? 99) - (sourceOrder[b.source] ?? 99)
  })

  return result.slice(0, 20)
}
