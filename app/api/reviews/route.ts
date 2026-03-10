import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { reviews, reviewFiles, workspaces } from "@/drizzle/schema"
import { eq, and, desc } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import type { ReviewMode } from "@/types"
import { getBackend, toWorkspace } from "@/lib/workspaces/backend"

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

  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id)))

  if (!row) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  try {
    if (action === "branches") {
      const backend = getBackend(toWorkspace(row))
      const branches = await backend.getAllBranches()
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

  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, session.user.id)))

  if (!row) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  const backend = getBackend(toWorkspace(row))

  try {
    const reviewId = randomUUID()
    let baseRef: string | null = null
    let mergeBase: string | null = null
    let changedFiles: { path: string; status: string; oldPath?: string }[] = []

    switch (mode) {
      case "branch": {
        const ref = targetRef ?? "origin/HEAD"
        mergeBase = await backend.getMergeBase(ref)
        baseRef = ref
        changedFiles = await backend.getChangedFiles(mergeBase)
        break
      }
      case "uncommitted": {
        baseRef = "HEAD"
        const allUncommitted = await backend.getUncommittedFiles()
        // Filter out files with no actual content on either side (phantom git status entries)
        const hasContent = await Promise.all(
          allUncommitted.map(async (file) => {
            const [original, current] = await Promise.all([
              backend.getOriginalContent(file.path),
              backend.getCurrentContent(file.path),
            ])
            return original !== "" || current !== ""
          })
        )
        changedFiles = allUncommitted.filter((_, i) => hasContent[i])
        break
      }
      case "last-commit": {
        baseRef = await backend.getLastCommitRef()
        mergeBase = baseRef
        changedFiles = await backend.getChangedFiles(baseRef)
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
            ? await backend.computeUncommittedDiffHash(file.path)
            : await backend.computeDiffHash(mergeBase ?? baseRef!, file.path)

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
