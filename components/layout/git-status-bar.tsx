"use client"

import { useState, useCallback } from "react"
import { useWorkspaceStore } from "@/stores/workspace-store"
import {
  useGitStatus,
  useGitStage,
  useGitCommit,
  useGitPush,
  useGitPull,
} from "@/hooks/use-git"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  GitBranch,
  ArrowUpFromLine,
  ArrowDownToLine,
  Circle,
  Loader2,
  Check,
} from "lucide-react"

export function GitStatusBar() {
  const { activeWorkspaceId } = useWorkspaceStore()
  const { data: status, isLoading } = useGitStatus(activeWorkspaceId)
  const [commitMessage, setCommitMessage] = useState("")
  const [open, setOpen] = useState(false)

  const stageAll = useGitStage(activeWorkspaceId)
  const commit = useGitCommit(activeWorkspaceId)
  const push = useGitPush(activeWorkspaceId)
  const pull = useGitPull(activeWorkspaceId)

  const dirtyCount = status
    ? status.staged.length + status.unstaged.length + status.untracked.length
    : 0

  const handleCommitAll = useCallback(() => {
    const trimmed = commitMessage.trim()
    if (!trimmed) return

    // Stage all then commit
    stageAll.mutate(
      { action: "stage-all", files: [] },
      {
        onSuccess: () => {
          commit.mutate(
            { action: "commit", message: trimmed },
            {
              onSuccess: () => {
                setCommitMessage("")
              },
            }
          )
        },
      }
    )
  }, [commitMessage, stageAll, commit])

  const handlePush = useCallback(() => {
    push.mutate({ action: "push" })
  }, [push])

  const handlePull = useCallback(() => {
    pull.mutate({ action: "pull" })
  }, [pull])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleCommitAll()
      }
    },
    [handleCommitAll]
  )

  if (isLoading || !status || !status.isRepo) return null

  const isCommitting = stageAll.isPending || commit.isPending
  const isPushing = push.isPending
  const isPulling = pull.isPending

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
              "hover:bg-accent/50",
              open && "bg-accent/50"
            )}
          >
            <GitBranch className="size-3.5 text-muted-foreground" />
            <span className="font-mono text-muted-foreground">
              {status.branch}
            </span>
            {dirtyCount > 0 && (
              <span className="flex items-center gap-0.5">
                <Circle className="size-2 fill-amber-500 text-amber-500" />
                <span className="text-amber-500 font-medium">{dirtyCount}</span>
              </span>
            )}
            {status.ahead > 0 && (
              <span className="text-blue-500 font-medium">
                {"\u2191"}{status.ahead}
              </span>
            )}
            {status.behind > 0 && (
              <span className="text-orange-500 font-medium">
                {"\u2193"}{status.behind}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          <div className="space-y-3">
            {/* Status summary */}
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">
                {status.branch}
              </span>
              <div className="flex items-center gap-2 text-muted-foreground">
                {status.staged.length > 0 && (
                  <span className="text-green-500">{status.staged.length} staged</span>
                )}
                {status.unstaged.length > 0 && (
                  <span className="text-amber-500">{status.unstaged.length} modified</span>
                )}
                {status.untracked.length > 0 && (
                  <span className="text-muted-foreground">{status.untracked.length} untracked</span>
                )}
                {dirtyCount === 0 && (
                  <span className="flex items-center gap-1 text-green-500">
                    <Check className="size-3" />
                    Clean
                  </span>
                )}
              </div>
            </div>

            {/* Quick commit */}
            {dirtyCount > 0 && (
              <div className="space-y-2">
                <textarea
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Commit message..."
                  rows={2}
                  className={cn(
                    "w-full resize-none rounded-md border bg-muted/50 px-2.5 py-1.5 text-sm",
                    "placeholder:text-muted-foreground",
                    "focus:outline-none focus:ring-2 focus:ring-ring"
                  )}
                />
                <Button
                  onClick={handleCommitAll}
                  disabled={!commitMessage.trim() || isCommitting}
                  className="w-full"
                  size="sm"
                >
                  {isCommitting ? (
                    <>
                      <Loader2 className="mr-1.5 size-3 animate-spin" />
                      Committing...
                    </>
                  ) : (
                    `Stage all & commit (${dirtyCount} file${dirtyCount !== 1 ? "s" : ""})`
                  )}
                </Button>
              </div>
            )}

            {/* Remote actions */}
            <div className="flex gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={handlePull}
                    disabled={isPulling || isPushing}
                  >
                    {isPulling ? (
                      <Loader2 className="mr-1.5 size-3 animate-spin" />
                    ) : (
                      <ArrowDownToLine className="mr-1.5 size-3" />
                    )}
                    Pull
                    {status.behind > 0 && (
                      <span className="ml-1 text-orange-500">({status.behind})</span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Pull changes from remote</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={handlePush}
                    disabled={isPushing || isPulling}
                  >
                    {isPushing ? (
                      <Loader2 className="mr-1.5 size-3 animate-spin" />
                    ) : (
                      <ArrowUpFromLine className="mr-1.5 size-3" />
                    )}
                    Push
                    {status.ahead > 0 && (
                      <span className="ml-1 text-blue-500">({status.ahead})</span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Push changes to remote</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
