import simpleGit from "simple-git"
import { createHash } from "node:crypto"
import type { ReviewChangedFile, ReviewFileStatus, AllBranch } from "@/types"

function createGit(workspacePath: string) {
  return simpleGit(workspacePath)
}

const STATUS_MAP: Record<string, ReviewFileStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type-changed",
  U: "modified",
}

function parseStatusLetter(letter: string): ReviewFileStatus {
  // git --name-status outputs letters like R100, C050 — strip digits
  const clean = letter.replace(/\d+/g, "")
  return STATUS_MAP[clean] ?? "modified"
}

export async function getMergeBase(
  workspacePath: string,
  ref: string
): Promise<string> {
  const git = createGit(workspacePath)
  const result = await git.raw(["merge-base", "HEAD", ref])
  return result.trim()
}

export async function getChangedFiles(
  workspacePath: string,
  baseRef: string
): Promise<ReviewChangedFile[]> {
  const git = createGit(workspacePath)
  const output = await git.raw(["diff", "--name-status", baseRef])

  const files: ReviewChangedFile[] = []
  for (const line of output.trim().split("\n")) {
    if (!line) continue
    const parts = line.split("\t")
    const statusLetter = parts[0]
    const status = parseStatusLetter(statusLetter)

    if (status === "renamed" || status === "copied") {
      files.push({ path: parts[2], status, oldPath: parts[1] })
    } else {
      files.push({ path: parts[1], status })
    }
  }

  return files
}

export async function getUncommittedFiles(
  workspacePath: string
): Promise<ReviewChangedFile[]> {
  const git = createGit(workspacePath)
  const status = await git.status()
  const files: ReviewChangedFile[] = []
  const seen = new Set<string>()

  for (const file of status.files) {
    if (seen.has(file.path)) continue
    seen.add(file.path)

    const idx = file.index
    const wd = file.working_dir

    if (idx === "?" && wd === "?") {
      files.push({ path: file.path, status: "untracked" })
    } else if (idx === "A" || wd === "A") {
      files.push({ path: file.path, status: "added" })
    } else if (idx === "D" || wd === "D") {
      files.push({ path: file.path, status: "deleted" })
    } else if (idx === "R" || wd === "R") {
      files.push({ path: file.path, status: "renamed" })
    } else {
      files.push({ path: file.path, status: "modified" })
    }
  }

  return files
}

export async function getRefDiff(
  workspacePath: string,
  baseRef: string,
  filePath: string
): Promise<string> {
  const git = createGit(workspacePath)
  try {
    return await git.raw(["diff", baseRef, "--", filePath])
  } catch {
    // File may be untracked or binary
    return ""
  }
}

export async function getUncommittedDiff(
  workspacePath: string,
  filePath: string
): Promise<string> {
  const git = createGit(workspacePath)
  try {
    // Show both staged and unstaged changes combined vs HEAD
    return await git.raw(["diff", "HEAD", "--", filePath])
  } catch {
    // File may be untracked — show the file content as an addition
    try {
      const content = await git.raw(["show", `:${filePath}`])
      return content
    } catch {
      return ""
    }
  }
}

export async function computeDiffHash(
  workspacePath: string,
  baseRef: string,
  filePath: string
): Promise<string> {
  const git = createGit(workspacePath)
  try {
    const diff = await git.raw(["diff", baseRef, "--", filePath])
    return createHash("md5").update(diff).digest("hex")
  } catch {
    return createHash("md5").update("").digest("hex")
  }
}

export async function computeUncommittedDiffHash(
  workspacePath: string,
  filePath: string
): Promise<string> {
  const git = createGit(workspacePath)
  try {
    const diff = await git.raw(["diff", "HEAD", "--", filePath])
    return createHash("md5").update(diff).digest("hex")
  } catch {
    return createHash("md5").update("").digest("hex")
  }
}

export async function getAllBranches(
  workspacePath: string
): Promise<AllBranch[]> {
  const git = createGit(workspacePath)
  const branches: AllBranch[] = []

  const localResult = await git.branchLocal()
  for (const [name, info] of Object.entries(localResult.branches)) {
    branches.push({ name, isRemote: false, current: info.current })
  }

  try {
    const remoteOutput = await git.raw(["branch", "-r", "--format=%(refname:short)"])
    for (const line of remoteOutput.trim().split("\n")) {
      if (!line || line.includes("HEAD")) continue
      branches.push({ name: line.trim(), isRemote: true, current: false })
    }
  } catch {
    // No remotes configured
  }

  return branches
}

export async function getLastCommitRef(
  workspacePath: string
): Promise<string> {
  const git = createGit(workspacePath)
  const result = await git.raw(["rev-parse", "HEAD~1"])
  return result.trim()
}
