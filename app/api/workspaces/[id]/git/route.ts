import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { workspaces } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getLanguageFromFilename } from "@/lib/files/operations";
import { getBackend, toWorkspace } from "@/lib/workspaces/backend";
import type { Workspace } from "@/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function resolveWorkspace(
  userId: string,
  workspaceId: string,
): Promise<Workspace | null> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)));

  return row ? toWorkspace(row) : null;
}

// GET: git status, log, branches, diff, stash list
export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const workspace = await resolveWorkspace(session.user.id, id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const backend = getBackend(workspace);
  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "status";

  try {
    switch (action) {
      case "status": {
        const status = await backend.getGitStatus();
        return NextResponse.json(status);
      }

      case "log": {
        const maxCount = parseInt(url.searchParams.get("maxCount") ?? "50", 10);
        const branchOnly = url.searchParams.get("branchOnly") === "true";

        let baseRef: string | undefined;
        if (branchOnly) {
          try {
            const defaultBranch = await backend.getDefaultBranch();
            if (defaultBranch) {
              baseRef = await backend.getMergeBase(defaultBranch);
            }
          } catch {
            // merge-base can fail if branch has no common ancestor — fall back to full log
          }
        }

        const log = await backend.getLog(maxCount, baseRef);
        return NextResponse.json(log);
      }

      case "branches": {
        const branches = await backend.getBranches();
        return NextResponse.json(branches);
      }

      case "remotes": {
        const remotes = await backend.getRemotes();
        return NextResponse.json(remotes);
      }

      case "diff": {
        const file = url.searchParams.get("file");
        const staged = url.searchParams.get("staged") === "true";
        if (!file) {
          return NextResponse.json(
            { error: "file parameter required" },
            { status: 400 },
          );
        }
        const diff = await backend.getDiff(file, staged);
        return NextResponse.json({ diff });
      }

      case "commit-diff": {
        const hash = url.searchParams.get("hash");
        if (!hash) {
          return NextResponse.json(
            { error: "hash parameter required" },
            { status: 400 },
          );
        }
        const diff = await backend.getCommitDiff(hash);
        return NextResponse.json({ diff });
      }

      case "stash-list": {
        const stashes = await backend.stashList();
        return NextResponse.json(stashes);
      }

      case "file-content": {
        const file = url.searchParams.get("file");
        const staged = url.searchParams.get("staged") === "true";
        const baseRef = url.searchParams.get("baseRef");
        const currentRef = url.searchParams.get("currentRef");
        if (!file) {
          return NextResponse.json(
            { error: "file parameter required" },
            { status: 400 },
          );
        }
        const language = getLanguageFromFilename(file);

        // Ref-based mode (branch comparison or last-commit): baseRef required, currentRef optional
        if (baseRef) {
          const original = await backend.getContentAtRef(baseRef, file);
          const current = currentRef
            ? await backend.getContentAtRef(currentRef, file)
            : await backend.getCurrentContent(file);
          return NextResponse.json({ original, current, path: file, language });
        }

        // Working changes mode: HEAD vs staged index or working tree
        const original = await backend.getOriginalContent(file);
        const current = staged
          ? await backend.getStagedContent(file)
          : await backend.getCurrentContent(file);
        return NextResponse.json({ original, current, path: file, language });
      }

      case "changed-files": {
        const baseRef = url.searchParams.get("baseRef");
        if (!baseRef) {
          return NextResponse.json(
            { error: "baseRef parameter required" },
            { status: 400 },
          );
        }
        const files = await backend.getChangedFiles(baseRef);
        return NextResponse.json(files);
      }

      case "worktree-list": {
        const worktrees = await backend.listWorktrees();
        return NextResponse.json(worktrees);
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Git operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: git mutations (stage, unstage, commit, push, pull, fetch, branch ops, stash ops)
export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const workspace = await resolveWorkspace(session.user.id, id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const backend = getBackend(workspace);
  const body = await request.json();
  const { action } = body;

  if (!action || typeof action !== "string") {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  try {
    switch (action) {
      case "stage": {
        const { files } = body;
        if (!Array.isArray(files) || files.length === 0) {
          return NextResponse.json(
            { error: "files array required" },
            { status: 400 },
          );
        }
        await backend.stageFiles(files);
        return NextResponse.json({ ok: true });
      }

      case "stage-all": {
        await backend.stageAll();
        return NextResponse.json({ ok: true });
      }

      case "unstage": {
        const { files } = body;
        if (!Array.isArray(files) || files.length === 0) {
          return NextResponse.json(
            { error: "files array required" },
            { status: 400 },
          );
        }
        await backend.unstageFiles(files);
        return NextResponse.json({ ok: true });
      }

      case "unstage-all": {
        await backend.unstageAll();
        return NextResponse.json({ ok: true });
      }

      case "discard": {
        const { files } = body;
        if (!Array.isArray(files) || files.length === 0) {
          return NextResponse.json(
            { error: "files array required" },
            { status: 400 },
          );
        }
        await backend.discardChanges(files);
        return NextResponse.json({ ok: true });
      }

      case "commit": {
        const { message } = body;
        if (!message || typeof message !== "string") {
          return NextResponse.json(
            { error: "message is required" },
            { status: 400 },
          );
        }
        const hash = await backend.commit(message);
        return NextResponse.json({ hash });
      }

      case "push": {
        const { remote = "origin", branch, setUpstream = false } = body;
        const result = await backend.push(remote, branch, setUpstream);
        return NextResponse.json({ result });
      }

      case "pull": {
        const { remote = "origin", branch } = body;
        const result = await backend.pull(remote, branch);
        return NextResponse.json({ result });
      }

      case "fetch": {
        const { remote = "origin", prune = false } = body;
        await backend.fetch(remote, prune);
        return NextResponse.json({ ok: true });
      }

      case "create-branch": {
        const { branchName, startPoint } = body;
        if (!branchName || typeof branchName !== "string") {
          return NextResponse.json(
            { error: "branchName is required" },
            { status: 400 },
          );
        }
        await backend.createBranch(branchName, startPoint);
        return NextResponse.json({ ok: true });
      }

      case "switch-branch": {
        const { branchName } = body;
        if (!branchName || typeof branchName !== "string") {
          return NextResponse.json(
            { error: "branchName is required" },
            { status: 400 },
          );
        }
        await backend.switchBranch(branchName);
        return NextResponse.json({ ok: true });
      }

      case "delete-branch": {
        const { branchName, force = false } = body;
        if (!branchName || typeof branchName !== "string") {
          return NextResponse.json(
            { error: "branchName is required" },
            { status: 400 },
          );
        }
        await backend.deleteBranch(branchName, force);
        return NextResponse.json({ ok: true });
      }

      case "stash-save": {
        const { message } = body;
        await backend.stashSave(message);
        return NextResponse.json({ ok: true });
      }

      case "stash-apply": {
        const { index = 0 } = body;
        await backend.stashApply(index);
        return NextResponse.json({ ok: true });
      }

      case "stash-pop": {
        const { index = 0 } = body;
        await backend.stashPop(index);
        return NextResponse.json({ ok: true });
      }

      case "stash-drop": {
        const { index } = body;
        if (index === undefined || typeof index !== "number") {
          return NextResponse.json(
            { error: "index is required" },
            { status: 400 },
          );
        }
        await backend.stashDrop(index);
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Git operation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
