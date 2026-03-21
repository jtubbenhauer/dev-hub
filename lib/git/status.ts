import simpleGit from "simple-git";
import type { FileGitStatus } from "@/types";

async function findDefaultBranch(
  git: ReturnType<typeof simpleGit>,
): Promise<string | null> {
  for (const candidate of ["main", "master"]) {
    try {
      await git.raw(["rev-parse", "--verify", candidate]);
      return candidate;
    } catch {
      // branch doesn't exist
    }
  }
  return null;
}

export async function getFileStatuses(
  workspacePath: string,
): Promise<Map<string, FileGitStatus>> {
  const statuses = new Map<string, FileGitStatus>();

  try {
    const git = simpleGit(workspacePath);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return statuses;

    const status = await git.status();

    for (const file of status.staged) {
      statuses.set(file, "staged");
    }
    for (const file of status.modified) {
      if (!statuses.has(file)) {
        statuses.set(file, "modified");
      }
    }
    for (const file of status.not_added) {
      statuses.set(file, "untracked");
    }
    for (const file of status.deleted) {
      statuses.set(file, "deleted");
    }
    for (const file of status.renamed.map((r) => r.to)) {
      statuses.set(file, "renamed");
    }
    for (const file of status.conflicted) {
      statuses.set(file, "conflicted");
    }
    for (const file of status.created) {
      if (!statuses.has(file)) {
        statuses.set(file, "added");
      }
    }

    const defaultBranch = await findDefaultBranch(git);
    if (defaultBranch) {
      const currentBranch = status.current;
      if (currentBranch && currentBranch !== defaultBranch) {
        try {
          const mergeBase = (
            await git.raw(["merge-base", "HEAD", defaultBranch])
          ).trim();
          const diffOutput = await git.raw([
            "diff",
            "--name-only",
            mergeBase,
            "HEAD",
          ]);
          for (const line of diffOutput.trim().split("\n")) {
            const file = line.trim();
            if (file && !statuses.has(file)) {
              statuses.set(file, "committed");
            }
          }
        } catch {
          // merge-base or diff failed (e.g. no common ancestor)
        }
      }
    }
  } catch {
    // Not a git repo or git not available
  }

  return statuses;
}
