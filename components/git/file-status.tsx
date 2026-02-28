"use client"

import {
  Plus,
  Minus,
  Undo2,
  ChevronRight,
  FileIcon,
  CirclePlus,
  CircleMinus,
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

interface FileStatusListProps {
  staged: GitFileStatus[]
  unstaged: GitFileStatus[]
  untracked: string[]
  conflicted: string[]
  selectedFile: string | null
  selectedStaged: boolean
  onSelectFile: (file: string, staged: boolean) => void
  onStageFiles: (files: string[]) => void
  onUnstageFiles: (files: string[]) => void
  onStageAll: () => void
  onUnstageAll: () => void
  onDiscardFiles: (files: string[]) => void
}

export function FileStatusList({
  staged,
  unstaged,
  untracked,
  conflicted,
  selectedFile,
  selectedStaged,
  onSelectFile,
  onStageFiles,
  onUnstageFiles,
  onStageAll,
  onUnstageAll,
  onDiscardFiles,
}: FileStatusListProps) {
  const hasUnstaged = unstaged.length > 0 || untracked.length > 0
  const hasStaged = staged.length > 0

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
                    <Minus className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Unstage all</TooltipContent>
              </Tooltip>
            ) : null
          }
        >
          {staged.map((file) => (
            <FileRow
              key={`staged-${file.path}`}
              path={file.path}
              statusChar={file.index}
              statusColor="text-green-500"
              isSelected={selectedFile === file.path && selectedStaged}
              onClick={() => onSelectFile(file.path, true)}
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
                      <CircleMinus className="size-3" />
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
                      <Plus className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Stage all</TooltipContent>
                </Tooltip>
              </div>
            ) : null
          }
        >
          {unstaged.map((file) => (
            <FileRow
              key={`unstaged-${file.path}`}
              path={file.path}
              statusChar={file.workingDir}
              statusColor="text-yellow-500"
              isSelected={selectedFile === file.path && !selectedStaged}
              onClick={() => onSelectFile(file.path, false)}
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
                        <Undo2 className="size-3" />
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
                        <CirclePlus className="size-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Stage</TooltipContent>
                  </Tooltip>
                </div>
              }
            />
          ))}
          {untracked.map((path) => (
            <FileRow
              key={`untracked-${path}`}
              path={path}
              statusChar="?"
              statusColor="text-muted-foreground"
              isSelected={selectedFile === path && !selectedStaged}
              onClick={() => onSelectFile(path, false)}
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
                      <CirclePlus className="size-3" />
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
            {conflicted.map((path) => (
              <FileRow
                key={`conflicted-${path}`}
                path={path}
                statusChar="!"
                statusColor="text-red-500"
                isSelected={selectedFile === path}
                onClick={() => onSelectFile(path, false)}
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
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <ChevronRight className="size-3" />
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
  onClick,
  actions,
}: {
  path: string
  statusChar: string
  statusColor: string
  isSelected: boolean
  onClick: () => void
  actions?: React.ReactNode
}) {
  const fileName = path.split("/").pop() ?? path
  const dirPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs cursor-pointer hover:bg-accent/50",
        isSelected && "bg-accent"
      )}
      onClick={onClick}
    >
      <span className={cn("w-4 shrink-0 text-center font-mono font-bold", statusColor)}>
        {statusChar}
      </span>
      <FileIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate flex-1">
        {fileName}
        {dirPath && (
          <span className="text-muted-foreground/60 ml-1">{dirPath}</span>
        )}
      </span>
      <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {actions}
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
