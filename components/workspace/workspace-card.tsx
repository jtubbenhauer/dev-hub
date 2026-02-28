"use client"

import Link from "next/link"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useGitStatus } from "@/hooks/use-git"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Trash2,
  MessageSquare,
  FolderOpen,
  Terminal,
  GitBranch,
  ArrowUp,
  ArrowDown,
  Clock,
  GitCommitHorizontal,
  FileWarning,
} from "lucide-react"
import type { Workspace } from "@/types"

interface WorkspaceCardProps {
  workspace: Workspace
  onDelete: (id: string) => void
  onSelect: (id: string) => void
  isSelected: boolean
  isDeleting: boolean
}

export function WorkspaceCard({
  workspace,
  onDelete,
  onSelect,
  isSelected,
  isDeleting,
}: WorkspaceCardProps) {
  const { setActiveWorkspaceId } = useWorkspaceStore()
  const { data: gitStatus } = useGitStatus(workspace.id)

  const totalChanges = gitStatus
    ? gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length
    : 0

  const relativeDate = gitStatus?.lastCommit?.date
    ? formatRelativeDate(gitStatus.lastCommit.date)
    : null

  return (
    <Card
      className={isSelected ? "ring-2 ring-primary" : "cursor-pointer hover:border-primary/50"}
      onClick={() => onSelect(workspace.id)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base truncate">{workspace.name}</CardTitle>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="secondary" className="text-xs">
              {workspace.type}
            </Badge>
            {workspace.packageManager && workspace.packageManager !== "none" && (
              <Badge variant="outline" className="text-xs">
                {workspace.packageManager}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground truncate font-mono">
          {workspace.path}
        </p>

        {gitStatus?.isRepo && (
          <div className="space-y-2">
            {/* Branch + tracking info */}
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1 text-foreground">
                <GitBranch className="size-3.5" />
                <span className="font-medium truncate max-w-32">
                  {gitStatus.branch}
                </span>
              </div>
              {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
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
                </div>
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
                    {gitStatus.staged.length} staged, {gitStatus.unstaged.length} modified, {gitStatus.untracked.length} untracked
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Last commit */}
            {gitStatus.lastCommit && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <GitCommitHorizontal className="size-3 shrink-0" />
                <span className="truncate flex-1">{gitStatus.lastCommit.message}</span>
                <span className="flex items-center gap-0.5 shrink-0">
                  <Clock className="size-3" />
                  {relativeDate}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Link
              href="/chat"
              onClick={(event) => {
                event.stopPropagation()
                setActiveWorkspaceId(workspace.id)
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <MessageSquare className="size-3" />
              Chat
            </Link>
            <Link
              href="/files"
              onClick={(event) => {
                event.stopPropagation()
                setActiveWorkspaceId(workspace.id)
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <FolderOpen className="size-3" />
              Files
            </Link>
            <Link
              href="/commands"
              onClick={(event) => {
                event.stopPropagation()
                setActiveWorkspaceId(workspace.id)
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Terminal className="size-3" />
              Run
            </Link>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(event) => {
              event.stopPropagation()
              onDelete(workspace.id)
            }}
            disabled={isDeleting}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}
