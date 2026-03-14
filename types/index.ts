export type {
  FileTreeEntry,
  FileGitStatus,
  GitFileStatus,
  GitStatusResult,
  GitLogEntry,
  GitBranch,
  GitStashEntry,
  GitDiffResult,
  ReviewFileStatus,
  ReviewChangedFile,
  AllBranch,
  WorktreeInfo,
} from "@devhub/shared"

export type WorkspaceBackendType = "local" | "remote"

export interface LinkedTaskMeta {
  name: string
  customId: string | null
  url: string
  status: string
  provider: "clickup"
}

export interface Workspace {
  id: string
  userId: string
  name: string
  path: string
  type: "repo" | "worktree"
  parentRepoPath: string | null
  packageManager: "pnpm" | "npm" | "bun" | "cargo" | "go" | "none" | null
  quickCommands: QuickCommand[] | null
  backend: WorkspaceBackendType
  provider: string | null
  opencodeUrl: string | null
  agentUrl: string | null
  providerMeta: Record<string, unknown> | null
  worktreeSymlinks: string[] | null
  linkedTaskId: string | null
  linkedTaskMeta: LinkedTaskMeta | null
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
  backend?: WorkspaceBackendType
  provider?: string
  opencodeUrl?: string
  agentUrl?: string
  providerMeta?: Record<string, unknown>
  linkedTaskId?: string
  linkedTaskMeta?: LinkedTaskMeta
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

export interface OpenFile {
  path: string
  name: string
  content: string
  language: string
  isDirty: boolean
  originalContent: string
}

export type ReviewMode = "branch" | "uncommitted" | "last-commit"

import type { ReviewFileStatus } from "@devhub/shared"

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

export interface ReviewFileContent {
  original: string
  current: string
  path: string
  language: string
}

// Worktree types

export interface WorktreeCreateInput {
  parentRepoPath: string
  branch: string
  newBranch: boolean
  basePath?: string // override default sibling dir location
  startPoint?: string // for new branches, which commit/branch to start from
  symlinkPaths?: string[]
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

// ClickUp types

export interface ClickUpUser {
  id: number
  username: string
  email: string
  color: string
  profilePicture: string | null
  initials: string
}

export interface ClickUpTaskStatus {
  status: string
  color: string
  type: string
}

export interface ClickUpPriority {
  id: string
  priority: "urgent" | "high" | "normal" | "low"
  color: string
}

export interface ClickUpTag {
  name: string
  tag_fg: string
  tag_bg: string
}

export interface ClickUpTask {
  id: string
  custom_id: string | null
  name: string
  status: ClickUpTaskStatus
  priority: ClickUpPriority | null
  assignees: ClickUpUser[]
  due_date: string | null
  date_created: string
  date_updated: string
  date_closed: string | null
  url: string
  list: { id: string; name: string }
  folder: { id: string; name: string }
  space: { id: string }
  tags: ClickUpTag[]
  custom_fields?: ClickUpCustomField[]
}

export interface ClickUpTeam {
  id: string
  name: string
  color: string
  avatar: string | null
}

export interface ClickUpList {
  id: string
  name: string
  task_count?: number
}

export interface ClickUpFolder {
  id: string
  name: string
  lists: ClickUpList[]
}

export interface ClickUpSpace {
  id: string
  name: string
  color: string | null
  folders: ClickUpFolder[]
  lists: ClickUpList[]
}

export interface ClickUpView {
  id: string
  name: string
  type: string
  parent: { id: string; type: number }
}

export interface ClickUpCustomField {
  id: string
  name: string
  type: string
  value: unknown
  type_config?: Record<string, unknown>
}

export interface ClickUpTaskDetail extends ClickUpTask {
  markdown_description: string | null
  text_content: string | null
  custom_fields: ClickUpCustomField[]
  time_estimate: number | null
  time_spent: number | null
  parent: string | null
  subtasks?: ClickUpTask[]
}

export interface ClickUpComment {
  id: string
  comment_text: string
  user: ClickUpUser
  date: string
  resolved: boolean
}

export interface ClickUpPinnedView {
  id: string
  name: string
}

// GitHub types

export interface GitHubUser {
  login: string
  id: number
  avatar_url: string
  html_url: string
  name: string | null
}

export interface GitHubLabel {
  id: number
  name: string
  color: string
  description: string | null
}

export interface GitHubPullRequest {
  number: number
  title: string
  body: string | null
  state: "open" | "closed"
  draft: boolean
  html_url: string
  created_at: string
  updated_at: string
  user: GitHubUser
  head: {
    label: string
    ref: string
    sha: string
    repo: { full_name: string; name: string; owner: { login: string } } | null
  }
  base: {
    label: string
    ref: string
    sha: string
    repo: { full_name: string; name: string; owner: { login: string } }
  }
  labels: GitHubLabel[]
  requested_reviewers: GitHubUser[]
  review_comments: number
  comments: number
  additions: number
  deletions: number
  changed_files: number
  mergeable: boolean | null
  mergeable_state: string
  merge_commit_sha: string | null
}

export type GitHubPullRequestFileStatus =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged"

export interface GitHubPullRequestFile {
  sha: string
  filename: string
  status: GitHubPullRequestFileStatus
  additions: number
  deletions: number
  changes: number
  patch?: string
  previous_filename?: string
  blob_url: string
  raw_url: string
  contents_url: string
}

export interface GitHubReviewComment {
  id: number
  body: string
  path: string
  // line is the line number in the file the comment is on (right side / new file)
  line: number | null
  // start_line is set for multi-line comments
  start_line: number | null
  side: "LEFT" | "RIGHT"
  start_side: "LEFT" | "RIGHT" | null
  original_line: number | null
  original_start_line: number | null
  diff_hunk: string
  commit_id: string
  original_commit_id: string
  created_at: string
  updated_at: string
  user: GitHubUser
  html_url: string
  in_reply_to_id?: number
}

export type GitHubReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT"

export interface GitHubReview {
  id: number
  body: string | null
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING"
  submitted_at: string | null
  user: GitHubUser
  html_url: string
}

export interface GitHubPrFileContent {
  original: string
  current: string
  path: string
  language: string
  patch: string | undefined
}

export type GitHubMergeMethod = "merge" | "squash" | "rebase"

export type GitHubCheckStatus = "queued" | "in_progress" | "completed"

export type GitHubCheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | null

export interface GitHubCheckRun {
  id: number
  name: string
  status: GitHubCheckStatus
  conclusion: GitHubCheckConclusion
  html_url: string
  started_at: string | null
  completed_at: string | null
}

// Workspace Provider types

export interface WorkspaceProvider {
  id: string
  name: string
  binaryPath: string
  commands: {
    create: string
    destroy: string
    status: string
  }
}

export interface WorkspaceProviderCreateResult {
  id: string
  endpoints: {
    opencode: string
    agent: string
  }
  metadata: Record<string, unknown>
}
