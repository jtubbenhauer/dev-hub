"use client"

import { useCallback, useEffect } from "react"
import { FileIcon, Check, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { GitHubPullRequestFile, GitHubPullRequestFileStatus } from "@/types"

const STATUS_CHAR: Record<GitHubPullRequestFileStatus, string> = {
  added: "A",
  removed: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
  changed: "T",
  unchanged: "·",
}

const STATUS_COLOR: Record<GitHubPullRequestFileStatus, string> = {
  added: "text-green-500",
  removed: "text-red-500",
  modified: "text-yellow-500",
  renamed: "text-blue-500",
  copied: "text-blue-500",
  changed: "text-yellow-500",
  unchanged: "text-muted-foreground",
}

interface PrFileListProps {
  files: GitHubPullRequestFile[]
  selectedFilename: string | null
  isLoading: boolean
  reviewedFilenames: Set<string>
  commentCountByFilename: Map<string, number>
  onSelectFile: (filename: string) => void
  onToggleReviewed: (filename: string) => void
}

export function PrFileList({
  files,
  selectedFilename,
  isLoading,
  reviewedFilenames,
  commentCountByFilename,
  onSelectFile,
  onToggleReviewed,
}: PrFileListProps) {
  const selectedIndex = files.findIndex((f) => f.filename === selectedFilename)

  const handleKeyboard = useCallback(
    (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.closest(".cm-editor"))
      ) {
        return
      }

      switch (e.key) {
        case "j": {
          e.preventDefault()
          const next = files[Math.min(selectedIndex + 1, files.length - 1)]
          if (next) onSelectFile(next.filename)
          break
        }
        case "k": {
          e.preventDefault()
          const prev = files[Math.max(selectedIndex - 1, 0)]
          if (prev) onSelectFile(prev.filename)
          break
        }
      }
    },
    [selectedIndex, files, onSelectFile]
  )

  useEffect(() => {
    window.addEventListener("keydown", handleKeyboard)
    return () => window.removeEventListener("keydown", handleKeyboard)
  }, [handleKeyboard])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        Loading files…
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        No changed files
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
      <div className="space-y-px p-2">
        {files.map((file) => {
          const statusChar = STATUS_CHAR[file.status] ?? "M"
          const statusColor = STATUS_COLOR[file.status] ?? "text-muted-foreground"
          const fileName = file.filename.split("/").pop() ?? file.filename
          const dirPath = file.filename.includes("/")
            ? file.filename.slice(0, file.filename.lastIndexOf("/"))
            : ""
          const isReviewed = reviewedFilenames.has(file.filename)
          const commentCount = commentCountByFilename.get(file.filename) ?? 0

          return (
            <div
              key={file.filename}
              className={cn(
                "group flex min-w-0 items-center gap-1.5 rounded-sm px-2 py-1 text-xs cursor-pointer hover:bg-accent/50",
                selectedFilename === file.filename && "bg-accent",
                isReviewed && "opacity-60"
              )}
              onClick={() => onSelectFile(file.filename)}
            >
              <span className={cn("w-4 shrink-0 text-center font-mono font-bold", statusColor)}>
                {statusChar}
              </span>
              <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1">
                {fileName}
                {dirPath && (
                  <span className="text-muted-foreground/60 ml-1">{dirPath}</span>
                )}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {commentCount > 0 && (
                  <span className="flex items-center gap-0.5 text-muted-foreground/60">
                    <MessageSquare className="size-3" />
                    <span className="text-[10px]">{commentCount}</span>
                  </span>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        isReviewed
                          ? "text-green-500 hover:text-green-400"
                          : "text-muted-foreground/40 hover:text-muted-foreground"
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleReviewed(file.filename)
                      }}
                    >
                      <Check className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isReviewed ? "Unmark reviewed" : "Mark as reviewed"}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}
