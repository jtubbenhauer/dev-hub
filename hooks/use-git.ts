"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type {
  GitStatusResult,
  GitLogEntry,
  GitBranch,
  GitStashEntry,
  ReviewFileContent,
  ReviewChangedFile,
  WorktreeInfo,
} from "@/types"

async function gitGet<T>(workspaceId: string, action: string, params?: Record<string, string>): Promise<T> {
  const searchParams = new URLSearchParams({ action, ...params })
  const res = await fetch(`/api/workspaces/${workspaceId}/git?${searchParams}`)
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || "Git operation failed")
  }
  return res.json()
}

async function gitPost<T>(workspaceId: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/workspaces/${workspaceId}/git`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || "Git operation failed")
  }
  return res.json()
}

export function useGitStatus(workspaceId: string | null) {
  return useQuery<GitStatusResult>({
    queryKey: ["git-status", workspaceId],
    queryFn: () => gitGet<GitStatusResult>(workspaceId!, "status"),
    enabled: !!workspaceId,
    refetchInterval: 10_000,
  })
}

export function useGitLog(workspaceId: string | null, maxCount: number = 50) {
  return useQuery<GitLogEntry[]>({
    queryKey: ["git-log", workspaceId, maxCount],
    queryFn: () => gitGet<GitLogEntry[]>(workspaceId!, "log", { maxCount: String(maxCount) }),
    enabled: !!workspaceId,
  })
}

export function useGitBranches(workspaceId: string | null) {
  return useQuery<GitBranch[]>({
    queryKey: ["git-branches", workspaceId],
    queryFn: () => gitGet<GitBranch[]>(workspaceId!, "branches"),
    enabled: !!workspaceId,
  })
}

export function useGitStashList(workspaceId: string | null) {
  return useQuery<GitStashEntry[]>({
    queryKey: ["git-stash-list", workspaceId],
    queryFn: () => gitGet<GitStashEntry[]>(workspaceId!, "stash-list"),
    enabled: !!workspaceId,
  })
}

export function useGitDiff(workspaceId: string | null, file: string | null, staged: boolean) {
  return useQuery<string>({
    queryKey: ["git-diff", workspaceId, file, staged],
    queryFn: async () => {
      const result = await gitGet<{ diff: string }>(workspaceId!, "diff", {
        file: file!,
        staged: String(staged),
      })
      return result.diff
    },
    enabled: !!workspaceId && !!file,
  })
}

export function useGitFileContent(workspaceId: string | null, file: string | null, staged: boolean) {
  return useQuery<ReviewFileContent>({
    queryKey: ["git-file-content", workspaceId, file, staged],
    queryFn: () =>
      gitGet<ReviewFileContent>(workspaceId!, "file-content", {
        file: file!,
        staged: String(staged),
      }),
    enabled: !!workspaceId && !!file,
    staleTime: 5_000,
  })
}

// Fetches file content for branch comparison / last-commit mode.
// original = content at baseRef, current = content at currentRef (defaults to working tree via HEAD).
export function useGitFileContentAtRef(
  workspaceId: string | null,
  file: string | null,
  baseRef: string | null,
  currentRef: string | null = null
) {
  return useQuery<ReviewFileContent>({
    queryKey: ["git-file-content-ref", workspaceId, file, baseRef, currentRef],
    queryFn: () =>
      gitGet<ReviewFileContent>(workspaceId!, "file-content", {
        file: file!,
        baseRef: baseRef!,
        ...(currentRef ? { currentRef } : {}),
      }),
    enabled: !!workspaceId && !!file && !!baseRef,
    staleTime: 5_000,
  })
}

export function useGitChangedFiles(workspaceId: string | null, baseRef: string | null) {
  return useQuery<ReviewChangedFile[]>({
    queryKey: ["git-changed-files", workspaceId, baseRef],
    queryFn: () =>
      gitGet<ReviewChangedFile[]>(workspaceId!, "changed-files", { baseRef: baseRef! }),
    enabled: !!workspaceId && !!baseRef,
  })
}

export function useGitCommitDiff(workspaceId: string | null, hash: string | null) {
  return useQuery<string>({
    queryKey: ["git-commit-diff", workspaceId, hash],
    queryFn: async () => {
      const result = await gitGet<{ diff: string }>(workspaceId!, "commit-diff", { hash: hash! })
      return result.diff
    },
    enabled: !!workspaceId && !!hash,
  })
}

function useGitMutation<TBody extends Record<string, unknown>>(
  workspaceId: string | null,
  invalidateKeys: string[],
  successMessage?: string
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: TBody) => gitPost(workspaceId!, body),
    onSuccess: () => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: [key, workspaceId] })
      }
      if (successMessage) toast.success(successMessage)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}

export function useGitStage(workspaceId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: { action: string; files: string[] }) =>
      gitPost(workspaceId!, body),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: ["git-status", workspaceId] })
      const previous = queryClient.getQueryData<GitStatusResult>(["git-status", workspaceId])

      if (previous) {
        const filesToStage = new Set(body.files)
        const newStaged = [...previous.staged]
        const newUnstaged = previous.unstaged.filter((f) => {
          if (filesToStage.has(f.path)) {
            newStaged.push(f)
            return false
          }
          return true
        })
        const newUntracked = previous.untracked.filter((path) => {
          if (filesToStage.has(path)) {
            newStaged.push({ path, index: "A", workingDir: " " })
            return false
          }
          return true
        })

        queryClient.setQueryData<GitStatusResult>(["git-status", workspaceId], {
          ...previous,
          staged: newStaged,
          unstaged: newUnstaged,
          untracked: newUntracked,
        })
      }

      return { previous }
    },
    onError: (_err, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["git-status", workspaceId], context.previous)
      }
      toast.error(_err.message)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["git-status", workspaceId] })
    },
  })
}

export function useGitUnstage(workspaceId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: { action: string; files: string[] }) =>
      gitPost(workspaceId!, body),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: ["git-status", workspaceId] })
      const previous = queryClient.getQueryData<GitStatusResult>(["git-status", workspaceId])

      if (previous) {
        const filesToUnstage = new Set(body.files)
        const newUnstaged = [...previous.unstaged]
        const newStaged = previous.staged.filter((f) => {
          if (filesToUnstage.has(f.path)) {
            // "A" (added) files go back to untracked, others go to unstaged
            if (f.index !== "A") {
              newUnstaged.push(f)
            }
            return false
          }
          return true
        })
        const newUntracked = [...previous.untracked]
        // Files that were "A" (newly added) go back to untracked
        for (const f of previous.staged) {
          if (filesToUnstage.has(f.path) && f.index === "A") {
            newUntracked.push(f.path)
          }
        }

        queryClient.setQueryData<GitStatusResult>(["git-status", workspaceId], {
          ...previous,
          staged: newStaged,
          unstaged: newUnstaged,
          untracked: newUntracked,
        })
      }

      return { previous }
    },
    onError: (_err, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["git-status", workspaceId], context.previous)
      }
      toast.error(_err.message)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["git-status", workspaceId] })
    },
  })
}

export function useGitDiscard(workspaceId: string | null) {
  return useGitMutation<{ action: string; files: string[] }>(
    workspaceId,
    ["git-status"],
    "Changes discarded"
  )
}

export function useGitCommit(workspaceId: string | null) {
  return useGitMutation<{ action: string; message: string }>(
    workspaceId,
    ["git-status", "git-log"],
    "Committed successfully"
  )
}

export function useGitPush(workspaceId: string | null) {
  return useGitMutation<{ action: string; remote?: string; branch?: string; setUpstream?: boolean }>(
    workspaceId,
    ["git-status"],
    "Pushed successfully"
  )
}

export function useGitPull(workspaceId: string | null) {
  return useGitMutation<{ action: string; remote?: string; branch?: string }>(
    workspaceId,
    ["git-status", "git-log"],
    "Pulled successfully"
  )
}

export function useGitFetch(workspaceId: string | null) {
  return useGitMutation<{ action: string; remote?: string; prune?: boolean }>(
    workspaceId,
    ["git-status", "git-branches"],
    "Fetched successfully"
  )
}

export function useGitCreateBranch(workspaceId: string | null) {
  return useGitMutation<{ action: string; branchName: string; startPoint?: string }>(
    workspaceId,
    ["git-branches", "git-status"],
    "Branch created"
  )
}

export function useGitSwitchBranch(workspaceId: string | null) {
  return useGitMutation<{ action: string; branchName: string }>(
    workspaceId,
    ["git-branches", "git-status", "git-log"],
    "Switched branch"
  )
}

export function useGitDeleteBranch(workspaceId: string | null) {
  return useGitMutation<{ action: string; branchName: string; force?: boolean }>(
    workspaceId,
    ["git-branches"],
    "Branch deleted"
  )
}

export function useGitStashSave(workspaceId: string | null) {
  return useGitMutation<{ action: string; message?: string }>(
    workspaceId,
    ["git-status", "git-stash-list"],
    "Changes stashed"
  )
}

export function useGitStashApply(workspaceId: string | null) {
  return useGitMutation<{ action: string; index?: number }>(
    workspaceId,
    ["git-status", "git-stash-list"]
  )
}

export function useGitStashPop(workspaceId: string | null) {
  return useGitMutation<{ action: string; index?: number }>(
    workspaceId,
    ["git-status", "git-stash-list"],
    "Stash popped"
  )
}

export function useGitStashDrop(workspaceId: string | null) {
  return useGitMutation<{ action: string; index: number }>(
    workspaceId,
    ["git-stash-list"],
    "Stash dropped"
  )
}

// Worktree hooks

export function useWorktreeList(workspaceId: string | null) {
  return useQuery<WorktreeInfo[]>({
    queryKey: ["worktree-list", workspaceId],
    queryFn: () => gitGet<WorktreeInfo[]>(workspaceId!, "worktree-list"),
    enabled: !!workspaceId,
  })
}

export function useCloneRepo() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (body: {
      url: string
      targetDir?: string
      name?: string
      depth?: number
    }) => {
      const res = await fetch("/api/workspaces/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to clone repository")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      toast.success("Repository cloned")
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}

export function useCreateWorktree() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (body: {
      parentRepoPath: string
      branch: string
      newBranch: boolean
      basePath?: string
      startPoint?: string
      name?: string
    }) => {
      const res = await fetch("/api/workspaces/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to create worktree")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      toast.success("Worktree created")
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}

// Agent health

export type AgentHealthStatus = "healthy" | "unreachable" | "unknown"

interface AgentHealthResponse {
  status: "ok" | "unreachable"
  backend?: "local" | "remote"
  reason?: string
  workspacePath?: string
}

export function useAgentHealth(workspaceId: string | null, isRemote: boolean) {
  return useQuery<AgentHealthStatus>({
    queryKey: ["agent-health", workspaceId],
    queryFn: async (): Promise<AgentHealthStatus> => {
      const res = await fetch(`/api/workspaces/${workspaceId}/health`)
      if (!res.ok) return "unreachable"
      const data = (await res.json()) as AgentHealthResponse
      return data.status === "ok" ? "healthy" : "unreachable"
    },
    enabled: !!workspaceId && isRemote,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  })
}
