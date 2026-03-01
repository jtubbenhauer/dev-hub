"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type {
  GitStatusResult,
  GitLogEntry,
  GitBranch,
  GitStashEntry,
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
  return useGitMutation<{ action: string; files: string[] }>(
    workspaceId,
    ["git-status"]
  )
}

export function useGitUnstage(workspaceId: string | null) {
  return useGitMutation<{ action: string; files: string[] }>(
    workspaceId,
    ["git-status"]
  )
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
