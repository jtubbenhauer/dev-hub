import simpleGit from "simple-git"
import path from "node:path"
import fs from "node:fs"
import type { WorktreeInfo } from "@/types"

function createGit(workspacePath: string) {
  return simpleGit(workspacePath)
}

/**
 * List all worktrees for a git repository.
 * Parses `git worktree list --porcelain` output.
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const git = createGit(repoPath)
  const output = await git.raw(["worktree", "list", "--porcelain"])

  const worktrees: WorktreeInfo[] = []
  let current: Partial<WorktreeInfo> = {}

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) {
        worktrees.push(finalizeWorktree(current, repoPath))
      }
      current = { path: line.slice("worktree ".length).trim() }
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim()
    } else if (line.startsWith("branch ")) {
      // branch refs/heads/main -> main
      current.branch = line.slice("branch ".length).trim().replace("refs/heads/", "")
    } else if (line === "bare") {
      current.isBare = true
    } else if (line === "detached") {
      current.isDetached = true
    } else if (line === "" && current.path) {
      worktrees.push(finalizeWorktree(current, repoPath))
      current = {}
    }
  }

  // Handle last entry if no trailing newline
  if (current.path) {
    worktrees.push(finalizeWorktree(current, repoPath))
  }

  return worktrees
}

function finalizeWorktree(partial: Partial<WorktreeInfo>, repoPath: string): WorktreeInfo {
  const resolvedRepo = path.resolve(repoPath)
  const resolvedPath = path.resolve(partial.path ?? "")
  return {
    path: partial.path ?? "",
    branch: partial.branch ?? "",
    head: partial.head ?? "",
    isMain: resolvedPath === resolvedRepo,
    isBare: partial.isBare ?? false,
    isDetached: partial.isDetached ?? false,
  }
}

/**
 * Compute the default worktree base directory.
 * For a repo at `/home/user/dev/my-repo`, worktrees go in `/home/user/dev/my-repo-worktrees/`.
 */
export function getWorktreeBaseDir(repoPath: string): string {
  const resolved = path.resolve(repoPath)
  return `${resolved}-worktrees`
}

/**
 * Add a new worktree for a repository.
 *
 * @param repoPath - Path to the parent git repository
 * @param branch - Branch name (existing or new)
 * @param newBranch - Whether to create a new branch
 * @param basePath - Override the default worktree base directory
 * @param startPoint - For new branches, the starting commit/ref (defaults to HEAD)
 * @returns The absolute path to the new worktree
 */
export async function addWorktree(
  repoPath: string,
  branch: string,
  newBranch: boolean,
  basePath?: string,
  startPoint?: string
): Promise<string> {
  const git = createGit(repoPath)

  // Determine where to put the worktree
  const baseDir = basePath ?? getWorktreeBaseDir(repoPath)
  const worktreePath = path.join(baseDir, branch)

  // Ensure base directory exists
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true })
  }

  // Check if worktree path already exists
  if (fs.existsSync(worktreePath)) {
    throw new Error(`Directory already exists: ${worktreePath}`)
  }

  // Build git worktree add command
  const args = ["worktree", "add"]
  if (newBranch) {
    args.push("-b", branch)
    args.push(worktreePath)
    if (startPoint) {
      args.push(startPoint)
    }
  } else {
    args.push(worktreePath, branch)
  }

  await git.raw(args)

  return worktreePath
}

/**
 * Remove a worktree (prunes it from git and optionally deletes the directory).
 *
 * @param repoPath - Path to the parent git repository
 * @param worktreePath - Path to the worktree to remove
 * @param force - Force removal even if worktree is dirty
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force: boolean = false
): Promise<void> {
  const git = createGit(repoPath)

  const args = ["worktree", "remove"]
  if (force) args.push("--force")
  args.push(worktreePath)

  await git.raw(args)
}

/**
 * Prune stale worktree references (e.g., after manually deleting a worktree directory).
 */
export async function pruneWorktrees(repoPath: string): Promise<void> {
  const git = createGit(repoPath)
  await git.raw(["worktree", "prune"])
}
