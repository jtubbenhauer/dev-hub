"use client"

import Link from "next/link"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useChatStore } from "@/stores/chat-store"
import type { WorkspaceActivity } from "@/stores/chat-store"
import { useShallow } from "zustand/react/shallow"
import { useGitStatus } from "@/hooks/use-git"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"
import {
  GitBranch,
  ArrowUp,
  ArrowDown,
  FileWarning,
  MessageSquare,
  FolderOpen,
  Terminal,
  GitCommitHorizontal,
  Clock,
  FolderGit2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Workspace } from "@/types"

export function WorkspaceOverview() {
  const { workspaces } = useWorkspaceStore()

  if (workspaces.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <FolderGit2 className="h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">No workspaces registered yet.</p>
          <Link href="/workspaces" className="text-primary hover:underline text-sm">
            Add your first workspace
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {workspaces.map((workspace) => (
        <WorkspaceCard key={workspace.id} workspace={workspace} />
      ))}
    </div>
  )
}

function useWorkspaceActivityInfo(workspaceId: string): {
  activity: WorkspaceActivity
  activeSessionCount: number
} {
  return useChatStore(
    useShallow((state) => {
      const ws = state.workspaceStates[workspaceId]
      if (!ws) return { activity: "idle" as const, activeSessionCount: 0 }

      if (ws.permissions.length > 0 || ws.questions.length > 0) {
        return { activity: "waiting" as const, activeSessionCount: 0 }
      }

      const activeSessionCount = Object.values(ws.sessionStatuses).filter(
        (s) => s.type !== "idle"
      ).length

      return {
        activity: (activeSessionCount > 0 ? "active" : "idle") as WorkspaceActivity,
        activeSessionCount,
      }
    })
  )
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const { setActiveWorkspaceId } = useWorkspaceStore()
  const { data: gitStatus, isLoading } = useGitStatus(workspace.id)
  const { activity, activeSessionCount } = useWorkspaceActivityInfo(workspace.id)

  const totalChanges = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0

  const relativeDate = gitStatus?.lastCommit?.date
    ? formatRelativeDate(gitStatus.lastCommit.date)
    : null

  return (
    <Card className="overflow-hidden hover:border-primary/50 transition-colors">
      <CardHeader className="pb-2 pt-3 px-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <CardTitle className="min-w-0 text-sm truncate">{workspace.name}</CardTitle>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="secondary" className="text-xs py-0">
              {workspace.type}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        {isLoading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-44" />
          </div>
        ) : gitStatus?.isRepo ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1 text-foreground min-w-0">
                <GitBranch className="size-3 shrink-0 text-muted-foreground" />
                <span className="font-mono truncate max-w-28">{gitStatus.branch}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {gitStatus.ahead > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-green-500">
                        <ArrowUp className="size-3" />
                        {gitStatus.ahead}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {gitStatus.ahead} commit{gitStatus.ahead > 1 ? "s" : ""} ahead
                    </TooltipContent>
                  </Tooltip>
                )}
                {gitStatus.behind > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-orange-500">
                        <ArrowDown className="size-3" />
                        {gitStatus.behind}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {gitStatus.behind} commit{gitStatus.behind > 1 ? "s" : ""} behind
                    </TooltipContent>
                  </Tooltip>
                )}
                {totalChanges > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-yellow-500">
                        <FileWarning className="size-3" />
                        {totalChanges}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {gitStatus.staged.length} staged, {gitStatus.unstaged.length} modified,{" "}
                      {gitStatus.untracked.length} untracked
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            {gitStatus.lastCommit && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <GitCommitHorizontal className="size-3 shrink-0" />
                <span className="truncate flex-1">{gitStatus.lastCommit.message}</span>
                {relativeDate && (
                  <span className="flex items-center gap-0.5 shrink-0">
                    <Clock className="size-3" />
                    {relativeDate}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : null}

        {activity !== "idle" && (
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              activity === "active" && "text-emerald-600 dark:text-emerald-400",
              activity === "waiting" && "text-amber-600 dark:text-amber-400"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full shrink-0",
                activity === "active" && "bg-emerald-500 animate-pulse",
                activity === "waiting" && "bg-amber-500"
              )}
            />
            {activity === "active" &&
              (activeSessionCount === 1
                ? "1 session active"
                : `${activeSessionCount} sessions active`)}
            {activity === "waiting" && "Waiting for input"}
          </div>
        )}

        <div className="flex items-center gap-3 pt-0.5">
          <Link
            href="/chat"
            onClick={() => setActiveWorkspaceId(workspace.id)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <MessageSquare className="size-3" />
            Chat
          </Link>
          <Link
            href="/files"
            onClick={() => setActiveWorkspaceId(workspace.id)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <FolderOpen className="size-3" />
            Files
          </Link>
          <Link
            href="/commands"
            onClick={() => setActiveWorkspaceId(workspace.id)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Terminal className="size-3" />
            Run
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString)
  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

