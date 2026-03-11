import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import { getBackend, toWorkspace } from "@/lib/workspaces/backend"

const PLANS_RELATIVE_PATH = ".opencode/plans"

export interface PlanFile {
  name: string
  path: string
  lastModified: string
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId")
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 })
  }

  const [row] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.userId, session.user.id)
      )
    )

  if (!row) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  const workspace = toWorkspace(row)
  const backend = getBackend(workspace)

  try {
    const entries = await backend.listDirectory(PLANS_RELATIVE_PATH, 1)
    const files: PlanFile[] = entries
      .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
      .map((entry) => ({
        name: entry.name,
        path: `${PLANS_RELATIVE_PATH}/${entry.name}`,
        // listDirectory doesn't return mtime — use current time as fallback
        lastModified: new Date().toISOString(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ files })
  } catch {
    // Directory doesn't exist
    return NextResponse.json({ files: [] })
  }
}
