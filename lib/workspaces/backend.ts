import type {
  Workspace,
  QuickCommand,
  LinkedTaskMeta,
  FileTreeEntry,
  FileGitStatus,
  GitStatusResult,
  GitLogEntry,
  GitBranch,
  GitStashEntry,
  GitDiffResult,
  ReviewChangedFile,
  AllBranch,
  WorktreeInfo,
} from "@/types";
import type { workspaces } from "@/drizzle/schema";
import simpleGit from "simple-git";

type WorkspaceRow = typeof workspaces.$inferSelect;

import {
  readFileContent,
  writeFileContent,
  readDirectoryTree,
} from "@/lib/files/operations";
import {
  getGitStatus,
  getLog,
  getDefaultBranch,
  getDiff,
  getFileDiffs,
  getCommitDiff,
  getBranches,
  stageFiles,
  stageAll,
  unstageFiles,
  unstageAll,
  discardChanges,
  commit,
  push,
  pull,
  fetch,
  createBranch,
  switchBranch,
  deleteBranch,
  stashList,
  stashSave,
  stashApply,
  stashPop,
  stashDrop,
} from "@/lib/git/operations";
import { getFileStatuses } from "@/lib/git/status";
import {
  getOriginalContent,
  getCurrentContent,
  getContentAtRef,
  getStagedContent,
  getChangedFiles,
  getUncommittedFiles,
  getRefDiff,
  getUncommittedDiff,
  getMergeBase,
  getAllBranches,
  computeDiffHash,
  computeUncommittedDiffHash,
  getLastCommitRef,
} from "@/lib/git/review";
import {
  listWorktrees,
  addWorktree,
  removeWorktree,
} from "@/lib/git/worktrees";

export interface WorkspaceBackend {
  // Files
  readFile(filePath: string): Promise<{ content: string; size: number }>;
  writeFile(filePath: string, content: string): Promise<void>;
  listDirectory(dirPath: string, depth?: number): Promise<FileTreeEntry[]>;
  getFileStatuses(): Promise<Map<string, FileGitStatus>>;

  // Git core
  getGitStatus(): Promise<GitStatusResult>;
  getLog(maxCount?: number, baseRef?: string): Promise<GitLogEntry[]>;
  getDefaultBranch(): Promise<string | null>;
  getDiff(file: string, staged: boolean): Promise<string>;
  getFileDiffs(staged: boolean): Promise<GitDiffResult[]>;
  getCommitDiff(hash: string): Promise<string>;
  getBranches(): Promise<GitBranch[]>;
  getAllBranches(): Promise<AllBranch[]>;
  getRemotes(): Promise<{ name: string; fetchUrl: string; pushUrl: string }[]>;

  // Git staging
  stageFiles(files: string[]): Promise<void>;
  stageAll(): Promise<void>;
  unstageFiles(files: string[]): Promise<void>;
  unstageAll(): Promise<void>;
  discardChanges(files: string[]): Promise<void>;

  // Git commit/remote
  commit(message: string): Promise<string>;
  push(
    remote?: string,
    branch?: string,
    setUpstream?: boolean,
  ): Promise<string>;
  pull(remote?: string, branch?: string): Promise<string>;
  fetch(remote?: string, prune?: boolean): Promise<void>;

  // Git branches
  createBranch(name: string, startPoint?: string): Promise<void>;
  switchBranch(name: string): Promise<void>;
  deleteBranch(name: string, force?: boolean): Promise<void>;

  // Git stash
  stashList(): Promise<GitStashEntry[]>;
  stashSave(message?: string): Promise<void>;
  stashApply(index?: number): Promise<void>;
  stashPop(index?: number): Promise<void>;
  stashDrop(index: number): Promise<void>;

  // Review helpers
  getOriginalContent(filePath: string): Promise<string>;
  getCurrentContent(filePath: string): Promise<string>;
  getContentAtRef(ref: string, filePath: string): Promise<string>;
  getStagedContent(filePath: string): Promise<string>;
  getChangedFiles(baseRef: string): Promise<ReviewChangedFile[]>;
  getUncommittedFiles(): Promise<ReviewChangedFile[]>;
  getRefDiff(baseRef: string, filePath: string): Promise<string>;
  getUncommittedDiff(filePath: string): Promise<string>;
  getMergeBase(ref: string): Promise<string>;
  computeDiffHash(baseRef: string, filePath: string): Promise<string>;
  computeUncommittedDiffHash(filePath: string): Promise<string>;
  getLastCommitRef(): Promise<string>;

  // Worktrees
  listWorktrees(): Promise<WorktreeInfo[]>;
  addWorktree(
    branch: string,
    newBranch: boolean,
    basePath?: string,
    startPoint?: string,
  ): Promise<string>;
  removeWorktree(worktreePath: string, force?: boolean): Promise<void>;

  // OpenCode
  getOpenCodeUrl(): Promise<string>;
}

export class LocalBackend implements WorkspaceBackend {
  constructor(private workspacePath: string) {}

  async readFile(filePath: string) {
    return readFileContent(this.workspacePath, filePath);
  }

  async writeFile(filePath: string, content: string) {
    writeFileContent(this.workspacePath, filePath, content);
  }

  async listDirectory(dirPath: string, depth = 1) {
    return readDirectoryTree(dirPath, this.workspacePath, depth);
  }

  getFileStatuses() {
    return getFileStatuses(this.workspacePath);
  }

  getGitStatus() {
    return getGitStatus(this.workspacePath);
  }

  getLog(maxCount?: number, baseRef?: string) {
    return getLog(this.workspacePath, maxCount, baseRef);
  }

  getDefaultBranch() {
    return getDefaultBranch(this.workspacePath);
  }

  getDiff(file: string, staged: boolean) {
    return getDiff(this.workspacePath, file, staged);
  }

  getFileDiffs(staged: boolean) {
    return getFileDiffs(this.workspacePath, staged);
  }

  getCommitDiff(hash: string) {
    return getCommitDiff(this.workspacePath, hash);
  }

  getBranches() {
    return getBranches(this.workspacePath);
  }

  getAllBranches() {
    return getAllBranches(this.workspacePath);
  }

  async getRemotes() {
    const git = simpleGit(this.workspacePath);
    const remotes = await git.getRemotes(true);
    return remotes.map((r) => ({
      name: r.name,
      fetchUrl: r.refs.fetch,
      pushUrl: r.refs.push,
    }));
  }

  stageFiles(files: string[]) {
    return stageFiles(this.workspacePath, files);
  }

  stageAll() {
    return stageAll(this.workspacePath);
  }

  unstageFiles(files: string[]) {
    return unstageFiles(this.workspacePath, files);
  }

  unstageAll() {
    return unstageAll(this.workspacePath);
  }

  discardChanges(files: string[]) {
    return discardChanges(this.workspacePath, files);
  }

  commit(message: string) {
    return commit(this.workspacePath, message);
  }

  push(remote?: string, branch?: string, setUpstream?: boolean) {
    return push(
      this.workspacePath,
      remote ?? "origin",
      branch,
      setUpstream ?? false,
    );
  }

  pull(remote?: string, branch?: string) {
    return pull(this.workspacePath, remote ?? "origin", branch);
  }

  fetch(remote?: string, prune?: boolean) {
    return fetch(this.workspacePath, remote ?? "origin", prune ?? false);
  }

  createBranch(name: string, startPoint?: string) {
    return createBranch(this.workspacePath, name, startPoint);
  }

  switchBranch(name: string) {
    return switchBranch(this.workspacePath, name);
  }

  deleteBranch(name: string, force?: boolean) {
    return deleteBranch(this.workspacePath, name, force ?? false);
  }

  stashList() {
    return stashList(this.workspacePath);
  }

  stashSave(message?: string) {
    return stashSave(this.workspacePath, message);
  }

  stashApply(index?: number) {
    return stashApply(this.workspacePath, index ?? 0);
  }

  stashPop(index?: number) {
    return stashPop(this.workspacePath, index ?? 0);
  }

  stashDrop(index: number) {
    return stashDrop(this.workspacePath, index);
  }

  getOriginalContent(filePath: string) {
    return getOriginalContent(this.workspacePath, filePath);
  }

  async getCurrentContent(filePath: string) {
    return getCurrentContent(this.workspacePath, filePath);
  }

  getContentAtRef(ref: string, filePath: string) {
    return getContentAtRef(this.workspacePath, ref, filePath);
  }

  getStagedContent(filePath: string) {
    return getStagedContent(this.workspacePath, filePath);
  }

  getChangedFiles(baseRef: string) {
    return getChangedFiles(this.workspacePath, baseRef);
  }

  getUncommittedFiles() {
    return getUncommittedFiles(this.workspacePath);
  }

  getRefDiff(baseRef: string, filePath: string) {
    return getRefDiff(this.workspacePath, baseRef, filePath);
  }

  getUncommittedDiff(filePath: string) {
    return getUncommittedDiff(this.workspacePath, filePath);
  }

  getMergeBase(ref: string) {
    return getMergeBase(this.workspacePath, ref);
  }

  computeDiffHash(baseRef: string, filePath: string) {
    return computeDiffHash(this.workspacePath, baseRef, filePath);
  }

  computeUncommittedDiffHash(filePath: string) {
    return computeUncommittedDiffHash(this.workspacePath, filePath);
  }

  getLastCommitRef() {
    return getLastCommitRef(this.workspacePath);
  }

  listWorktrees() {
    return listWorktrees(this.workspacePath);
  }

  addWorktree(
    branch: string,
    newBranch: boolean,
    basePath?: string,
    startPoint?: string,
  ) {
    return addWorktree(
      this.workspacePath,
      branch,
      newBranch,
      basePath,
      startPoint,
    );
  }

  removeWorktree(worktreePath: string, force?: boolean) {
    return removeWorktree(this.workspacePath, worktreePath, force ?? false);
  }

  async getOpenCodeUrl() {
    const { getOrStartServer } = await import("@/lib/opencode/server-pool");
    const { url } = await getOrStartServer();
    return url;
  }
}

export class RemoteBackend implements WorkspaceBackend {
  constructor(
    private agentUrl: string,
    private opencodeUrl: string,
  ) {}

  private async agentGet<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(path, this.agentUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }
    const response = await globalThis.fetch(url.toString());
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Agent request failed: ${response.status} ${body}`);
    }
    return response.json() as Promise<T>;
  }

  private async agentPost<T>(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(path, this.agentUrl);
    const response = await globalThis.fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Agent request failed: ${response.status} ${text}`);
    }
    return response.json() as Promise<T>;
  }

  async readFile(filePath: string) {
    return this.agentGet<{ content: string; size: number }>("/files/read", {
      path: filePath,
    });
  }

  async writeFile(filePath: string, content: string) {
    await this.agentPost("/files/write", { path: filePath, content });
  }

  async listDirectory(dirPath: string, depth?: number) {
    const params: Record<string, string> = { path: dirPath };
    if (depth !== undefined) params.depth = String(depth);
    return this.agentGet<FileTreeEntry[]>("/files/tree", params);
  }

  async getFileStatuses() {
    const result =
      await this.agentGet<Record<string, FileGitStatus>>("/files/status");
    return new Map(Object.entries(result));
  }

  async getGitStatus() {
    return this.agentGet<GitStatusResult>("/git/status");
  }

  async getLog(maxCount?: number, baseRef?: string) {
    const params: Record<string, string> = {};
    if (maxCount !== undefined) params.limit = String(maxCount);
    if (baseRef) params.baseRef = baseRef;
    return this.agentGet<GitLogEntry[]>("/git/log", params);
  }

  async getDefaultBranch() {
    const result = await this.agentGet<{ branch: string | null }>(
      "/git/default-branch",
    );
    return result.branch;
  }

  async getDiff(file: string, staged: boolean) {
    return this.agentGet<string>("/git/diff", {
      file,
      staged: String(staged),
    });
  }

  async getFileDiffs(staged: boolean) {
    return this.agentGet<GitDiffResult[]>("/git/file-diffs", {
      staged: String(staged),
    });
  }

  async getCommitDiff(hash: string) {
    return this.agentGet<string>("/git/commit-diff", { hash });
  }

  async getBranches() {
    return this.agentGet<GitBranch[]>("/git/branches");
  }

  async getAllBranches() {
    return this.agentGet<AllBranch[]>("/git/all-branches");
  }

  async getRemotes() {
    return this.agentGet<{ name: string; fetchUrl: string; pushUrl: string }[]>(
      "/git/remotes",
    );
  }

  async stageFiles(files: string[]) {
    await this.agentPost("/git/stage", { files });
  }

  async stageAll() {
    await this.agentPost("/git/stage-all");
  }

  async unstageFiles(files: string[]) {
    await this.agentPost("/git/unstage", { files });
  }

  async unstageAll() {
    await this.agentPost("/git/unstage-all");
  }

  async discardChanges(files: string[]) {
    await this.agentPost("/git/discard", { files });
  }

  async commit(message: string) {
    const result = await this.agentPost<{ hash: string }>("/git/commit", {
      message,
    });
    return result.hash;
  }

  async push(remote?: string, branch?: string, setUpstream?: boolean) {
    const result = await this.agentPost<{ result: string }>("/git/push", {
      remote,
      branch,
      setUpstream,
    });
    return result.result;
  }

  async pull(remote?: string, branch?: string) {
    const result = await this.agentPost<{ result: string }>("/git/pull", {
      remote,
      branch,
    });
    return result.result;
  }

  async fetch(remote?: string, prune?: boolean) {
    await this.agentPost("/git/fetch", { remote, prune });
  }

  async createBranch(name: string, startPoint?: string) {
    await this.agentPost("/git/branch/create", { name, startPoint });
  }

  async switchBranch(name: string) {
    await this.agentPost("/git/branch/switch", { name });
  }

  async deleteBranch(name: string, force?: boolean) {
    await this.agentPost("/git/branch/delete", { name, force });
  }

  async stashList() {
    return this.agentGet<GitStashEntry[]>("/git/stash");
  }

  async stashSave(message?: string) {
    await this.agentPost("/git/stash/save", { message });
  }

  async stashApply(index?: number) {
    await this.agentPost("/git/stash/apply", { index });
  }

  async stashPop(index?: number) {
    await this.agentPost("/git/stash/pop", { index });
  }

  async stashDrop(index: number) {
    await this.agentPost("/git/stash/drop", { index });
  }

  async getOriginalContent(filePath: string) {
    const result = await this.agentGet<{ content: string }>("/git/content", {
      path: filePath,
      ref: "HEAD",
    });
    return result.content;
  }

  async getCurrentContent(filePath: string) {
    const result = await this.agentGet<{ content: string }>("/files/read", {
      path: filePath,
    });
    return result.content;
  }

  async getContentAtRef(ref: string, filePath: string) {
    const result = await this.agentGet<{ content: string }>("/git/content", {
      path: filePath,
      ref,
    });
    return result.content;
  }

  async getStagedContent(filePath: string) {
    const result = await this.agentGet<{ content: string }>("/git/content", {
      path: filePath,
      ref: "staged",
    });
    return result.content;
  }

  async getChangedFiles(baseRef: string) {
    return this.agentGet<ReviewChangedFile[]>("/git/changed-files", {
      baseRef,
    });
  }

  async getUncommittedFiles() {
    return this.agentGet<ReviewChangedFile[]>("/git/uncommitted-files");
  }

  async getRefDiff(baseRef: string, filePath: string) {
    return this.agentGet<string>("/git/ref-diff", { baseRef, path: filePath });
  }

  async getUncommittedDiff(filePath: string) {
    return this.agentGet<string>("/git/uncommitted-diff", { path: filePath });
  }

  async getMergeBase(ref: string) {
    const result = await this.agentGet<{ mergeBase: string }>(
      "/git/merge-base",
      { ref },
    );
    return result.mergeBase;
  }

  async computeDiffHash(baseRef: string, filePath: string) {
    const result = await this.agentGet<{ hash: string }>("/git/diff-hash", {
      baseRef,
      path: filePath,
    });
    return result.hash;
  }

  async computeUncommittedDiffHash(filePath: string) {
    const result = await this.agentGet<{ hash: string }>(
      "/git/uncommitted-diff-hash",
      { path: filePath },
    );
    return result.hash;
  }

  async getLastCommitRef() {
    const result = await this.agentGet<{ ref: string }>("/git/last-commit-ref");
    return result.ref;
  }

  async listWorktrees() {
    return this.agentGet<WorktreeInfo[]>("/git/worktrees");
  }

  async addWorktree(
    branch: string,
    newBranch: boolean,
    basePath?: string,
    startPoint?: string,
  ) {
    const result = await this.agentPost<{ path: string }>(
      "/git/worktrees/add",
      {
        branch,
        newBranch,
        basePath,
        startPoint,
      },
    );
    return result.path;
  }

  async removeWorktree(worktreePath: string, force?: boolean) {
    await this.agentPost("/git/worktrees/remove", {
      path: worktreePath,
      force,
    });
  }

  async getOpenCodeUrl() {
    return this.opencodeUrl;
  }
}

function isQuickCommand(value: unknown): value is QuickCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    "command" in value &&
    typeof (value as QuickCommand).label === "string" &&
    typeof (value as QuickCommand).command === "string"
  );
}

function parseQuickCommands(raw: unknown): QuickCommand[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  if (!raw.every(isQuickCommand)) return null;
  return raw;
}

function parseProviderMeta(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function parseLinkedTaskMeta(raw: unknown): LinkedTaskMeta | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (
    typeof obj.name !== "string" ||
    typeof obj.url !== "string" ||
    typeof obj.provider !== "string"
  )
    return null;
  return raw as LinkedTaskMeta;
}

export function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    ...row,
    quickCommands: parseQuickCommands(row.quickCommands),
    providerMeta: parseProviderMeta(row.providerMeta),
    linkedTaskMeta: parseLinkedTaskMeta(row.linkedTaskMeta),
  };
}

export function getBackend(workspace: Workspace): WorkspaceBackend {
  if (workspace.backend === "remote") {
    if (!workspace.agentUrl || !workspace.opencodeUrl) {
      throw new Error(
        `Remote workspace "${workspace.name}" is missing agent or opencode URLs`,
      );
    }
    return new RemoteBackend(workspace.agentUrl, workspace.opencodeUrl);
  }
  return new LocalBackend(workspace.path);
}
