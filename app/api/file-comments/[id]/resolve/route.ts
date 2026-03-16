import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { fileComments, workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const commentId = Number(id)

  const result = await db
    .select({ comment: fileComments, workspace: workspaces })
    .from(fileComments)
    .innerJoin(workspaces, eq(fileComments.workspaceId, workspaces.id))
    .where(and(eq(fileComments.id, commentId), eq(workspaces.userId, session.user.id)))

  if (!result[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const body = await request.json()
  const { resolved } = body as { resolved: boolean }

  if (resolved == null) {
    return NextResponse.json({ error: "resolved is required" }, { status: 400 })
  }

  const [updated] = await db
    .update(fileComments)
    .set({ resolved, updatedAt: new Date() })
    .where(eq(fileComments.id, commentId))
    .returning()

  return NextResponse.json(updated)
}
