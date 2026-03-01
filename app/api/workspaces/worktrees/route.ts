import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { addWorktree, getWorktreeBaseDir } from "@/lib/git/worktrees"
import { getBranches } from "@/lib/git/operations"

function detectPackageManager(
  dirPath: string
): "pnpm" | "npm" | "bun" | "cargo" | "go" | "none" {
  if (fs.existsSync(path.join(dirPath, "pnpm-lock.yaml"))) return "pnpm"
  if (fs.existsSync(path.join(dirPath, "bun.lockb"))) return "bun"
  if (fs.existsSync(path.join(dirPath, "package-lock.json"))) return "npm"
  if (fs.existsSync(path.join(dirPath, "Cargo.toml"))) return "cargo"
  if (fs.existsSync(path.join(dirPath, "go.mod"))) return "go"
  return "none"
}

// POST: create a new worktree and register it as a workspace
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const {
    parentRepoPath,
    branch,
    newBranch = false,
    basePath,
    startPoint,
    name,
  } = body

  // Validate required fields
  if (!parentRepoPath || typeof parentRepoPath !== "string") {
    return NextResponse.json({ error: "parentRepoPath is required" }, { status: 400 })
  }
  if (!branch || typeof branch !== "string") {
    return NextResponse.json({ error: "branch is required" }, { status: 400 })
  }

  const resolvedParent = path.resolve(parentRepoPath)

  // Verify parent repo exists
  if (!fs.existsSync(resolvedParent)) {
    return NextResponse.json({ error: "Parent repo directory does not exist" }, { status: 400 })
  }

  // Verify it's actually a git repo (not a worktree itself)
  const gitDir = path.join(resolvedParent, ".git")
  try {
    const stat = fs.statSync(gitDir)
    if (!stat.isDirectory()) {
      return NextResponse.json(
        { error: "Parent path is a worktree, not a repository. Select the main repo." },
        { status: 400 }
      )
    }
  } catch {
    return NextResponse.json({ error: "Parent path is not a git repository" }, { status: 400 })
  }

  // If using an existing branch, verify it exists
  if (!newBranch) {
    const branches = await getBranches(resolvedParent)
    const branchExists = branches.some((b) => b.name === branch)
    if (!branchExists) {
      return NextResponse.json(
        { error: `Branch "${branch}" does not exist. Check "Create new branch" to create it.` },
        { status: 400 }
      )
    }
  }

  try {
    // Create the worktree
    const worktreePath = await addWorktree(
      resolvedParent,
      branch,
      newBranch,
      basePath,
      startPoint
    )

    // Detect package manager in the new worktree
    const packageManager = detectPackageManager(worktreePath)

    // Auto-generate workspace name
    const parentName = path.basename(resolvedParent)
    const workspaceName = name || `${parentName}/${branch}`

    // Register as workspace
    const workspace = {
      id: crypto.randomUUID(),
      userId: session.user.id,
      name: workspaceName,
      path: worktreePath,
      type: "worktree" as const,
      parentRepoPath: resolvedParent,
      packageManager,
      quickCommands: null,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    }

    await db.insert(workspaces).values(workspace)

    return NextResponse.json(
      {
        workspace,
        worktreePath,
        branch,
        defaultBaseDir: getWorktreeBaseDir(resolvedParent),
      },
      { status: 201 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create worktree"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
