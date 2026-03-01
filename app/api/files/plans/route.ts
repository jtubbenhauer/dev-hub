import fs from "node:fs"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"

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

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.userId, session.user.id)
      )
    )

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  const plansDir = path.join(workspace.path, PLANS_RELATIVE_PATH)

  if (!fs.existsSync(plansDir)) {
    return NextResponse.json({ files: [] })
  }

  try {
    const entries = fs.readdirSync(plansDir, { withFileTypes: true })
    const files: PlanFile[] = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => {
        const fullPath = path.join(plansDir, entry.name)
        const stat = fs.statSync(fullPath)
        return {
          name: entry.name,
          path: path.join(PLANS_RELATIVE_PATH, entry.name),
          lastModified: stat.mtime.toISOString(),
        }
      })
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified))

    return NextResponse.json({ files })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list plan files"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
