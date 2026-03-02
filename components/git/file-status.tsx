"use client"

import { useCallback, useEffect, useMemo } from "react"
import {
  Plus,
  Minus,
  Undo2,
  ChevronRight,
  FileIcon,
  CirclePlus,
  CircleMinus,
  Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { GitFileStatus } from "@/types"

type SortMode = "name-asc" | "name-desc" | "status" | "path"

function sortByMode<T extends { path: string }>(items: T[], mode: SortMode, statusKey?: keyof T): T[] {
  const sorted = [...items]
  switch (mode) {
    case "name-asc":
      return sorted.sort((a, b) => {
        const an = a.path.split("/").pop() ?? a.path
        const bn = b.path.split("/").pop() ?? b.path
        return an.localeCompare(bn)
      })
    case "name-desc":
      return sorted.sort((a, b) => {
        const an = a.path.split("/").pop() ?? a.path
        const bn = b.path.split("/").pop() ?? b.path
        return bn.localeCompare(an)
      })
    case "status":
      if (statusKey) {
        return sorted.sort((a, b) => String(a[statusKey]).localeCompare(String(b[statusKey])))
      }
      return sorted
    case "path":
      return sorted.sort((a, b) => a.path.localeCompare(b.path))
    default:
      return sorted
  }
}

interface FileStatusListProps {
  staged: GitFileStatus[]
  unstaged: GitFileStatus[]
  untracked: string[]
  conflicted: string[]
  selectedFile: string | null
  selectedStaged: boolean
  reviewedFiles: Set<string>
  sortMode?: SortMode
  onSelectFile: (file: string, staged: boolean) => void
  onStageFiles: (files: string[]) => void
  onUnstageFiles: (files: string[]) => void
  onStageAll: () => void
  onUnstageAll: () => void
  onDiscardFiles: (files: string[]) => void
  onToggleReviewed: (path: string) => void
}

export function FileStatusList({
  staged,
  unstaged,
  untracked,
  conflicted,
  selectedFile,
  selectedStaged,
  reviewedFiles,
  sortMode = "path",
  onSelectFile,
  onStageFiles,
  onUnstageFiles,
  onStageAll,
  onUnstageAll,
  onDiscardFiles,
  onToggleReviewed,
}: FileStatusListProps) {
  const hasUnstaged = unstaged.length > 0 || untracked.length > 0
  const hasStaged = staged.length > 0

  // Apply sorting within each section
  const sortedStaged = useMemo(() => sortByMode(staged, sortMode, "index"), [staged, sortMode])
  const sortedUnstaged = useMemo(() => sortByMode(unstaged, sortMode, "workingDir"), [unstaged, sortMode])
  const sortedUntracked = useMemo(
    () => sortByMode(untracked.map((p) => ({ path: p })), sortMode).map((f) => f.path),
    [untracked, sortMode]
  )
  const sortedConflicted = useMemo(
    () => sortByMode(conflicted.map((p) => ({ path: p })), sortMode).map((f) => f.path),
    [conflicted, sortMode]
  )

  // Flat ordered list for keyboard navigation — matches display order
  const flatFiles = [
    ...sortedStaged.map((f) => ({ path: f.path, isStaged: true })),
    ...sortedUnstaged.map((f) => ({ path: f.path, isStaged: false })),
    ...sortedUntracked.map((path) => ({ path, isStaged: false })),
    ...sortedConflicted.map((path) => ({ path, isStaged: false })),
  ]

  const selectedIndex = flatFiles.findIndex(
    (f) => f.path === selectedFile && f.isStaged === selectedStaged
  )

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
          const nextIdx = Math.min(selectedIndex + 1, flatFiles.length - 1)
          const next = flatFiles[nextIdx]
          if (next) onSelectFile(next.path, next.isStaged)
          break
        }
        case "k": {
          e.preventDefault()
          const prevIdx = Math.max(selectedIndex - 1, 0)
          const prev = flatFiles[prevIdx]
          if (prev) onSelectFile(prev.path, prev.isStaged)
          break
        }
        case "r": {
          e.preventDefault()
          if (selectedFile !== null) onToggleReviewed(selectedFile)
          break
        }
        case "]": {
          e.preventDefault()
          const nextUnreviewed = flatFiles.find(
            (f, i) => !reviewedFiles.has(f.path) && i > selectedIndex
          )
          if (nextUnreviewed) onSelectFile(nextUnreviewed.path, nextUnreviewed.isStaged)
          break
        }
        case "[": {
          e.preventDefault()
          const prevUnreviewed = [...flatFiles]
            .slice(0, selectedIndex)
            .reverse()
            .find((f) => !reviewedFiles.has(f.path))
          if (prevUnreviewed) onSelectFile(prevUnreviewed.path, prevUnreviewed.isStaged)
          break
        }
        case "s": {
          e.preventDefault()
          if (selectedFile === null) break
          const current = flatFiles[selectedIndex]
          if (!current) break
          if (current.isStaged) {
            onUnstageFiles([current.path])
          } else {
            onStageFiles([current.path])
          }
          break
        }
      }
    },
    [selectedIndex, flatFiles, selectedFile, reviewedFiles, onSelectFile, onToggleReviewed, onStageFiles, onUnstageFiles]
  )

  useEffect(() => {
    window.addEventListener("keydown", handleKeyboard)
    return () => window.removeEventListener("keydown", handleKeyboard)
  }, [handleKeyboard])

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-1 p-2">
        {/* Staged files */}
        <FileSection
          title="Staged"
          count={staged.length}
          headerAction={
            hasStaged ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onUnstageAll}
                  >
                    <Minus className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Unstage all</TooltipContent>
              </Tooltip>
            ) : null
          }
        >
          {sortedStaged.map((file) => (
            <FileRow
              key={`staged-${file.path}`}
              path={file.path}
              statusChar={file.index}
              statusColor="text-green-500"
              isSelected={selectedFile === file.path && selectedStaged}
              isReviewed={reviewedFiles.has(file.path)}
              onClick={() => onSelectFile(file.path, true)}
              onToggleReviewed={() => onToggleReviewed(file.path)}
              actions={
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(event) => {
                        event.stopPropagation()
                        onUnstageFiles([file.path])
                      }}
                    >
                      <CircleMinus className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Unstage</TooltipContent>
                </Tooltip>
              }
            />
          ))}
        </FileSection>

        {/* Unstaged (modified) files */}
        <FileSection
          title="Changes"
          count={unstaged.length + untracked.length}
          headerAction={
            hasUnstaged ? (
              <div className="flex gap-0.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={onStageAll}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Stage all</TooltipContent>
                </Tooltip>
              </div>
            ) : null
          }
        >
          {sortedUnstaged.map((file) => (
            <FileRow
              key={`unstaged-${file.path}`}
              path={file.path}
              statusChar={file.workingDir}
              statusColor="text-yellow-500"
              isSelected={selectedFile === file.path && !selectedStaged}
              isReviewed={reviewedFiles.has(file.path)}
              onClick={() => onSelectFile(file.path, false)}
              onToggleReviewed={() => onToggleReviewed(file.path)}
              actions={
                <div className="flex gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(event) => {
                          event.stopPropagation()
                          onDiscardFiles([file.path])
                        }}
                      >
                        <Undo2 className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Discard</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(event) => {
                          event.stopPropagation()
                          onStageFiles([file.path])
                        }}
                      >
                        <CirclePlus className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Stage</TooltipContent>
                  </Tooltip>
                </div>
              }
            />
          ))}
          {sortedUntracked.map((path) => (
            <FileRow
              key={`untracked-${path}`}
              path={path}
              statusChar="?"
              statusColor="text-muted-foreground"
              isSelected={selectedFile === path && !selectedStaged}
              isReviewed={reviewedFiles.has(path)}
              onClick={() => onSelectFile(path, false)}
              onToggleReviewed={() => onToggleReviewed(path)}
              actions={
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(event) => {
                        event.stopPropagation()
                        onStageFiles([path])
                      }}
                    >
                      <CirclePlus className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Stage</TooltipContent>
                </Tooltip>
              }
            />
          ))}
        </FileSection>

        {/* Conflicted files */}
        {conflicted.length > 0 && (
          <FileSection title="Conflicts" count={conflicted.length}>
            {sortedConflicted.map((path) => (
              <FileRow
                key={`conflicted-${path}`}
                path={path}
                statusChar="!"
                statusColor="text-red-500"
                isSelected={selectedFile === path}
                isReviewed={reviewedFiles.has(path)}
                onClick={() => onSelectFile(path, false)}
                onToggleReviewed={() => onToggleReviewed(path)}
              />
            ))}
          </FileSection>
        )}
      </div>
    </ScrollArea>
  )
}

function FileSection({
  title,
  count,
  headerAction,
  children,
}: {
  title: string
  count: number
  headerAction?: React.ReactNode
  children: React.ReactNode
}) {
  if (count === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between px-1 py-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ChevronRight className="size-3.5" />
          <span>{title}</span>
          <span className="text-muted-foreground/60">({count})</span>
        </div>
        {headerAction}
      </div>
      <div className="space-y-px">{children}</div>
    </div>
  )
}

function FileRow({
  path,
  statusChar,
  statusColor,
  isSelected,
  isReviewed,
  onClick,
  onToggleReviewed,
  actions,
}: {
  path: string
  statusChar: string
  statusColor: string
  isSelected: boolean
  isReviewed: boolean
  onClick: () => void
  onToggleReviewed: () => void
  actions?: React.ReactNode
}) {
  const fileName = path.split("/").pop() ?? path
  const dirPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs cursor-pointer hover:bg-accent/50",
        isSelected && "bg-accent",
        isReviewed && "opacity-60"
      )}
      onClick={onClick}
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
      <div className="flex shrink-0 items-center gap-0.5">
        {actions}
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
                onToggleReviewed()
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
}

const statusLabels: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  U: "Updated",
  "?": "Untracked",
  "!": "Conflict",
}

export function getStatusLabel(char: string): string {
  return statusLabels[char] ?? char
}
