import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { reviews, reviewFiles, workspaces } from "@/drizzle/schema"
import { eq, and, desc } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import type { ReviewMode } from "@/types"
import {
  getMergeBase,
  getChangedFiles,
  getUncommittedFiles,
  getLastCommitRef,
  computeDiffHash,
  computeUncommittedDiffHash,
  getAllBranches,
} from "@/lib/git/review"

// GET: list reviews for a workspace, or get all branches
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const action = url.searchParams.get("action")
  const workspaceId = url.searchParams.get("workspaceId")

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 })
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id)))

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  try {
    if (action === "branches") {
      const branches = await getAllBranches(workspace.path)
      return NextResponse.json(branches)
    }

    const reviewList = await db
      .select()
      .from(reviews)
      .where(eq(reviews.workspaceId, workspaceId))
      .orderBy(desc(reviews.updatedAt))

    return NextResponse.json(reviewList)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list reviews"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST: create a new review
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { workspaceId, mode, targetRef } = body as {
    workspaceId: string
    mode: ReviewMode
    targetRef?: string
  }

  if (!workspaceId || !mode) {
    return NextResponse.json({ error: "workspaceId and mode required" }, { status: 400 })
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id)))

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  try {
    const reviewId = randomUUID()
    let baseRef: string | null = null
    let mergeBase: string | null = null
    let changedFiles: { path: string; status: string; oldPath?: string }[] = []

    switch (mode) {
      case "branch": {
        const ref = targetRef ?? "origin/HEAD"
        mergeBase = await getMergeBase(workspace.path, ref)
        baseRef = ref
        changedFiles = await getChangedFiles(workspace.path, mergeBase)
        break
      }
      case "uncommitted": {
        baseRef = "HEAD"
        changedFiles = await getUncommittedFiles(workspace.path)
        break
      }
      case "last-commit": {
        baseRef = await getLastCommitRef(workspace.path)
        mergeBase = baseRef
        changedFiles = await getChangedFiles(workspace.path, baseRef)
        break
      }
    }

    const now = new Date()
    await db.insert(reviews).values({
      id: reviewId,
      workspaceId,
      mode,
      targetRef: targetRef ?? null,
      baseRef,
      mergeBase,
      totalFiles: changedFiles.length,
      reviewedFiles: 0,
      createdAt: now,
      updatedAt: now,
    })

    // Compute diff hashes and insert files
    const fileInserts = await Promise.all(
      changedFiles.map(async (file) => {
        const diffHash =
          mode === "uncommitted"
            ? await computeUncommittedDiffHash(workspace.path, file.path)
            : await computeDiffHash(workspace.path, mergeBase ?? baseRef!, file.path)

        return {
          reviewId,
          path: file.path,
          status: file.status as "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed" | "untracked",
          oldPath: file.oldPath ?? null,
          reviewed: false,
          diffHash,
        }
      })
    )

    if (fileInserts.length > 0) {
      await db.insert(reviewFiles).values(fileInserts)
    }

    const files = await db
      .select()
      .from(reviewFiles)
      .where(eq(reviewFiles.reviewId, reviewId))

    const review = await db
      .select()
      .from(reviews)
      .where(eq(reviews.id, reviewId))

    return NextResponse.json({ ...review[0], files }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create review"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
