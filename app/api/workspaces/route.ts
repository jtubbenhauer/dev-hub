import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq } from "drizzle-orm"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { WorkspaceBackendType } from "@/types"

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
      const gitdir = path.resolve(dirPath, match[1].trim())
      const mainGitDir = path.resolve(gitdir, "..", "..")
      return path.dirname(mainGitDir)
    }
  } catch {
    // not a worktree
  }
  return null
}

async function verifyAgentHealth(agentUrl: string): Promise<boolean> {
  try {
    const response = await globalThis.fetch(new URL("/health", agentUrl).toString(), {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return false
    const body = await response.json() as { status?: string }
    return body.status === "ok"
  } catch {
    return false
  }
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

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const backend = (body.backend as WorkspaceBackendType) ?? "local"
  const name = typeof body.name === "string" ? body.name : undefined

  if (backend === "remote") {
    return createRemoteWorkspace(session.user.id, body, name)
  }

  return createLocalWorkspace(session.user.id, body, name)
}

async function createLocalWorkspace(
  userId: string,
  body: Record<string, unknown>,
  name: string | undefined
) {
  const workspacePath = body.path

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
    userId,
    name: workspaceName,
    path: resolvedPath,
    type: "repo" as const,
    parentRepoPath,
    packageManager,
    quickCommands: null,
    backend: "local" as const,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  }

  await db.insert(workspaces).values(workspace)

  return NextResponse.json(workspace, { status: 201 })
}

async function createRemoteWorkspace(
  userId: string,
  body: Record<string, unknown>,
  name: string | undefined
) {
  const agentUrl = body.agentUrl
  const opencodeUrl = body.opencodeUrl

  if (!agentUrl || typeof agentUrl !== "string") {
    return NextResponse.json(
      { error: "agentUrl is required for remote workspaces" },
      { status: 400 }
    )
  }

  if (!opencodeUrl || typeof opencodeUrl !== "string") {
    return NextResponse.json(
      { error: "opencodeUrl is required for remote workspaces" },
      { status: 400 }
    )
  }

  const isHealthy = await verifyAgentHealth(agentUrl)
  if (!isHealthy) {
    return NextResponse.json(
      { error: "Cannot reach agent at the provided URL. Ensure the agent is running." },
      { status: 400 }
    )
  }

  const provider = typeof body.provider === "string" ? body.provider : null
  const providerMeta = typeof body.providerMeta === "object" && body.providerMeta !== null
    ? body.providerMeta
    : null

  // For remote workspaces, path is informational (the container's workspace path)
  const workspacePath = typeof body.path === "string" ? body.path : "/workspace"
  const workspaceName = name || "Remote Workspace"

  const workspace = {
    id: crypto.randomUUID(),
    userId,
    name: workspaceName,
    path: workspacePath,
    type: "repo" as const,
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "remote" as const,
    provider,
    opencodeUrl,
    agentUrl,
    providerMeta,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  }

  await db.insert(workspaces).values(workspace)

  return NextResponse.json(workspace, { status: 201 })
}
