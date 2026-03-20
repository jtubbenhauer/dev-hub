"use client"

import { useCallback, useEffect } from "react"
import { FileIcon, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn, isEditorElement } from "@/lib/utils"
import type { ReviewChangedFile, ReviewFileStatus } from "@/types"

const STATUS_CHAR: Record<ReviewFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  untracked: "?",
}

const STATUS_COLOR: Record<ReviewFileStatus, string> = {
  added: "text-green-500",
  modified: "text-yellow-500",
  deleted: "text-red-500",
  renamed: "text-blue-500",
  copied: "text-blue-500",
  "type-changed": "text-yellow-500",
  untracked: "text-muted-foreground",
}

interface ChangedFileListProps {
  files: ReviewChangedFile[]
  selectedFile: string | null
  isLoading: boolean
  reviewedFiles: Set<string>
  emptyMessage?: string
  onSelectFile: (file: string) => void
  onToggleReviewed: (path: string) => void
}

export function ChangedFileList({
  files,
  selectedFile,
  isLoading,
  reviewedFiles,
  emptyMessage = "No changed files",
  onSelectFile,
  onToggleReviewed,
}: ChangedFileListProps) {
  const selectedIndex = files.findIndex((f) => f.path === selectedFile)

  const handleKeyboard = useCallback(
    (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && isEditorElement(e.target))
      ) {
        return
      }

      switch (e.key) {
        case "j": {
          e.preventDefault()
          const next = files[Math.min(selectedIndex + 1, files.length - 1)]
          if (next) onSelectFile(next.path)
          break
        }
        case "k": {
          e.preventDefault()
          const prev = files[Math.max(selectedIndex - 1, 0)]
          if (prev) onSelectFile(prev.path)
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
        Loading…
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
      <div className="space-y-px p-2">
        {files.map((file) => {
          const statusChar = STATUS_CHAR[file.status] ?? file.status[0].toUpperCase()
          const statusColor = STATUS_COLOR[file.status] ?? "text-muted-foreground"
          const fileName = file.path.split("/").pop() ?? file.path
          const dirPath = file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : ""
          const isReviewed = reviewedFiles.has(file.path)

          return (
            <div
              key={file.path}
              className={cn(
                "group flex min-w-0 items-center gap-1.5 rounded-sm px-2 py-1 text-xs cursor-pointer hover:bg-accent/50",
                selectedFile === file.path && "bg-accent",
                isReviewed && "opacity-60"
              )}
              onClick={() => onSelectFile(file.path)}
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
              <div className="flex shrink-0 items-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        isReviewed ? "text-green-500 hover:text-green-400" : "text-muted-foreground/40 hover:text-muted-foreground"
                      )}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleReviewed(file.path)
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
