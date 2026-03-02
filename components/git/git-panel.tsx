"use client"

import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ArrowUpFromLine,
  ArrowDownToLine,
  RefreshCw,
  Package,
  GitBranch,
  History,
  FileText,
  GitCompare,
  Clock,
  X,
  ChevronRight,
  ChevronDown,
  ArrowUpDown,
  GripVertical,
} from "lucide-react"
import { FileStatusList } from "@/components/git/file-status"
import { ChangedFileList } from "@/components/git/changed-file-list"
import { ReviewEditor } from "@/components/review/review-editor"
import { CommitPanel } from "@/components/git/commit-panel"
import { BranchSelector } from "@/components/git/branch-selector"
import { CommitLog } from "@/components/git/commit-log"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  useGitStatus,
  useGitLog,
  useGitBranches,
  useGitFileContent,
  useGitFileContentAtRef,
  useGitChangedFiles,
  useGitStage,
  useGitUnstage,
  useGitDiscard,
  useGitCommit,
  useGitPush,
  useGitPull,
  useGitFetch,
  useGitCreateBranch,
  useGitSwitchBranch,
  useGitDeleteBranch,
  useGitStashSave,
  useGitStashList,
  useGitStashPop,
  useGitStashDrop,
} from "@/hooks/use-git"
import type { Workspace, ReviewChangedFile } from "@/types"

type ViewMode = "working" | "branch" | "last-commit"
type BottomPanel = "branches" | "log" | "stashes" | null
type SortMode = "name-asc" | "name-desc" | "status" | "path"

const SORT_LABELS: Record<SortMode, string> = {
  "name-asc": "Name A-Z",
  "name-desc": "Name Z-A",
  status: "Status",
  path: "Full path",
}

function sortFiles(files: ReviewChangedFile[], mode: SortMode): ReviewChangedFile[] {
  const sorted = [...files]
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
      return sorted.sort((a, b) => a.status.localeCompare(b.status))
    case "path":
      return sorted.sort((a, b) => a.path.localeCompare(b.path))
    default:
      return sorted
  }
}

const MIN_PANEL_WIDTH = 200
const MAX_PANEL_WIDTH = 600
const DEFAULT_PANEL_WIDTH = 300

interface GitPanelProps {
  workspace: Workspace
  onClose: () => void
}

export function GitPanel({ workspace, onClose }: GitPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedStaged, setSelectedStaged] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("working")
  const [compareBaseRef, setCompareBaseRef] = useState<string | null>(null)
  const [reviewedFiles, setReviewedFiles] = useState<Set<string>>(new Set())
  const [openPanel, setOpenPanel] = useState<BottomPanel>(null)
  const [sortMode, setSortMode] = useState<SortMode>("path")
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)

  // Drag-to-resize state
  const isDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
      dragStartX.current = e.clientX
      dragStartWidth.current = panelWidth

      const handleDragMove = (me: MouseEvent) => {
        if (!isDragging.current) return
        const delta = me.clientX - dragStartX.current
        const newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, dragStartWidth.current + delta))
        setPanelWidth(newWidth)
      }

      const handleDragEnd = () => {
        isDragging.current = false
        document.removeEventListener("mousemove", handleDragMove)
        document.removeEventListener("mouseup", handleDragEnd)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }

      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      document.addEventListener("mousemove", handleDragMove)
      document.addEventListener("mouseup", handleDragEnd)
    },
    [panelWidth]
  )

  const { data: status, isLoading: isStatusLoading } = useGitStatus(workspace.id)
  const { data: log = [], isLoading: isLogLoading } = useGitLog(workspace.id)
  const { data: branches = [] } = useGitBranches(workspace.id)
  const { data: stashes = [] } = useGitStashList(workspace.id)

  const lastCommitBaseRef = viewMode === "last-commit" ? "HEAD~1" : null
  const branchBaseRef = viewMode === "branch" ? compareBaseRef : null

  const { data: changedFiles = [], isLoading: isChangedFilesLoading } = useGitChangedFiles(
    workspace.id,
    branchBaseRef ?? lastCommitBaseRef
  )

  const sortedChangedFiles = useMemo(
    () => sortFiles(changedFiles, sortMode),
    [changedFiles, sortMode]
  )

  const activeBaseRef = branchBaseRef ?? lastCommitBaseRef
  const lastCommitCurrentRef = viewMode === "last-commit" ? "HEAD" : null

  const { data: workingFileContent, isLoading: isWorkingContentLoading } = useGitFileContent(
    viewMode === "working" ? workspace.id : null,
    selectedFile,
    selectedStaged
  )
  const { data: refFileContent, isLoading: isRefContentLoading } = useGitFileContentAtRef(
    viewMode !== "working" ? workspace.id : null,
    selectedFile,
    activeBaseRef,
    lastCommitCurrentRef
  )

  const fileContent = viewMode === "working" ? workingFileContent : refFileContent
  const isFileContentLoading = viewMode === "working" ? isWorkingContentLoading : isRefContentLoading

  const stageMutation = useGitStage(workspace.id)
  const unstageMutation = useGitUnstage(workspace.id)
  const discardMutation = useGitDiscard(workspace.id)
  const commitMutation = useGitCommit(workspace.id)
  const pushMutation = useGitPush(workspace.id)
  const pullMutation = useGitPull(workspace.id)
  const fetchMutation = useGitFetch(workspace.id)
  const createBranchMutation = useGitCreateBranch(workspace.id)
  const switchBranchMutation = useGitSwitchBranch(workspace.id)
  const deleteBranchMutation = useGitDeleteBranch(workspace.id)
  const stashSaveMutation = useGitStashSave(workspace.id)
  const stashPopMutation = useGitStashPop(workspace.id)
  const stashDropMutation = useGitStashDrop(workspace.id)

  const handleSelectFile = useCallback((file: string, staged: boolean) => {
    setSelectedFile(file)
    setSelectedStaged(staged)
  }, [])

  const handleSelectChangedFile = useCallback((file: string) => {
    setSelectedFile(file)
    setSelectedStaged(false)
  }, [])

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    setSelectedFile(null)
    setSelectedStaged(false)
    setReviewedFiles(new Set())
  }, [])

  const handleToggleReviewed = useCallback((path: string) => {
    setReviewedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handleTogglePanel = useCallback((panel: BottomPanel) => {
    setOpenPanel((prev) => (prev === panel ? null : panel))
  }, [])

  const handleStageFiles = useCallback(
    (files: string[]) => stageMutation.mutate({ action: "stage", files }),
    [stageMutation]
  )

  const handleUnstageFiles = useCallback(
    (files: string[]) => unstageMutation.mutate({ action: "unstage", files }),
    [unstageMutation]
  )

  const handleStageAll = useCallback(
    () => stageMutation.mutate({ action: "stage-all", files: [] }),
    [stageMutation]
  )

  const handleUnstageAll = useCallback(
    () => unstageMutation.mutate({ action: "unstage-all", files: [] }),
    [unstageMutation]
  )

  const handleDiscardFiles = useCallback(
    (files: string[]) => discardMutation.mutate({ action: "discard", files }),
    [discardMutation]
  )

  const handleCommit = useCallback(
    (message: string) => commitMutation.mutate({ action: "commit", message }),
    [commitMutation]
  )

  const handlePush = useCallback(
    () => pushMutation.mutate({ action: "push" }),
    [pushMutation]
  )

  const handlePull = useCallback(
    () => pullMutation.mutate({ action: "pull" }),
    [pullMutation]
  )

  const handleFetch = useCallback(
    () => fetchMutation.mutate({ action: "fetch" }),
    [fetchMutation]
  )

  const handleCreateBranch = useCallback(
    (branchName: string) => createBranchMutation.mutate({ action: "create-branch", branchName }),
    [createBranchMutation]
  )

  const handleSwitchBranch = useCallback(
    (branchName: string) => switchBranchMutation.mutate({ action: "switch-branch", branchName }),
    [switchBranchMutation]
  )

  const handleDeleteBranch = useCallback(
    (branchName: string) => deleteBranchMutation.mutate({ action: "delete-branch", branchName }),
    [deleteBranchMutation]
  )

  const handleStashSave = useCallback(
    () => stashSaveMutation.mutate({ action: "stash-save" }),
    [stashSaveMutation]
  )

  const handleStashPop = useCallback(
    (index: number) => stashPopMutation.mutate({ action: "stash-pop", index }),
    [stashPopMutation]
  )

  const handleStashDrop = useCallback(
    (index: number) => stashDropMutation.mutate({ action: "stash-drop", index }),
    [stashDropMutation]
  )

  const comparableBranches = useMemo(
    () => branches.filter((b) => !b.current),
    [branches]
  )

  const hasMultipleBranches = comparableBranches.length > 0

  // Cycle through sort modes
  const cycleSortMode = useCallback(() => {
    const modes: SortMode[] = ["name-asc", "name-desc", "status", "path"]
    const idx = modes.indexOf(sortMode)
    setSortMode(modes[(idx + 1) % modes.length])
  }, [sortMode])

  if (isStatusLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading git status...
      </div>
    )
  }

  if (!status?.isRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          This workspace is not a git repository
        </p>
      </div>
    )
  }

  const isAnyRemoteOp = pushMutation.isPending || pullMutation.isPending || fetchMutation.isPending

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium truncate">
          <GitBranch className="size-4 shrink-0" />
          <span className="truncate">{workspace.name}</span>
          <span className="text-xs text-muted-foreground font-mono">
            ({status.branch})
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleFetch}
                disabled={isAnyRemoteOp}
              >
                <RefreshCw className={fetchMutation.isPending ? "size-3.5 animate-spin" : "size-3.5"} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fetch</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handlePull}
                disabled={isAnyRemoteOp}
              >
                <ArrowDownToLine className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Pull</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handlePush}
                disabled={isAnyRemoteOp}
              >
                <ArrowUpFromLine className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Push</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleStashSave}
                disabled={stashSaveMutation.isPending}
              >
                <Package className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stash changes</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon-xs" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* View mode toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={viewMode === "working" ? "secondary" : "ghost"}
              size="icon-xs"
              onClick={() => handleViewModeChange("working")}
            >
              <FileText className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div>
              <p className="font-medium">Working Changes</p>
              <p className="text-muted-foreground">Uncommitted changes (git status)</p>
            </div>
          </TooltipContent>
        </Tooltip>
        {hasMultipleBranches && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === "branch" ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={() => handleViewModeChange("branch")}
              >
                <GitCompare className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <div>
                <p className="font-medium">Branch Comparison</p>
                <p className="text-muted-foreground">Diff between current branch and another</p>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={viewMode === "last-commit" ? "secondary" : "ghost"}
              size="icon-xs"
              onClick={() => handleViewModeChange("last-commit")}
            >
              <Clock className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div>
              <p className="font-medium">Last Commit</p>
              <p className="text-muted-foreground">Review what was in the most recent commit</p>
            </div>
          </TooltipContent>
        </Tooltip>

        {viewMode === "branch" && (
          <Select
            value={compareBaseRef ?? ""}
            onValueChange={(value) => {
              setCompareBaseRef(value || null)
              setSelectedFile(null)
            }}
          >
            <SelectTrigger className="h-6 text-xs ml-1 w-40">
              <SelectValue placeholder="Compare with..." />
            </SelectTrigger>
            <SelectContent>
              {comparableBranches.map((branch) => (
                <SelectItem key={branch.name} value={branch.name} className="text-xs">
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex-1" />
      </div>

      {/* Main area: file list + drag handle + editor */}
      <div className="flex min-h-0 flex-1">
        {/* File list (left) */}
        <div
          className="flex min-h-0 shrink-0 flex-col border-r"
          style={{ width: panelWidth }}
        >
          {/* Sort bar */}
          <div className="flex shrink-0 items-center justify-between border-b px-2 py-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={cycleSortMode}
                >
                  <ArrowUpDown className="size-3.5" />
                  <span>{SORT_LABELS[sortMode]}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Cycle sort order</TooltipContent>
            </Tooltip>
          </div>

          {viewMode === "working" ? (
            <>
              <FileStatusList
                staged={status.staged}
                unstaged={status.unstaged}
                untracked={status.untracked}
                conflicted={status.conflicted}
                selectedFile={selectedFile}
                selectedStaged={selectedStaged}
                reviewedFiles={reviewedFiles}
                sortMode={sortMode}
                onSelectFile={handleSelectFile}
                onStageFiles={handleStageFiles}
                onUnstageFiles={handleUnstageFiles}
                onStageAll={handleStageAll}
                onUnstageAll={handleUnstageAll}
                onDiscardFiles={handleDiscardFiles}
                onToggleReviewed={handleToggleReviewed}
              />
              <CommitPanel
                stagedCount={status.staged.length}
                onCommit={handleCommit}
                isCommitting={commitMutation.isPending}
              />
            </>
          ) : (
            <ChangedFileList
              files={sortedChangedFiles}
              selectedFile={selectedFile}
              isLoading={isChangedFilesLoading}
              reviewedFiles={reviewedFiles}
              emptyMessage={
                viewMode === "branch" && !compareBaseRef
                  ? "Select a branch to compare"
                  : "No changed files"
              }
              onSelectFile={handleSelectChangedFile}
              onToggleReviewed={handleToggleReviewed}
            />
          )}
        </div>

        {/* Drag handle */}
        <div
          className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent/50 active:bg-accent transition-colors"
          onMouseDown={handleDragStart}
        >
          <GripVertical className="size-3.5 text-muted-foreground/30" />
        </div>

        {/* Editor (right) */}
        <div className="flex min-h-0 flex-1 flex-col">
          {fileContent ? (
            <ReviewEditor
              fileContent={fileContent}
              workspaceId={workspace.id}
              isLoading={isFileContentLoading}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {selectedFile ? (
                isFileContentLoading ? "Loading..." : "Failed to load file"
              ) : (
                "Select a file to view diff"
              )}
            </div>
          )}
        </div>
      </div>

      {/* Collapsible bottom section */}
      <div className="shrink-0 border-t">
        {/* Panel headers strip */}
        <div className="flex items-center border-b">
          <PanelTab
            icon={<GitBranch className="size-3.5" />}
            label="Branches"
            isOpen={openPanel === "branches"}
            onClick={() => handleTogglePanel("branches")}
          />
          <PanelTab
            icon={<History className="size-3.5" />}
            label="Log"
            isOpen={openPanel === "log"}
            onClick={() => handleTogglePanel("log")}
          />
          <PanelTab
            icon={<Package className="size-3.5" />}
            label={stashes.length > 0 ? `Stashes (${stashes.length})` : "Stashes"}
            isOpen={openPanel === "stashes"}
            onClick={() => handleTogglePanel("stashes")}
          />
        </div>

        {/* Panel body — flex column so inner ScrollArea can fill */}
        {openPanel !== null && (
          <div className="flex h-56 flex-col">
            {openPanel === "branches" && (
              <BranchSelector
                branches={branches}
                currentBranch={status.branch}
                onSwitch={handleSwitchBranch}
                onCreate={handleCreateBranch}
                onDelete={handleDeleteBranch}
                isSwitching={switchBranchMutation.isPending}
              />
            )}
            {openPanel === "log" && (
              <CommitLog
                entries={log}
                workspaceId={workspace.id}
                isLoading={isLogLoading}
              />
            )}
            {openPanel === "stashes" && (
              <StashList
                stashes={stashes}
                onPop={handleStashPop}
                onDrop={handleStashDrop}
                isPopping={stashPopMutation.isPending}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PanelTab({
  icon,
  label,
  isOpen,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  isOpen: boolean
  onClick: () => void
}) {
  return (
    <button
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors hover:bg-muted/50",
        isOpen ? "text-foreground font-medium" : "text-muted-foreground"
      )}
      onClick={onClick}
    >
      {isOpen ? (
        <ChevronDown className="size-3.5" />
      ) : (
        <ChevronRight className="size-3.5" />
      )}
      {icon}
      <span>{label}</span>
    </button>
  )
}

function StashList({
  stashes,
  onPop,
  onDrop,
  isPopping,
}: {
  stashes: { index: number; hash: string; message: string; date: string }[]
  onPop: (index: number) => void
  onDrop: (index: number) => void
  isPopping: boolean
}) {
  if (stashes.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        No stashes
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-px p-2">
        {stashes.map((stash) => (
          <div
            key={stash.index}
            className="group flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent/50"
          >
            <Package className="size-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <span className="font-mono text-primary/70">stash@{`{${stash.index}}`}</span>
              <span className="ml-2 truncate">{stash.message}</span>
            </div>
            <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onPop(stash.index)}
                    disabled={isPopping}
                  >
                    <ArrowDownToLine className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Pop stash</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="hover:text-destructive"
                    onClick={() => onDrop(stash.index)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Drop stash</TooltipContent>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
