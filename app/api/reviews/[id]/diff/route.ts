import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { reviews, reviewFiles, workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import { getRefDiff, getUncommittedDiff } from "@/lib/git/review"

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET: fetch diff for a specific file in a review
export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: reviewId } = await params
  const url = new URL(request.url)
  const fileId = url.searchParams.get("fileId")

  if (!fileId) {
    return NextResponse.json({ error: "fileId required" }, { status: 400 })
  }

  const result = await db
    .select({ review: reviews, workspace: workspaces })
    .from(reviews)
    .innerJoin(workspaces, eq(reviews.workspaceId, workspaces.id))
    .where(and(eq(reviews.id, reviewId), eq(workspaces.userId, session.user.id)))

  if (result.length === 0) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 })
  }

  const { review, workspace } = result[0]

  const [file] = await db
    .select()
    .from(reviewFiles)
    .where(and(eq(reviewFiles.id, Number(fileId)), eq(reviewFiles.reviewId, reviewId)))

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 })
  }

  try {
    let diff: string

    if (review.mode === "uncommitted") {
      diff = await getUncommittedDiff(workspace.path, file.path)
    } else {
      const effectiveBase = review.mergeBase ?? review.baseRef
      if (!effectiveBase) {
        return NextResponse.json({ error: "No base ref for review" }, { status: 500 })
      }
      diff = await getRefDiff(workspace.path, effectiveBase, file.path)
    }

    return NextResponse.json({ diff, path: file.path })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get diff"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
