import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { getWorktreeBaseDir, createSymlinks } from "@/lib/git/worktrees"
import { getBackend, toWorkspace } from "@/lib/workspaces/backend"

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
    parentWorkspaceId,
    parentRepoPath: legacyParentRepoPath,
    branch,
    newBranch = false,
    basePath,
    startPoint,
    name,
    symlinkPaths,
  } = body

  // Validate required fields
  if (!branch || typeof branch !== "string") {
    return NextResponse.json({ error: "branch is required" }, { status: 400 })
  }

  // Resolve the parent workspace — either by ID (preferred) or legacy path
  let resolvedParent: string
  let parentBackendType: "local" | "remote" = "local"

  if (parentWorkspaceId && typeof parentWorkspaceId === "string") {
    const [parentRow] = await db
      .select()
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, parentWorkspaceId),
          eq(workspaces.userId, session.user.id)
        )
      )

    if (!parentRow) {
      return NextResponse.json({ error: "Parent workspace not found" }, { status: 404 })
    }

    const parentWorkspace = toWorkspace(parentRow)
    parentBackendType = parentWorkspace.backend
    resolvedParent = parentWorkspace.path

    // Use the parent workspace's backend to verify branch exists
    const backend = getBackend(parentWorkspace)
    if (!newBranch) {
      const branches = await backend.getBranches()
      const branchExists = branches.some((b) => b.name === branch)
      if (!branchExists) {
        return NextResponse.json(
          { error: `Branch "${branch}" does not exist. Check "Create new branch" to create it.` },
          { status: 400 }
        )
      }
    }

    const worktreePath = await backend.addWorktree(branch, newBranch, basePath, startPoint)

    // Resolve symlink paths: use explicitly provided list, or fall back to parent's saved config
    const resolvedSymlinks: string[] = Array.isArray(symlinkPaths)
      ? symlinkPaths
      : (parentWorkspace.worktreeSymlinks ?? [])

    let symlinkResult: { created: string[]; skipped: string[] } | undefined
    if (resolvedSymlinks.length > 0 && parentBackendType === "local") {
      symlinkResult = await createSymlinks(resolvedParent, worktreePath, resolvedSymlinks)
      await db.update(workspaces)
        .set({ worktreeSymlinks: resolvedSymlinks })
        .where(eq(workspaces.id, parentWorkspaceId))
    }

    const packageManager = parentBackendType === "local"
      ? detectPackageManager(worktreePath)
      : parentWorkspace.packageManager

    const parentName = path.basename(resolvedParent)
    const workspaceName = name || `${parentName}/${branch}`

    const workspace = {
      id: crypto.randomUUID(),
      userId: session.user.id,
      name: workspaceName,
      path: worktreePath,
      type: "worktree" as const,
      parentRepoPath: resolvedParent,
      packageManager,
      quickCommands: null,
      backend: parentBackendType,
      agentUrl: parentWorkspace.agentUrl,
      opencodeUrl: parentWorkspace.opencodeUrl,
      provider: parentWorkspace.provider,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    }

    await db.insert(workspaces).values(workspace)

    return NextResponse.json(
      {
        workspace,
        worktreePath,
        branch,
        symlinks: symlinkResult,
        defaultBaseDir: parentBackendType === "local"
          ? getWorktreeBaseDir(resolvedParent)
          : undefined,
      },
      { status: 201 }
    )
  }

  // Legacy path-based flow (local only)
  if (!legacyParentRepoPath || typeof legacyParentRepoPath !== "string") {
    return NextResponse.json({ error: "parentWorkspaceId or parentRepoPath is required" }, { status: 400 })
  }

  resolvedParent = path.resolve(legacyParentRepoPath)

  if (!fs.existsSync(resolvedParent)) {
    return NextResponse.json({ error: "Parent repo directory does not exist" }, { status: 400 })
  }

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

  // Build a temporary local workspace to use the backend
  const tempWorkspace = toWorkspace({
    id: "",
    userId: session.user.id,
    name: "",
    path: resolvedParent,
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "local",
    provider: null,
    opencodeUrl: null,
    agentUrl: null,
    providerMeta: null,
    worktreeSymlinks: null,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  })

  const backend = getBackend(tempWorkspace)

  if (!newBranch) {
    const branches = await backend.getBranches()
    const branchExists = branches.some((b) => b.name === branch)
    if (!branchExists) {
      return NextResponse.json(
        { error: `Branch "${branch}" does not exist. Check "Create new branch" to create it.` },
        { status: 400 }
      )
    }
  }

  try {
    const worktreePath = await backend.addWorktree(branch, newBranch, basePath, startPoint)

    // Resolve symlink paths: use explicitly provided list, or look up parent's saved config
    let resolvedSymlinksLegacy: string[] = []
    if (Array.isArray(symlinkPaths)) {
      resolvedSymlinksLegacy = symlinkPaths
    } else {
      const [parentRow] = await db
        .select({ worktreeSymlinks: workspaces.worktreeSymlinks })
        .from(workspaces)
        .where(eq(workspaces.path, resolvedParent))
      if (parentRow?.worktreeSymlinks && Array.isArray(parentRow.worktreeSymlinks)) {
        resolvedSymlinksLegacy = parentRow.worktreeSymlinks
      }
    }

    let symlinkResultLegacy: { created: string[]; skipped: string[] } | undefined
    if (resolvedSymlinksLegacy.length > 0) {
      symlinkResultLegacy = await createSymlinks(resolvedParent, worktreePath, resolvedSymlinksLegacy)
      await db.update(workspaces)
        .set({ worktreeSymlinks: resolvedSymlinksLegacy })
        .where(eq(workspaces.path, resolvedParent))
    }

    const packageManager = detectPackageManager(worktreePath)

    const parentName = path.basename(resolvedParent)
    const workspaceName = name || `${parentName}/${branch}`

    const workspace = {
      id: crypto.randomUUID(),
      userId: session.user.id,
      name: workspaceName,
      path: worktreePath,
      type: "worktree" as const,
      parentRepoPath: resolvedParent,
      packageManager,
      quickCommands: null,
      backend: "local" as const,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    }

    await db.insert(workspaces).values(workspace)

    return NextResponse.json(
      {
        workspace,
        worktreePath,
        branch,
        symlinks: symlinkResultLegacy,
        defaultBaseDir: getWorktreeBaseDir(resolvedParent),
      },
      { status: 201 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create worktree"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
