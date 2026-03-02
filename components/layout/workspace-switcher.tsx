"use client"

import { useWorkspaceStore } from "@/stores/workspace-store"
import { useChatStore } from "@/stores/chat-store"
import type { WorkspaceActivity } from "@/stores/chat-store"
import { useShallow } from "zustand/react/shallow"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { FolderGit2 } from "lucide-react"
import { cn } from "@/lib/utils"

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

export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspaceId, isLoadingWorkspaces, setActiveWorkspaceId } =
    useWorkspaceStore()

  const workspaceIds = workspaces.map((w) => w.id)
  const activities = useAllWorkspaceActivities(workspaceIds)

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
      onValueChange={setActiveWorkspaceId}
    >
      <SelectTrigger className="w-36 sm:w-48">
        <FolderGit2 className="mr-2 h-4 w-4 shrink-0" />
        <SelectValue placeholder="Select workspace" />
      </SelectTrigger>
      <SelectContent position="popper" side="bottom" align="start" sideOffset={4}>
        {workspaces.map((workspace) => {
          const activity = activities[workspace.id] ?? "idle"
          return (
            <SelectItem key={workspace.id} value={workspace.id}>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-1.5 rounded-full shrink-0",
                    activity === "active" && "bg-emerald-500 animate-pulse",
                    activity === "waiting" && "bg-amber-500",
                    activity === "idle" && "invisible"
                  )}
                />
                <span className="truncate">{workspace.name}</span>
              </div>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

