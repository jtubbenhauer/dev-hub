"use client"

import { useCallback, useEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  Check,
  FilePlus,
  FileEdit,
  FileMinus,
  FileQuestion,
  ArrowRight,
  File,
} from "lucide-react"
import type { ReviewFile, ReviewFileStatus } from "@/types"

interface ReviewFileListProps {
  files: ReviewFile[]
  selectedFileId: number | null
  onSelectFile: (file: ReviewFile) => void
  onToggleReviewed: (file: ReviewFile) => void
  onMarkAndNext: (file: ReviewFile) => void
}

const statusIcons: Record<ReviewFileStatus, typeof File> = {
  added: FilePlus,
  modified: FileEdit,
  deleted: FileMinus,
  renamed: ArrowRight,
  copied: ArrowRight,
  "type-changed": FileEdit,
  untracked: FileQuestion,
}

const statusColors: Record<ReviewFileStatus, string> = {
  added: "text-green-500",
  modified: "text-yellow-500",
  deleted: "text-red-500",
  renamed: "text-blue-500",
  copied: "text-blue-500",
  "type-changed": "text-purple-500",
  untracked: "text-gray-400",
}

const statusLetters: Record<ReviewFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  untracked: "?",
}

function sortFilesUnreviewedFirst(files: ReviewFile[]): ReviewFile[] {
  return [...files].sort((a, b) => {
    if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1
    return a.path.localeCompare(b.path)
  })
}

export function ReviewFileList({
  files,
  selectedFileId,
  onSelectFile,
  onToggleReviewed,
  onMarkAndNext,
}: ReviewFileListProps) {
  const sorted = sortFilesUnreviewedFirst(files)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedIndex = sorted.findIndex((f) => f.id === selectedFileId)

  const handleKeyboard = useCallback(
    (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      switch (e.key) {
        case "j": {
          e.preventDefault()
          const nextIdx = Math.min(selectedIndex + 1, sorted.length - 1)
          if (sorted[nextIdx]) onSelectFile(sorted[nextIdx])
          break
        }
        case "k": {
          e.preventDefault()
          const prevIdx = Math.max(selectedIndex - 1, 0)
          if (sorted[prevIdx]) onSelectFile(sorted[prevIdx])
          break
        }
        case "r": {
          e.preventDefault()
          if (selectedFileId !== null) {
            const current = sorted.find((f) => f.id === selectedFileId)
            if (current) onToggleReviewed(current)
          }
          break
        }
        case "n": {
          e.preventDefault()
          if (selectedFileId !== null) {
            const current = sorted.find((f) => f.id === selectedFileId)
            if (current) onMarkAndNext(current)
          }
          break
        }
        case "]": {
          if (e.key === "]") {
            e.preventDefault()
            const nextUnreviewed = sorted.find(
              (f, i) => !f.reviewed && i > selectedIndex
            )
            if (nextUnreviewed) onSelectFile(nextUnreviewed)
          }
          break
        }
        case "[": {
          if (e.key === "[") {
            e.preventDefault()
            const prevUnreviewed = [...sorted]
              .slice(0, selectedIndex)
              .reverse()
              .find((f) => !f.reviewed)
            if (prevUnreviewed) onSelectFile(prevUnreviewed)
          }
          break
        }
      }
    },
    [selectedIndex, sorted, selectedFileId, onSelectFile, onToggleReviewed, onMarkAndNext]
  )

  useEffect(() => {
    window.addEventListener("keydown", handleKeyboard)
    return () => window.removeEventListener("keydown", handleKeyboard)
  }, [handleKeyboard])

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div ref={listRef} className="py-1">
        {sorted.map((file) => {
          const Icon = statusIcons[file.status]
          const isSelected = file.id === selectedFileId
          const fileName = file.path.split("/").pop() ?? file.path
          const dirPath = file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : ""

          return (
            <button
              key={file.id}
              onClick={() => onSelectFile(file)}
              onDoubleClick={() => onToggleReviewed(file)}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted/50",
                file.reviewed && "opacity-50"
              )}
            >
              <span className="shrink-0 w-4 text-center">
                {file.reviewed ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <span className={cn("text-xs font-mono font-bold", statusColors[file.status])}>
                    {statusLetters[file.status]}
                  </span>
                )}
              </span>

              <Icon className={cn("h-3.5 w-3.5 shrink-0", statusColors[file.status])} />

              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{fileName}</span>
                {dirPath && (
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {dirPath}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </ScrollArea>
  )
}
