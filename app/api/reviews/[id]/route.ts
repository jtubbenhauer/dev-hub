import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { reviews, reviewFiles, workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"

interface RouteParams {
  params: Promise<{ id: string }>
}

async function verifyReviewOwnership(userId: string, reviewId: string) {
  const result = await db
    .select({ review: reviews, workspace: workspaces })
    .from(reviews)
    .innerJoin(workspaces, eq(reviews.workspaceId, workspaces.id))
    .where(and(eq(reviews.id, reviewId), eq(workspaces.userId, userId)))

  return result[0] ?? null
}

// GET: single review with files
export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const result = await verifyReviewOwnership(session.user.id, id)

  if (!result) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 })
  }

  const files = await db
    .select()
    .from(reviewFiles)
    .where(eq(reviewFiles.reviewId, id))

  return NextResponse.json({ ...result.review, files })
}

// DELETE: delete a review
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const result = await verifyReviewOwnership(session.user.id, id)

  if (!result) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 })
  }

  // Cascade deletes review_files via FK
  await db.delete(reviews).where(eq(reviews.id, id))

  return NextResponse.json({ deleted: true })
}
