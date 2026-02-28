import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import fs from "node:fs"

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
  const { name, quickCommands } = body

  const updateData: Record<string, unknown> = {}
  if (name !== undefined) updateData.name = name
  if (quickCommands !== undefined) updateData.quickCommands = quickCommands

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
  const deleteFiles = url.searchParams.get("deleteFiles") === "true"

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(
      and(eq(workspaces.id, id), eq(workspaces.userId, session.user.id))
    )

  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  if (deleteFiles && fs.existsSync(workspace.path)) {
    fs.rmSync(workspace.path, { recursive: true, force: true })
  }

  await db
    .delete(workspaces)
    .where(eq(workspaces.id, id))

  return NextResponse.json({ deleted: true })
}
