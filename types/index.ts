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

export interface CpuStats {
  usage: number
  cores: number
  model: string
  speed: number // GHz
  temperature?: number // °C, if available
}

export interface MemoryStats {
  total: number // bytes
  used: number
  free: number
  usagePercent: number
  swapTotal: number
  swapUsed: number
  swapPercent: number
}

export interface DiskStats {
  mount: string
  type: string
  size: number // bytes
  used: number
  available: number
  usagePercent: number
}

export interface NetworkStats {
  iface: string
  rxSec: number // bytes/sec
  txSec: number // bytes/sec
}

export interface ProcessInfo {
  pid: number
  name: string
  cpu: number // % of total
  memory: number // % of total
  memRss: number // bytes
  user: string
  command: string
}

export interface SystemStats {
  cpu: CpuStats
  memory: MemoryStats
  disks: DiskStats[]
  network: NetworkStats[]
  processes: ProcessInfo[]
  uptime: number // seconds
  timestamp: number // Date.now()
}

export interface SystemStatsHistory {
  timestamps: number[]
  cpu: number[] // usage % series
  memory: number[] // usage % series
  networkRx: number[] // bytes/sec series
  networkTx: number[] // bytes/sec series
}

export interface SystemStatsWithHistory {
  current: SystemStats
  history: SystemStatsHistory
}

export interface QuickAction {
  id: string
  label: string
  icon: string // lucide icon name
  type: "navigate" | "api"
  target: string // path for navigate, action key for api
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

// Worktree types

export interface WorktreeInfo {
  path: string
  branch: string
  head: string
  isMain: boolean
  isBare: boolean
  isDetached: boolean
}

export interface WorktreeCreateInput {
  parentRepoPath: string
  branch: string
  newBranch: boolean
  basePath?: string // override default sibling dir location
  startPoint?: string // for new branches, which commit/branch to start from
}

export interface WorktreeCreateResult {
  worktreePath: string
  branch: string
  workspace: Workspace
}

// Clone types

export interface CloneRepoInput {
  url: string
  targetDir?: string // override clone destination (defaults to ~/dev/<repo-name>)
  name?: string // display name for the workspace
  depth?: number // shallow clone depth (omit for full clone)
}

export interface CloneRepoResult {
  clonePath: string
  workspace: Workspace
}
