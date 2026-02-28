import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { reviews, reviewFiles, workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"

interface RouteParams {
  params: Promise<{ id: string }>
}

// POST: toggle reviewed status for a file
export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: reviewId } = await params
  const body = await request.json()
  const { fileId, reviewed } = body as { fileId: number; reviewed: boolean }

  if (fileId === undefined || reviewed === undefined) {
    return NextResponse.json({ error: "fileId and reviewed required" }, { status: 400 })
  }

  // Verify ownership
  const ownerCheck = await db
    .select({ review: reviews, workspace: workspaces })
    .from(reviews)
    .innerJoin(workspaces, eq(reviews.workspaceId, workspaces.id))
    .where(and(eq(reviews.id, reviewId), eq(workspaces.userId, session.user.id)))

  if (ownerCheck.length === 0) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 })
  }

  await db
    .update(reviewFiles)
    .set({
      reviewed,
      reviewedAt: reviewed ? new Date() : null,
    })
    .where(and(eq(reviewFiles.id, fileId), eq(reviewFiles.reviewId, reviewId)))

  // Recount reviewed files
  const allFiles = await db
    .select()
    .from(reviewFiles)
    .where(eq(reviewFiles.reviewId, reviewId))

  const reviewedCount = allFiles.filter((f) => f.reviewed).length

  await db
    .update(reviews)
    .set({ reviewedFiles: reviewedCount, updatedAt: new Date() })
    .where(eq(reviews.id, reviewId))

  return NextResponse.json({ ok: true, reviewedFiles: reviewedCount })
}
