import simpleGit from "simple-git"
import type { FileGitStatus } from "@/types"

export async function getFileStatuses(
  workspacePath: string
): Promise<Map<string, FileGitStatus>> {
  const statuses = new Map<string, FileGitStatus>()

  try {
    const git = simpleGit(workspacePath)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) return statuses

    const status = await git.status()

    for (const file of status.staged) {
      statuses.set(file, "staged")
    }
    for (const file of status.modified) {
      if (!statuses.has(file)) {
        statuses.set(file, "modified")
      }
    }
    for (const file of status.not_added) {
      statuses.set(file, "untracked")
    }
    for (const file of status.deleted) {
      statuses.set(file, "deleted")
    }
    for (const file of status.renamed.map((r) => r.to)) {
      statuses.set(file, "renamed")
    }
    for (const file of status.conflicted) {
      statuses.set(file, "conflicted")
    }
    for (const file of status.created) {
      if (!statuses.has(file)) {
        statuses.set(file, "added")
      }
    }
  } catch {
    // Not a git repo or git not available
  }

  return statuses
}
