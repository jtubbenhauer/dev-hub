// File system types

export interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: FileTreeEntry[];
  gitStatus?: FileGitStatus;
}

export type FileGitStatus =
  | "modified"
  | "staged"
  | "untracked"
  | "deleted"
  | "renamed"
  | "conflicted"
  | "added"
  | "committed";

// Git types

export interface GitFileStatus {
  path: string;
  index: string;
  workingDir: string;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string;
  tracking: string | null;
  ahead: number;
  behind: number;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: string[];
  conflicted: string[];
  lastCommit: {
    hash: string;
    message: string;
    author: string;
    date: string;
  } | null;
}

export interface GitLogEntry {
  hash: string;
  abbrevHash: string;
  message: string;
  body: string;
  author: string;
  authorEmail: string;
  date: string;
  refs: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  commit: string;
  label: string;
  linkedWorkTree: boolean;
}

export interface GitStashEntry {
  index: number;
  hash: string;
  message: string;
  date: string;
}

export interface GitDiffResult {
  file: string;
  diff: string;
  additions: number;
  deletions: number;
  isBinary: boolean;
}

// Review types

export type ReviewFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "untracked";

export interface ReviewChangedFile {
  path: string;
  status: ReviewFileStatus;
  oldPath?: string;
}

export interface AllBranch {
  name: string;
  isRemote: boolean;
  current: boolean;
}

// Worktree types

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  isBare: boolean;
  isDetached: boolean;
}
