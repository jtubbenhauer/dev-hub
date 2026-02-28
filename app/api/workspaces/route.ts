import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq } from "drizzle-orm"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

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

function detectWorkspaceType(
  dirPath: string
): "repo" | "worktree" {
  const gitPath = path.join(dirPath, ".git")
  try {
    const stat = fs.statSync(gitPath)
    // .git is a file (not dir) in worktrees — contains "gitdir: ..." pointer
    if (stat.isFile()) return "worktree"
  } catch {
    // no .git at all
  }
  return "repo"
}

function findParentRepoPath(dirPath: string): string | null {
  const gitPath = path.join(dirPath, ".git")
  try {
    const content = fs.readFileSync(gitPath, "utf-8")
    const match = content.match(/gitdir:\s*(.+)/)
    if (match) {
      // gitdir points to .git/worktrees/<name> inside the main repo
      const gitdir = path.resolve(dirPath, match[1].trim())
      // Go up from .git/worktrees/<name> to .git, then to the repo root
      const mainGitDir = path.resolve(gitdir, "..", "..")
      return path.dirname(mainGitDir)
    }
  } catch {
    // not a worktree
  }
  return null
}

// GET: list all workspaces
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userWorkspaces = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.userId, session.user.id))

  return NextResponse.json(userWorkspaces)
}

// POST: create workspace
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { name, path: workspacePath } = body

  if (!workspacePath || typeof workspacePath !== "string") {
    return NextResponse.json(
      { error: "Path is required" },
      { status: 400 }
    )
  }

  const resolvedPath = path.resolve(workspacePath)

  if (!fs.existsSync(resolvedPath)) {
    return NextResponse.json(
      { error: "Directory does not exist" },
      { status: 400 }
    )
  }

  const stat = fs.statSync(resolvedPath)
  if (!stat.isDirectory()) {
    return NextResponse.json(
      { error: "Path is not a directory" },
      { status: 400 }
    )
  }

  const type = detectWorkspaceType(resolvedPath)
  const packageManager = detectPackageManager(resolvedPath)
  const parentRepoPath = type === "worktree"
    ? findParentRepoPath(resolvedPath)
    : null

  const workspaceName = name || path.basename(resolvedPath)

  const workspace = {
    id: crypto.randomUUID(),
    userId: session.user.id,
    name: workspaceName,
    path: resolvedPath,
    type,
    parentRepoPath,
    packageManager,
    quickCommands: null,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  }

  await db.insert(workspaces).values(workspace)

  return NextResponse.json(workspace, { status: 201 })
}
