import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { db } from "@/lib/db"
import { workspaces } from "@/drizzle/schema"
import { eq, and } from "drizzle-orm"
import {
  getGitStatus,
  stageFiles,
  stageAll,
  unstageFiles,
  unstageAll,
  discardChanges,
  commit,
  getLog,
  getDiff,
  getCommitDiff,
  getBranches,
  createBranch,
  switchBranch,
  deleteBranch,
  push,
  pull,
  fetch as gitFetch,
  stashSave,
  stashList,
  stashApply,
  stashPop,
  stashDrop,
} from "@/lib/git/operations"
import {
  getOriginalContent,
  getCurrentContent,
  getStagedContent,
  getContentAtRef,
  getChangedFiles,
} from "@/lib/git/review"
import { getLanguageFromFilename } from "@/lib/files/operations"
import { listWorktrees } from "@/lib/git/worktrees"

interface RouteParams {
  params: Promise<{ id: string }>
}

async function resolveWorkspacePath(userId: string, workspaceId: string): Promise<string | null> {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)))

  return workspace?.path ?? null
}

// GET: git status, log, branches, diff, stash list
export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const workspacePath = await resolveWorkspacePath(session.user.id, id)
  if (!workspacePath) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  const url = new URL(request.url)
  const action = url.searchParams.get("action") ?? "status"

  try {
    switch (action) {
      case "status": {
        const status = await getGitStatus(workspacePath)
        return NextResponse.json(status)
      }

      case "log": {
        const maxCount = parseInt(url.searchParams.get("maxCount") ?? "50", 10)
        const log = await getLog(workspacePath, maxCount)
        return NextResponse.json(log)
      }

      case "branches": {
        const branches = await getBranches(workspacePath)
        return NextResponse.json(branches)
      }

      case "diff": {
        const file = url.searchParams.get("file")
        const staged = url.searchParams.get("staged") === "true"
        if (!file) {
          return NextResponse.json({ error: "file parameter required" }, { status: 400 })
        }
        const diff = await getDiff(workspacePath, file, staged)
        return NextResponse.json({ diff })
      }

      case "commit-diff": {
        const hash = url.searchParams.get("hash")
        if (!hash) {
          return NextResponse.json({ error: "hash parameter required" }, { status: 400 })
        }
        const diff = await getCommitDiff(workspacePath, hash)
        return NextResponse.json({ diff })
      }

      case "stash-list": {
        const stashes = await stashList(workspacePath)
        return NextResponse.json(stashes)
      }

      case "file-content": {
        const file = url.searchParams.get("file")
        const staged = url.searchParams.get("staged") === "true"
        const baseRef = url.searchParams.get("baseRef")
        const currentRef = url.searchParams.get("currentRef")
        if (!file) {
          return NextResponse.json({ error: "file parameter required" }, { status: 400 })
        }
        const language = getLanguageFromFilename(file)

        // Ref-based mode (branch comparison or last-commit): baseRef required, currentRef optional
        if (baseRef) {
          const original = await getContentAtRef(workspacePath, baseRef, file)
          const current = currentRef
            ? await getContentAtRef(workspacePath, currentRef, file)
            : getCurrentContent(workspacePath, file)
          return NextResponse.json({ original, current, path: file, language })
        }

        // Working changes mode: HEAD vs staged index or working tree
        const original = await getOriginalContent(workspacePath, file)
        const current = staged
          ? await getStagedContent(workspacePath, file)
          : getCurrentContent(workspacePath, file)
        return NextResponse.json({ original, current, path: file, language })
      }

      case "changed-files": {
        const baseRef = url.searchParams.get("baseRef")
        if (!baseRef) {
          return NextResponse.json({ error: "baseRef parameter required" }, { status: 400 })
        }
        const files = await getChangedFiles(workspacePath, baseRef)
        return NextResponse.json(files)
      }

      case "worktree-list": {
        const worktrees = await listWorktrees(workspacePath)
        return NextResponse.json(worktrees)
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Git operation failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST: git mutations (stage, unstage, commit, push, pull, fetch, branch ops, stash ops)
export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const workspacePath = await resolveWorkspacePath(session.user.id, id)
  if (!workspacePath) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  const body = await request.json()
  const { action } = body

  if (!action || typeof action !== "string") {
    return NextResponse.json({ error: "action is required" }, { status: 400 })
  }

  try {
    switch (action) {
      case "stage": {
        const { files } = body
        if (!Array.isArray(files) || files.length === 0) {
          return NextResponse.json({ error: "files array required" }, { status: 400 })
        }
        await stageFiles(workspacePath, files)
        return NextResponse.json({ ok: true })
      }

      case "stage-all": {
        await stageAll(workspacePath)
        return NextResponse.json({ ok: true })
      }

      case "unstage": {
        const { files } = body
        if (!Array.isArray(files) || files.length === 0) {
          return NextResponse.json({ error: "files array required" }, { status: 400 })
        }
        await unstageFiles(workspacePath, files)
        return NextResponse.json({ ok: true })
      }

      case "unstage-all": {
        await unstageAll(workspacePath)
        return NextResponse.json({ ok: true })
      }

      case "discard": {
        const { files } = body
        if (!Array.isArray(files) || files.length === 0) {
          return NextResponse.json({ error: "files array required" }, { status: 400 })
        }
        await discardChanges(workspacePath, files)
        return NextResponse.json({ ok: true })
      }

      case "commit": {
        const { message } = body
        if (!message || typeof message !== "string") {
          return NextResponse.json({ error: "message is required" }, { status: 400 })
        }
        const hash = await commit(workspacePath, message)
        return NextResponse.json({ hash })
      }

      case "push": {
        const { remote = "origin", branch, setUpstream = false } = body
        const result = await push(workspacePath, remote, branch, setUpstream)
        return NextResponse.json({ result })
      }

      case "pull": {
        const { remote = "origin", branch } = body
        const result = await pull(workspacePath, remote, branch)
        return NextResponse.json({ result })
      }

      case "fetch": {
        const { remote = "origin", prune = false } = body
        await gitFetch(workspacePath, remote, prune)
        return NextResponse.json({ ok: true })
      }

      case "create-branch": {
        const { branchName, startPoint } = body
        if (!branchName || typeof branchName !== "string") {
          return NextResponse.json({ error: "branchName is required" }, { status: 400 })
        }
        await createBranch(workspacePath, branchName, startPoint)
        return NextResponse.json({ ok: true })
      }

      case "switch-branch": {
        const { branchName } = body
        if (!branchName || typeof branchName !== "string") {
          return NextResponse.json({ error: "branchName is required" }, { status: 400 })
        }
        await switchBranch(workspacePath, branchName)
        return NextResponse.json({ ok: true })
      }

      case "delete-branch": {
        const { branchName, force = false } = body
        if (!branchName || typeof branchName !== "string") {
          return NextResponse.json({ error: "branchName is required" }, { status: 400 })
        }
        await deleteBranch(workspacePath, branchName, force)
        return NextResponse.json({ ok: true })
      }

      case "stash-save": {
        const { message } = body
        await stashSave(workspacePath, message)
        return NextResponse.json({ ok: true })
      }

      case "stash-apply": {
        const { index = 0 } = body
        await stashApply(workspacePath, index)
        return NextResponse.json({ ok: true })
      }

      case "stash-pop": {
        const { index = 0 } = body
        await stashPop(workspacePath, index)
        return NextResponse.json({ ok: true })
      }

      case "stash-drop": {
        const { index } = body
        if (index === undefined || typeof index !== "number") {
          return NextResponse.json({ error: "index is required" }, { status: 400 })
        }
        await stashDrop(workspacePath, index)
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Git operation failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
