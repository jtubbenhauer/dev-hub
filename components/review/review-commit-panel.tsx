"use client"

import { useState, useCallback } from "react"
import {
  useGitStatus,
  useGitStage,
  useGitCommit,
  useGitPush,
} from "@/hooks/use-git"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  ArrowUpFromLine,
  Loader2,
  Check,
  GitCommitHorizontal,
} from "lucide-react"

interface ReviewCommitPanelProps {
  workspaceId: string
}

export function ReviewCommitPanel({ workspaceId }: ReviewCommitPanelProps) {
  const { data: status } = useGitStatus(workspaceId)
  const [commitMessage, setCommitMessage] = useState("")
  const [justCommitted, setJustCommitted] = useState(false)

  const stageAll = useGitStage(workspaceId)
  const commit = useGitCommit(workspaceId)
  const push = useGitPush(workspaceId)

  const dirtyCount = status
    ? status.staged.length + status.unstaged.length + status.untracked.length
    : 0

  const handleCommitAll = useCallback(() => {
    const trimmed = commitMessage.trim()
    if (!trimmed) return

    stageAll.mutate(
      { action: "stage-all", files: [] },
      {
        onSuccess: () => {
          commit.mutate(
            { action: "commit", message: trimmed },
            {
              onSuccess: () => {
                setCommitMessage("")
                setJustCommitted(true)
              },
            }
          )
        },
      }
    )
  }, [commitMessage, stageAll, commit])

  const handlePush = useCallback(() => {
    push.mutate(
      { action: "push" },
      {
        onSuccess: () => {
          setJustCommitted(false)
        },
      }
    )
  }, [push])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleCommitAll()
      }
    },
    [handleCommitAll]
  )

  if (!status || !status.isRepo) return null

  const isCommitting = stageAll.isPending || commit.isPending
  const isPushing = push.isPending

  // After committing, show push prompt
  if (justCommitted && dirtyCount === 0) {
    return (
      <div className="shrink-0 space-y-2 border-t p-2">
        <div className="flex items-center gap-1.5 text-xs text-green-500">
          <Check className="size-3" />
          <span>Committed successfully</span>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handlePush}
            disabled={isPushing}
            className="flex-1"
            size="sm"
          >
            {isPushing ? (
              <>
                <Loader2 className="mr-1.5 size-3 animate-spin" />
                Pushing...
              </>
            ) : (
              <>
                <ArrowUpFromLine className="mr-1.5 size-3" />
                Push
                {status.ahead > 0 && ` (${status.ahead})`}
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setJustCommitted(false)}
          >
            Dismiss
          </Button>
        </div>
      </div>
    )
  }

  // Nothing to commit
  if (dirtyCount === 0) {
    return (
      <div className="shrink-0 border-t p-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Check className="size-3 text-green-500" />
            Working tree clean
          </span>
          {status.ahead > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handlePush}
                  disabled={isPushing}
                >
                  {isPushing ? (
                    <Loader2 className="mr-1 size-3 animate-spin" />
                  ) : (
                    <ArrowUpFromLine className="mr-1 size-3" />
                  )}
                  Push ({status.ahead})
                </Button>
              </TooltipTrigger>
              <TooltipContent>Push {status.ahead} commit{status.ahead !== 1 ? "s" : ""} to remote</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    )
  }

  // Dirty state — show commit form
  return (
    <div className="shrink-0 space-y-2 border-t p-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <GitCommitHorizontal className="size-3" />
        <span>
          {status.staged.length > 0 && (
            <span className="text-green-500">{status.staged.length} staged</span>
          )}
          {status.staged.length > 0 && (status.unstaged.length + status.untracked.length) > 0 && ", "}
          {(status.unstaged.length + status.untracked.length) > 0 && (
            <span className="text-amber-500">
              {status.unstaged.length + status.untracked.length} unstaged
            </span>
          )}
        </span>
      </div>
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
          `Stage all & commit`
        )}
      </Button>
    </div>
  )
}
