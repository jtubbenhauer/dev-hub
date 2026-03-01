export interface Workspace {
  id: string
  userId: string
  name: string
  path: string
  type: "repo" | "worktree"
  parentRepoPath: string | null
  packageManager: "pnpm" | "npm" | "bun" | "cargo" | "go" | "none" | null
  quickCommands: QuickCommand[] | null
  createdAt: Date
  lastAccessedAt: Date
}

export interface QuickCommand {
  label: string
  command: string
}

export interface WorkspaceCreateInput {
  name: string
  path: string
  type: "repo" | "worktree"
  parentRepoPath?: string
}

export interface SystemStats {
  cpu: {
    usage: number
    cores: number
    model: string
  }
  memory: {
    total: number
    used: number
    free: number
    usagePercent: number
  }
  disk: {
    total: number
    used: number
    free: number
    usagePercent: number
  }
  uptime: number
}

export interface GitStatus {
  branch: string
  ahead: number
  behind: number
  staged: string[]
  unstaged: string[]
  untracked: string[]
  lastCommitMessage: string
  lastCommitDate: string
}

export interface FileTreeEntry {
  name: string
  path: string
  type: "file" | "directory"
  size?: number
  children?: FileTreeEntry[]
  gitStatus?: FileGitStatus
}

export type FileGitStatus =
  | "modified"
  | "staged"
  | "untracked"
  | "deleted"
  | "renamed"
  | "conflicted"
  | "added"

export interface OpenFile {
  path: string
  name: string
  content: string
  language: string
  isDirty: boolean
  originalContent: string
}

export interface GitFileStatus {
  path: string
  index: string
  workingDir: string
}

export interface GitStatusResult {
  isRepo: boolean
  branch: string
  tracking: string | null
  ahead: number
  behind: number
  staged: GitFileStatus[]
  unstaged: GitFileStatus[]
  untracked: string[]
  conflicted: string[]
  lastCommit: {
    hash: string
    message: string
    author: string
    date: string
  } | null
}

export interface GitLogEntry {
  hash: string
  abbrevHash: string
  message: string
  body: string
  author: string
  authorEmail: string
  date: string
  refs: string
}

export interface GitBranch {
  name: string
  current: boolean
  commit: string
  label: string
  linkedWorkTree: boolean
}

export interface GitStashEntry {
  index: number
  hash: string
  message: string
  date: string
}

export interface GitDiffResult {
  file: string
  diff: string
  additions: number
  deletions: number
  isBinary: boolean
}

export type ReviewMode = "branch" | "uncommitted" | "last-commit"

export type ReviewFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "untracked"

export interface ReviewFile {
  id: number
  reviewId: string
  path: string
  status: ReviewFileStatus
  oldPath: string | null
  reviewed: boolean
  diffHash: string | null
  reviewedAt: Date | null
}

export interface Review {
  id: string
  workspaceId: string
  mode: ReviewMode
  targetRef: string | null
  baseRef: string | null
  mergeBase: string | null
  totalFiles: number
  reviewedFiles: number
  createdAt: Date
  updatedAt: Date
}

export interface ReviewWithFiles extends Review {
  files: ReviewFile[]
}

export interface ReviewCreateInput {
  workspaceId: string
  mode: ReviewMode
  targetRef?: string
}

export interface ReviewChangedFile {
  path: string
  status: ReviewFileStatus
  oldPath?: string
}

export interface AllBranch {
  name: string
  isRemote: boolean
  current: boolean
}

export interface ReviewFileContent {
  original: string
  current: string
  path: string
  language: string
}
