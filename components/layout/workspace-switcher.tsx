"use client"

import { useState, useEffect } from "react"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useChatStore } from "@/stores/chat-store"
import type { WorkspaceActivity } from "@/stores/chat-store"
import { useShallow } from "zustand/react/shallow"
import { useQueries } from "@tanstack/react-query"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { FolderGit2, Globe, GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Workspace } from "@/types"
import type { AgentHealthStatus } from "@/hooks/use-git"
import { getWorkspaceBehaviour } from "@/lib/workspaces/behaviour"

function useAllWorkspaceActivities(workspaceIds: string[]): Record<string, WorkspaceActivity> {
  return useChatStore(
    useShallow((state) => {
      const result: Record<string, WorkspaceActivity> = {}
      for (const wsId of workspaceIds) {
        const ws = state.workspaceStates[wsId]
        if (!ws) {
          result[wsId] = "idle"
          continue
        }
        if (ws.permissions.length > 0 || ws.questions.length > 0) {
          result[wsId] = "waiting"
          continue
        }
        const hasActiveSession = Object.values(ws.sessionStatuses).some((s) => s.type !== "idle")
        result[wsId] = hasActiveSession ? "active" : "idle"
      }
      return result
    })
  )
}

function useRemoteWorkspaceHealthStatuses(
  workspaces: Workspace[],
  activeWorkspaceId: string | null,
): Record<string, AgentHealthStatus> {
  const remoteWorkspaces = workspaces.filter((w) => w.backend === "remote")
  const results = useQueries({
    queries: remoteWorkspaces.map((w) => {
      const behaviour = getWorkspaceBehaviour(w)
      const isActive = w.id === activeWorkspaceId
      const interval = isActive
        ? behaviour.activeHealthIntervalMs
        : behaviour.inactiveHealthIntervalMs

      // Inactive workspace that supports auto-suspend with no polling — report suspended
      if (!isActive && behaviour.supportsAutoSuspend && interval === 0) {
        return {
          queryKey: ["agent-health", w.id],
          queryFn: async (): Promise<AgentHealthStatus> => "suspended",
          refetchInterval: false as const,
          staleTime: 25_000,
          retry: false,
          enabled: false,
        }
      }

      return {
        queryKey: ["agent-health", w.id],
        queryFn: async (): Promise<AgentHealthStatus> => {
          const res = await fetch(`/api/workspaces/${w.id}/health`)
          if (!res.ok) return "unreachable"
          const data = (await res.json()) as { status?: string }
          return data.status === "ok" ? "healthy" : "unreachable"
        },
        refetchInterval: interval || false,
        staleTime: 25_000,
        retry: false,
        enabled: interval > 0 || isActive,
      }
    }),
  })

  const statuses: Record<string, AgentHealthStatus> = {}
  for (let i = 0; i < remoteWorkspaces.length; i++) {
    statuses[remoteWorkspaces[i].id] = results[i].data ?? "unknown"
  }
  return statuses
}

function useWorkspaceBranches(
  workspaces: Workspace[],
  activeWorkspaceId: string | null,
): Record<string, string> {
  const results = useQueries({
    queries: workspaces.map((w) => {
      const isInactiveRemote = w.backend === "remote" && w.id !== activeWorkspaceId
      const shouldDisable =
        isInactiveRemote && !getWorkspaceBehaviour(w).branchPollWhenInactive

      return {
        queryKey: ["git-status", w.id],
        queryFn: async () => {
          const params = new URLSearchParams({ action: "status" })
          const res = await fetch(`/api/workspaces/${w.id}/git?${params}`)
          if (!res.ok) return null
          return res.json() as Promise<{ branch: string }>
        },
        staleTime: 30_000,
        retry: false,
        enabled: !shouldDisable,
      }
    }),
  })

  const branches: Record<string, string> = {}
  for (let i = 0; i < workspaces.length; i++) {
    const data = results[i]?.data
    if (data?.branch) branches[workspaces[i].id] = data.branch
  }
  return branches
}

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspaceId, isLoadingWorkspaces, setActiveWorkspaceId } =
    useWorkspaceStore()

  const workspaceIds = workspaces.map((w) => w.id)
  const activities = useAllWorkspaceActivities(workspaceIds)
  const healthStatuses = useRemoteWorkspaceHealthStatuses(workspaces, activeWorkspaceId)
  const branches = useWorkspaceBranches(workspaces, activeWorkspaceId)

  const [wakingWorkspaceId, setWakingWorkspaceId] = useState<string | null>(null)

  useEffect(() => {
    if (wakingWorkspaceId && healthStatuses[wakingWorkspaceId] === "healthy") {
      setWakingWorkspaceId(null)
    }
  }, [wakingWorkspaceId, healthStatuses])

  if (isLoadingWorkspaces) {
    return <Skeleton className="h-9 w-36 sm:w-48" />
  }

  if (workspaces.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FolderGit2 className="h-4 w-4" />
        <span>No workspaces</span>
      </div>
    )
  }

  return (
    <Select
      value={activeWorkspaceId ?? undefined}
      onValueChange={(id) => {
        if (healthStatuses[id] === "suspended") {
          setWakingWorkspaceId(id)
        }
        setActiveWorkspaceId(id)
      }}
    >
      <SelectTrigger className="w-36 sm:w-48">
        <FolderGit2 className="mr-2 h-4 w-4 shrink-0" />
        <SelectValue placeholder="Select workspace" />
      </SelectTrigger>
      <SelectContent position="popper" side="bottom" align="start" sideOffset={4}>
        {workspaces.map((workspace) => {
          const activity = activities[workspace.id] ?? "idle"
          const isRemote = workspace.backend === "remote"
          const health = healthStatuses[workspace.id]
          const isUnreachable = isRemote && health === "unreachable"
          const behaviour = getWorkspaceBehaviour(workspace)
          const supportsAutoSuspend = behaviour.supportsAutoSuspend
          const isWaking = workspace.id === wakingWorkspaceId

          return (
            <SelectItem key={workspace.id} value={workspace.id}>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-1.5 rounded-full shrink-0",
                    isUnreachable && "bg-red-500",
                    !isUnreachable && activity === "active" && "bg-emerald-500 animate-pulse",
                    !isUnreachable && activity === "waiting" && "bg-amber-500",
                    !isUnreachable && activity === "idle" && "invisible"
                  )}
                />
                <span className="truncate">{workspace.name}</span>
                
                {supportsAutoSuspend && (
                  <>
                    {health === "suspended" && !isWaking && (
                      <span className="bg-muted text-muted-foreground text-[10px] px-1.5 py-0.5 rounded-full shrink-0">
                        Suspended
                      </span>
                    )}
                    {isWaking && (
                      <span className="bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-[10px] px-1.5 py-0.5 rounded-full animate-pulse shrink-0">
                        Waking...
                      </span>
                    )}
                    {health === "healthy" && !isWaking && (
                      <span className="bg-green-500/20 text-green-600 dark:text-green-400 text-[10px] px-1.5 py-0.5 rounded-full shrink-0">
                        Active
                      </span>
                    )}
                    {health === "unreachable" && !isWaking && (
                      <span className="bg-red-500/20 text-red-600 dark:text-red-400 text-[10px] px-1.5 py-0.5 rounded-full shrink-0">
                        Error
                      </span>
                    )}
                  </>
                )}

                {branches[workspace.id] && (
                  <span className="flex items-center gap-0.5 text-xs text-muted-foreground shrink-0">
                    <GitBranch className="size-3" />
                    {branches[workspace.id]}
                  </span>
                )}
                {isRemote && (
                  <Globe className="size-3 shrink-0 text-blue-500" />
                )}
              </div>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

