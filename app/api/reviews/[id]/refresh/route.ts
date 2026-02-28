import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { reviews, reviewFiles, workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import {
  getChangedFiles,
  getUncommittedFiles,
  computeDiffHash,
  computeUncommittedDiffHash,
  getMergeBase,
} from "@/lib/git/review"

interface RouteParams {
  params: Promise<{ id: string }>
}

// POST: refresh review — re-scan git for changes, detect staleness
export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: reviewId } = await params

  const result = await db
    .select({ review: reviews, workspace: workspaces })
    .from(reviews)
    .innerJoin(workspaces, eq(reviews.workspaceId, workspaces.id))
    .where(and(eq(reviews.id, reviewId), eq(workspaces.userId, session.user.id)))

  if (result.length === 0) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 })
  }

  const { review, workspace } = result[0]

  try {
    let currentFiles: { path: string; status: string; oldPath?: string }[] = []
    let effectiveBase = review.mergeBase ?? review.baseRef

    if (review.mode === "uncommitted") {
      currentFiles = await getUncommittedFiles(workspace.path)
    } else if (review.mode === "branch" && review.targetRef) {
      // Recompute merge-base in case the branch moved
      const newMergeBase = await getMergeBase(workspace.path, review.targetRef)
      effectiveBase = newMergeBase
      currentFiles = await getChangedFiles(workspace.path, newMergeBase)

      if (newMergeBase !== review.mergeBase) {
        await db
          .update(reviews)
          .set({ mergeBase: newMergeBase })
          .where(eq(reviews.id, reviewId))
      }
    } else if (effectiveBase) {
      currentFiles = await getChangedFiles(workspace.path, effectiveBase)
    }

    const existingFiles = await db
      .select()
      .from(reviewFiles)
      .where(eq(reviewFiles.reviewId, reviewId))

    const existingByPath = new Map(existingFiles.map((f) => [f.path, f]))
    const currentPaths = new Set(currentFiles.map((f) => f.path))

    // Remove files no longer changed
    for (const existing of existingFiles) {
      if (!currentPaths.has(existing.path)) {
        await db.delete(reviewFiles).where(eq(reviewFiles.id, existing.id))
      }
    }

    // Add new files, check staleness on existing
    let staleCount = 0
    for (const file of currentFiles) {
      const newHash =
        review.mode === "uncommitted"
          ? await computeUncommittedDiffHash(workspace.path, file.path)
          : await computeDiffHash(workspace.path, effectiveBase!, file.path)

      const existing = existingByPath.get(file.path)
      if (existing) {
        // Check if diff changed — auto-unreview if stale
        if (existing.diffHash !== newHash && existing.reviewed) {
          await db
            .update(reviewFiles)
            .set({ reviewed: false, reviewedAt: null, diffHash: newHash })
            .where(eq(reviewFiles.id, existing.id))
          staleCount++
        } else if (existing.diffHash !== newHash) {
          await db
            .update(reviewFiles)
            .set({ diffHash: newHash })
            .where(eq(reviewFiles.id, existing.id))
        }
      } else {
        await db.insert(reviewFiles).values({
          reviewId,
          path: file.path,
          status: file.status as "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed" | "untracked",
          oldPath: file.oldPath ?? null,
          reviewed: false,
          diffHash: newHash,
        })
      }
    }

    // Recount
    const updatedFiles = await db
      .select()
      .from(reviewFiles)
      .where(eq(reviewFiles.reviewId, reviewId))

    const reviewedCount = updatedFiles.filter((f) => f.reviewed).length

    await db
      .update(reviews)
      .set({
        totalFiles: updatedFiles.length,
        reviewedFiles: reviewedCount,
        updatedAt: new Date(),
      })
      .where(eq(reviews.id, reviewId))

    const updatedReview = await db
      .select()
      .from(reviews)
      .where(eq(reviews.id, reviewId))

    return NextResponse.json({
      ...updatedReview[0],
      files: updatedFiles,
      staleCount,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh review"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
