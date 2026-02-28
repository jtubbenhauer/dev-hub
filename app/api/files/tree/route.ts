import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import { readDirectoryTree } from "@/lib/files/operations"
import { getFileStatuses } from "@/lib/git/status"
import type { FileTreeEntry, FileGitStatus } from "@/types"

function applyGitStatuses(
  entries: FileTreeEntry[],
  statuses: Map<string, FileGitStatus>
): void {
  for (const entry of entries) {
    const status = statuses.get(entry.path)
    if (status) {
      entry.gitStatus = status
    }

    // Bubble up status to parent directories
    if (entry.type === "directory" && entry.children) {
      applyGitStatuses(entry.children, statuses)

      // Mark directory as modified if any child has a git status
      if (!entry.gitStatus) {
        const hasChangedChild = entry.children.some((c) => c.gitStatus)
        if (hasChangedChild) {
          entry.gitStatus = "modified"
        }
      }
    }
  }
}

// GET: directory tree for a workspace
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const workspaceId = searchParams.get("workspaceId")
  const relativePath = searchParams.get("path") ?? "."
  const depth = parseInt(searchParams.get("depth") ?? "1", 10)

  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 }
    )
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

  try {
    const targetPath = relativePath === "."
      ? workspace.path
      : require("node:path").resolve(workspace.path, relativePath)

    const entries = readDirectoryTree(targetPath, workspace.path, depth)

    // Apply git statuses
    const statuses = await getFileStatuses(workspace.path)
    applyGitStatuses(entries, statuses)

    return NextResponse.json(entries)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read directory"
    const status = message === "Path traversal denied" ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
