import simpleGit, { type SimpleGit } from "simple-git"
import type {
  GitStatusResult,
  GitLogEntry,
  GitBranch,
  GitStashEntry,
  GitDiffResult,
  GitFileStatus,
} from "@/types"

function createGit(workspacePath: string): SimpleGit {
  return simpleGit(workspacePath)
}

export async function getGitStatus(workspacePath: string): Promise<GitStatusResult> {
  const git = createGit(workspacePath)

  const isRepo = await git.checkIsRepo()
  if (!isRepo) {
    return {
      isRepo: false,
      branch: "",
      tracking: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
      lastCommit: null,
    }
  }

  const status = await git.status()

  const staged: GitFileStatus[] = []
  const unstaged: GitFileStatus[] = []

  for (const file of status.files) {
    if (file.index && file.index !== " " && file.index !== "?") {
      staged.push({ path: file.path, index: file.index, workingDir: file.working_dir })
    }
    if (file.working_dir && file.working_dir !== " " && file.working_dir !== "?") {
      unstaged.push({ path: file.path, index: file.index, workingDir: file.working_dir })
    }
  }

  let lastCommit: GitStatusResult["lastCommit"] = null
  try {
    const log = await git.log({ maxCount: 1 })
    if (log.latest) {
      lastCommit = {
        hash: log.latest.hash,
        message: log.latest.message,
        author: log.latest.author_name,
        date: log.latest.date,
      }
    }
  } catch {
    // empty repo with no commits
  }

  return {
    isRepo: true,
    branch: status.current ?? "",
    tracking: status.tracking ?? null,
    ahead: status.ahead,
    behind: status.behind,
    staged,
    unstaged,
    untracked: status.not_added,
    conflicted: status.conflicted,
    lastCommit,
  }
}

export async function stageFiles(workspacePath: string, files: string[]): Promise<void> {
  const git = createGit(workspacePath)
  await git.add(files)
}

export async function stageAll(workspacePath: string): Promise<void> {
  const git = createGit(workspacePath)
  await git.add(".")
}

export async function unstageFiles(workspacePath: string, files: string[]): Promise<void> {
  const git = createGit(workspacePath)
  await git.reset(["HEAD", "--", ...files])
}

export async function unstageAll(workspacePath: string): Promise<void> {
  const git = createGit(workspacePath)
  await git.reset(["HEAD"])
}

export async function discardChanges(workspacePath: string, files: string[]): Promise<void> {
  const git = createGit(workspacePath)
  await git.checkout(["--", ...files])
}

export async function commit(workspacePath: string, message: string): Promise<string> {
  const git = createGit(workspacePath)
  const result = await git.commit(message)
  return result.commit
}

export async function getLog(
  workspacePath: string,
  maxCount: number = 50
): Promise<GitLogEntry[]> {
  const git = createGit(workspacePath)

  try {
    const log = await git.log({
      maxCount,
      format: {
        hash: "%H",
        abbrevHash: "%h",
        message: "%s",
        body: "%b",
        author: "%an",
        authorEmail: "%ae",
        date: "%aI",
        refs: "%D",
      },
    })

    return log.all.map((entry) => ({
      hash: entry.hash,
      abbrevHash: entry.abbrevHash ?? entry.hash.slice(0, 7),
      message: entry.message,
      body: entry.body,
      author: entry.author ?? "",
      authorEmail: entry.authorEmail ?? "",
      date: entry.date,
      refs: entry.refs ?? "",
    }))
  } catch {
    return []
  }
}

export async function getDiff(
  workspacePath: string,
  file: string,
  staged: boolean
): Promise<string> {
  const git = createGit(workspacePath)
  const args = staged ? ["--cached", "--", file] : ["--", file]
  return git.diff(args)
}

export async function getFileDiffs(
  workspacePath: string,
  staged: boolean
): Promise<GitDiffResult[]> {
  const git = createGit(workspacePath)
  const args = staged ? ["--cached", "--numstat"] : ["--numstat"]
  const numstat = await git.diff(args)

  const results: GitDiffResult[] = []
  for (const line of numstat.trim().split("\n")) {
    if (!line) continue
    const [addStr, delStr, file] = line.split("\t")
    const isBinary = addStr === "-"
    results.push({
      file,
      diff: "",
      additions: isBinary ? 0 : parseInt(addStr, 10),
      deletions: isBinary ? 0 : parseInt(delStr, 10),
      isBinary,
    })
  }

  return results
}

export async function getCommitDiff(workspacePath: string, hash: string): Promise<string> {
  const git = createGit(workspacePath)
  return git.diff([`${hash}~1`, hash])
}

export async function getBranches(workspacePath: string): Promise<GitBranch[]> {
  const git = createGit(workspacePath)
  const summary = await git.branchLocal()

  return Object.entries(summary.branches).map(([name, info]) => ({
    name,
    current: info.current,
    commit: info.commit,
    label: info.label,
    linkedWorkTree: info.linkedWorkTree ?? false,
  }))
}

export async function createBranch(
  workspacePath: string,
  branchName: string,
  startPoint?: string
): Promise<void> {
  const git = createGit(workspacePath)
  if (startPoint) {
    await git.checkoutBranch(branchName, startPoint)
  } else {
    await git.checkoutLocalBranch(branchName)
  }
}

export async function switchBranch(workspacePath: string, branchName: string): Promise<void> {
  const git = createGit(workspacePath)
  await git.checkout(branchName)
}

export async function deleteBranch(
  workspacePath: string,
  branchName: string,
  force: boolean = false
): Promise<void> {
  const git = createGit(workspacePath)
  await git.deleteLocalBranch(branchName, force)
}

export async function push(
  workspacePath: string,
  remote: string = "origin",
  branch?: string,
  setUpstream: boolean = false
): Promise<string> {
  const git = createGit(workspacePath)
  const args: string[] = []
  if (setUpstream) args.push("-u")
  args.push(remote)
  if (branch) args.push(branch)
  await git.push(args)
  return "ok"
}

export async function pull(
  workspacePath: string,
  remote: string = "origin",
  branch?: string
): Promise<string> {
  const git = createGit(workspacePath)
  const result = await git.pull(remote, branch)
  return result.summary.changes > 0
    ? `${result.summary.changes} changes, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions`
    : "Already up to date"
}

export async function fetch(
  workspacePath: string,
  remote: string = "origin",
  prune: boolean = false
): Promise<void> {
  const git = createGit(workspacePath)
  const args = prune ? ["--prune", remote] : [remote]
  await git.fetch(args)
}

export async function stashSave(workspacePath: string, message?: string): Promise<void> {
  const git = createGit(workspacePath)
  if (message) {
    await git.stash(["push", "-m", message])
  } else {
    await git.stash(["push"])
  }
}

export async function stashList(workspacePath: string): Promise<GitStashEntry[]> {
  const git = createGit(workspacePath)
  const result = await git.stashList()

  return result.all.map((entry, index) => ({
    index,
    hash: entry.hash,
    message: entry.message,
    date: entry.date,
  }))
}

export async function stashApply(workspacePath: string, index: number = 0): Promise<void> {
  const git = createGit(workspacePath)
  await git.stash(["apply", `stash@{${index}}`])
}

export async function stashPop(workspacePath: string, index: number = 0): Promise<void> {
  const git = createGit(workspacePath)
  await git.stash(["pop", `stash@{${index}}`])
}

export async function stashDrop(workspacePath: string, index: number): Promise<void> {
  const git = createGit(workspacePath)
  await git.stash(["drop", `stash@{${index}}`])
}
