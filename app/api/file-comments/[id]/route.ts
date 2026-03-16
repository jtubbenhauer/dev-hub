import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { fileComments, workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"

interface RouteParams {
  params: Promise<{ id: string }>
}

async function verifyCommentOwnership(userId: string, commentId: number) {
  const result = await db
    .select({ comment: fileComments, workspace: workspaces })
    .from(fileComments)
    .innerJoin(workspaces, eq(fileComments.workspaceId, workspaces.id))
    .where(and(eq(fileComments.id, commentId), eq(workspaces.userId, userId)))

  return result[0] ?? null
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const result = await verifyCommentOwnership(session.user.id, Number(id))

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json(result.comment)
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const result = await verifyCommentOwnership(session.user.id, Number(id))

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const body = await request.json()
  const { body: commentBody } = body as { body: string }

  if (!commentBody) {
    return NextResponse.json({ error: "body is required" }, { status: 400 })
  }

  const [updated] = await db
    .update(fileComments)
    .set({ body: commentBody, updatedAt: new Date() })
    .where(eq(fileComments.id, Number(id)))
    .returning()

  return NextResponse.json(updated)
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const result = await verifyCommentOwnership(session.user.id, Number(id))

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await db.delete(fileComments).where(eq(fileComments.id, Number(id)))

  return NextResponse.json({ deleted: true })
}
