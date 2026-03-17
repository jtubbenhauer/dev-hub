import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import { toWorkspace } from "@/lib/workspaces/backend"
import simpleGit from "simple-git"

/**
 * GET /api/files/search?workspaceId=...
 *
 * Returns the full list of tracked files via `git ls-files`.
 * Falls back to a recursive directory walk if the workspace isn't a git repo.
 * Fuzzy matching is done client-side for instant feedback while typing.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const workspaceId = request.nextUrl.searchParams.get("workspaceId")
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 }
    )
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

  try {
    const workspace = toWorkspace(row)
    const files = await listAllFiles(workspace.path)
    return NextResponse.json({ files })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list files"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "__pycache__",
  "dist",
  ".pnpm-store",
  "target",
  ".angular",
])

async function listAllFiles(workspacePath: string): Promise<string[]> {
  // Try git ls-files first (fast, respects .gitignore)
  try {
    const git = simpleGit(workspacePath)
    const isRepo = await git.checkIsRepo()
    if (isRepo) {
      // --cached --others --exclude-standard gives tracked + untracked (non-ignored) files
      const result = await git.raw([
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
      ])
      const files = result
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean)
      return files
    }
  } catch {
    // Fall through to fs walk
  }

  // Fallback: recursive directory walk
  const fs = await import("node:fs")
  const path = await import("node:path")
  const files: string[] = []

  function walk(dir: string) {
    let entries: import("node:fs").Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile()) {
        files.push(path.relative(workspacePath, fullPath))
      }
    }
  }

  walk(workspacePath)
  return files
}
