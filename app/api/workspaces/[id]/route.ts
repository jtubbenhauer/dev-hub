import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces, settings, cachedSessions } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import { exec } from "node:child_process"
import { removeWorktree, pruneWorktrees } from "@/lib/git/worktrees"
import type { WorkspaceProvider } from "@/types"

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET: single workspace
export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(
      and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id))
    )

  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Update last accessed timestamp
  await db
    .update(workspaces)
    .set({ lastAccessedAt: new Date() })
    .where(eq(workspaces.id, id))

  return NextResponse.json(workspace)
}

// PUT: update workspace
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json()
  const { name, quickCommands, agentUrl, opencodeUrl, provider, providerMeta, shellCommand, color } = body

  const updateData: Record<string, unknown> = {}
  if (name !== undefined) updateData.name = name
  if (quickCommands !== undefined) updateData.quickCommands = quickCommands
  if (agentUrl !== undefined) updateData.agentUrl = agentUrl
  if (opencodeUrl !== undefined) updateData.opencodeUrl = opencodeUrl
  if (provider !== undefined) updateData.provider = provider
  if (providerMeta !== undefined) updateData.providerMeta = providerMeta
  if (shellCommand !== undefined) updateData.shellCommand = shellCommand
  if (color !== undefined) updateData.color = color

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    )
  }

  await db
    .update(workspaces)
    .set(updateData)
    .where(
      and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id))
    )

  const [updated] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))

  return NextResponse.json(updated)
}

// DELETE: remove workspace
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const url = new URL(request.url)
  const destroyProvider = url.searchParams.get("destroyProvider") === "true"

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(
      and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id))
    )

  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Clean up git worktree on disk before deleting the DB row
  let worktreeRemoveError: string | null = null
  if (workspace.type === "worktree" && workspace.parentRepoPath) {
    try {
      await removeWorktree(workspace.parentRepoPath, workspace.path, true)
      await pruneWorktrees(workspace.parentRepoPath)
    } catch (err) {
      worktreeRemoveError = err instanceof Error ? err.message : "Failed to remove worktree"
    }
  }

  // Run provider destroy command if requested and workspace has provider metadata
  let providerDestroyError: string | null = null
  if (destroyProvider && workspace.backend === "remote" && workspace.providerMeta) {
    const meta = workspace.providerMeta as Record<string, unknown>
    const providerId = typeof meta.providerId === "string" ? meta.providerId : null
    const providerWorkspaceId = typeof meta.providerWorkspaceId === "string" ? meta.providerWorkspaceId : null

    if (providerId && providerWorkspaceId) {
      const provider = await findProvider(session.user.id, providerId)
      if (provider) {
        const command = provider.commands.destroy
          .replaceAll("{binary}", provider.binaryPath)
          .replaceAll("{id}", providerWorkspaceId)

        try {
          await new Promise<void>((resolve, reject) => {
            exec(command, { timeout: 60_000 }, (error, _stdout, stderrBuf) => {
              if (error) {
                reject(new Error(stderrBuf || error.message))
                return
              }
              resolve()
            })
          })
        } catch (err) {
          providerDestroyError = err instanceof Error ? err.message : "Provider destroy failed"
        }
      }
    }
  }

  await db
    .delete(workspaces)
    .where(eq(workspaces.id, id))

  try {
    await db
      .delete(cachedSessions)
      .where(eq(cachedSessions.workspaceId, id))
  } catch {
  }

  return NextResponse.json({
    deleted: true,
    ...(worktreeRemoveError ? { worktreeRemoveError } : {}),
    ...(providerDestroyError ? { providerDestroyError } : {}),
  })
}

function isWorkspaceProvider(value: unknown): value is WorkspaceProvider {
  if (!value || typeof value !== "object") return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.binaryPath === "string" &&
    typeof obj.commands === "object" &&
    obj.commands !== null &&
    typeof (obj.commands as Record<string, unknown>).create === "string" &&
    typeof (obj.commands as Record<string, unknown>).destroy === "string" &&
    typeof (obj.commands as Record<string, unknown>).status === "string"
  )
}

async function findProvider(
  userId: string,
  providerId: string
): Promise<WorkspaceProvider | null> {
  const [settingRow] = await db
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.userId, userId),
        eq(settings.key, "workspace-providers")
      )
    )

  if (!settingRow) return null

  const providerList = Array.isArray(settingRow.value)
    ? (settingRow.value as unknown[]).filter(isWorkspaceProvider)
    : []

  return providerList.find((p) => p.id === providerId) ?? null
}
