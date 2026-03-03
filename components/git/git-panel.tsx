"use client"

import { useState, useCallback, useMemo, useRef } from "react"
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
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
  PanelLeft,
} from "lucide-react"
import { FileStatusList } from "@/components/git/file-status"
import { ChangedFileList } from "@/components/git/changed-file-list"
import { ReviewEditor } from "@/components/review/review-editor"
import { CommitPanel } from "@/components/git/commit-panel"
import { BranchSelector } from "@/components/git/branch-selector"
import { CommitLog } from "@/components/git/commit-log"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { useLeaderAction } from "@/hooks/use-leader-action"
import { useIsMobile } from "@/hooks/use-mobile"
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
  const [isMobileFileListOpen, setIsMobileFileListOpen] = useState(false)
  const isMobile = useIsMobile()
  const { width: panelWidth, handleDragStart } = useResizablePanel({
    minWidth: MIN_PANEL_WIDTH,
    maxWidth: MAX_PANEL_WIDTH,
    defaultWidth: DEFAULT_PANEL_WIDTH,
  })

  const commitFocusRef = useRef<HTMLTextAreaElement>(null)

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
    setIsMobileFileListOpen(false)
  }, [])

  const handleSelectChangedFile = useCallback((file: string) => {
    setSelectedFile(file)
    setSelectedStaged(false)
    setIsMobileFileListOpen(false)
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
    (files: string[]) => {
      // If the currently selected file is being staged, track it into the staged section
      if (selectedFile && files.includes(selectedFile) && !selectedStaged) {
        setSelectedStaged(true)
      }
      stageMutation.mutate({ action: "stage", files })
    },
    [stageMutation, selectedFile, selectedStaged]
  )

  const handleUnstageFiles = useCallback(
    (files: string[]) => {
      // If the currently selected file is being unstaged, track it back to the unstaged section
      if (selectedFile && files.includes(selectedFile) && selectedStaged) {
        setSelectedStaged(false)
      }
      unstageMutation.mutate({ action: "unstage", files })
    },
    [unstageMutation, selectedFile, selectedStaged]
  )

  const handleStageAll = useCallback(
    () => {
      // All files move to staged — if we have a selected unstaged file, track it
      if (selectedFile && !selectedStaged) {
        setSelectedStaged(true)
      }
      stageMutation.mutate({ action: "stage-all", files: [] })
    },
    [stageMutation, selectedFile, selectedStaged]
  )

  const handleUnstageAll = useCallback(
    () => {
      // All files move to unstaged — if we have a selected staged file, track it
      if (selectedFile && selectedStaged) {
        setSelectedStaged(false)
      }
      unstageMutation.mutate({ action: "unstage-all", files: [] })
    },
    [unstageMutation, selectedFile, selectedStaged]
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

  // Stable handler refs for leader key useMemo (avoids re-registering on every render)
  const selectedFileRef = useRef(selectedFile)
  selectedFileRef.current = selectedFile
  const selectedStagedRef = useRef(selectedStaged)
  selectedStagedRef.current = selectedStaged
  const statusRef = useRef(status)
  statusRef.current = status
  const sortModeRef = useRef(sortMode)
  sortModeRef.current = sortMode
  const reviewedFilesRef = useRef(reviewedFiles)
  reviewedFilesRef.current = reviewedFiles
  const handleSelectFileRef = useRef(handleSelectFile)
  handleSelectFileRef.current = handleSelectFile
  const handleToggleReviewedRef = useRef(handleToggleReviewed)
  handleToggleReviewedRef.current = handleToggleReviewed
  const handleStageFilesRef = useRef(handleStageFiles)
  handleStageFilesRef.current = handleStageFiles
  const handleUnstageFilesRef = useRef(handleUnstageFiles)
  handleUnstageFilesRef.current = handleUnstageFiles
  const handleStageAllRef = useRef(handleStageAll)
  handleStageAllRef.current = handleStageAll
  const handleUnstageAllRef = useRef(handleUnstageAll)
  handleUnstageAllRef.current = handleUnstageAll
  const handleCommitRef = useRef(handleCommit)
  handleCommitRef.current = handleCommit
  const handleFetchRef = useRef(handleFetch)
  handleFetchRef.current = handleFetch
  const handlePullRef = useRef(handlePull)
  handlePullRef.current = handlePull
  const handlePushRef = useRef(handlePush)
  handlePushRef.current = handlePush

  const gitLeaderActions = useMemo(
    () => {
      // Builds the same flat ordered list FileStatusList uses for keyboard nav
      function buildFlatFiles(currentStatus: typeof status, currentSortMode: SortMode) {
        if (!currentStatus) return []
        const sort = <T extends { path: string }>(items: T[]) => {
          const sorted = [...items]
          switch (currentSortMode) {
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
              return sorted
            case "path":
              return sorted.sort((a, b) => a.path.localeCompare(b.path))
            default:
              return sorted
          }
        }
        return [
          ...sort(currentStatus.staged).map((f) => ({ path: f.path, isStaged: true })),
          ...sort(currentStatus.unstaged).map((f) => ({ path: f.path, isStaged: false })),
          ...sort(currentStatus.untracked.map((p) => ({ path: p }))).map((f) => ({ path: f.path, isStaged: false })),
          ...sort(currentStatus.conflicted.map((p) => ({ path: p }))).map((f) => ({ path: f.path, isStaged: false })),
        ]
      }

      return [
        {
          action: { id: "git:toggle-reviewed", label: "Toggle file reviewed", page: "git" as const },
          handler: () => {
            if (selectedFileRef.current) handleToggleReviewedRef.current(selectedFileRef.current)
          },
        },
        {
          action: { id: "git:reviewed-next", label: "Mark reviewed & next file", page: "git" as const },
          handler: () => {
            const file = selectedFileRef.current
            if (!file) return
            handleToggleReviewedRef.current(file)
            const flatFiles = buildFlatFiles(statusRef.current, sortModeRef.current)
            const selectedIndex = flatFiles.findIndex(
              (f) => f.path === selectedFileRef.current && f.isStaged === selectedStagedRef.current
            )
            const next = flatFiles[selectedIndex + 1]
            if (next) handleSelectFileRef.current(next.path, next.isStaged)
          },
        },
        {
          action: { id: "git:stage-toggle", label: "Stage/unstage current file", page: "git" as const },
          handler: () => {
            const flatFiles = buildFlatFiles(statusRef.current, sortModeRef.current)
            const selectedIndex = flatFiles.findIndex(
              (f) => f.path === selectedFileRef.current && f.isStaged === selectedStagedRef.current
            )
            const current = flatFiles[selectedIndex]
            if (!current) return
            if (current.isStaged) {
              handleUnstageFilesRef.current([current.path])
            } else {
              handleStageFilesRef.current([current.path])
            }
          },
        },
        {
          action: { id: "git:stage-all", label: "Stage all files", page: "git" as const },
          handler: () => handleStageAllRef.current(),
        },
        {
          action: { id: "git:unstage-all", label: "Unstage all files", page: "git" as const },
          handler: () => handleUnstageAllRef.current(),
        },
        {
          action: { id: "git:focus-commit", label: "Focus commit message", page: "git" as const },
          handler: () => commitFocusRef.current?.focus(),
        },
        {
          action: { id: "git:commit", label: "Commit staged files", page: "git" as const },
          handler: () => {
            // Delegates to CommitPanel's Ctrl+Enter shortcut by focusing it;
            // actual commit requires the user to have a message — just focus for now
            commitFocusRef.current?.focus()
          },
        },
        {
          action: { id: "git:fetch", label: "Fetch from remote", page: "git" as const },
          handler: () => handleFetchRef.current(),
        },
        {
          action: { id: "git:pull", label: "Pull from remote", page: "git" as const },
          handler: () => handlePullRef.current(),
        },
        {
          action: { id: "git:push", label: "Push to remote", page: "git" as const },
          handler: () => handlePushRef.current(),
        },
        {
          action: { id: "git:next-file", label: "Select next file", page: "git" as const },
          handler: () => {
            const flatFiles = buildFlatFiles(statusRef.current, sortModeRef.current)
            const selectedIndex = flatFiles.findIndex(
              (f) => f.path === selectedFileRef.current && f.isStaged === selectedStagedRef.current
            )
            const next = flatFiles[Math.min(selectedIndex + 1, flatFiles.length - 1)]
            if (next) handleSelectFileRef.current(next.path, next.isStaged)
          },
        },
        {
          action: { id: "git:prev-file", label: "Select previous file", page: "git" as const },
          handler: () => {
            const flatFiles = buildFlatFiles(statusRef.current, sortModeRef.current)
            const selectedIndex = flatFiles.findIndex(
              (f) => f.path === selectedFileRef.current && f.isStaged === selectedStagedRef.current
            )
            const prev = flatFiles[Math.max(selectedIndex - 1, 0)]
            if (prev) handleSelectFileRef.current(prev.path, prev.isStaged)
          },
        },
        {
          action: { id: "git:next-unreviewed", label: "Jump to next unreviewed", page: "git" as const },
          handler: () => {
            const flatFiles = buildFlatFiles(statusRef.current, sortModeRef.current)
            const selectedIndex = flatFiles.findIndex(
              (f) => f.path === selectedFileRef.current && f.isStaged === selectedStagedRef.current
            )
            const next = flatFiles.find((f, i) => !reviewedFilesRef.current.has(f.path) && i > selectedIndex)
            if (next) handleSelectFileRef.current(next.path, next.isStaged)
          },
        },
        {
          action: { id: "git:prev-unreviewed", label: "Jump to prev unreviewed", page: "git" as const },
          handler: () => {
            const flatFiles = buildFlatFiles(statusRef.current, sortModeRef.current)
            const selectedIndex = flatFiles.findIndex(
              (f) => f.path === selectedFileRef.current && f.isStaged === selectedStagedRef.current
            )
            const prev = [...flatFiles]
              .slice(0, selectedIndex)
              .reverse()
              .find((f) => !reviewedFilesRef.current.has(f.path))
            if (prev) handleSelectFileRef.current(prev.path, prev.isStaged)
          },
        },
      ]
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useLeaderAction(gitLeaderActions)

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
              variant="ghost"
              size="icon-xs"
              onClick={() => setIsMobileFileListOpen(true)}
              className="md:hidden"
            >
              <PanelLeft className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open file list</TooltipContent>
        </Tooltip>
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
        {/* File list - mobile sheet */}
        {isMobile && (
          <Sheet open={isMobileFileListOpen} onOpenChange={setIsMobileFileListOpen}>
            <SheetContent side="left" className="w-[280px] p-0" showCloseButton={false}>
              <SheetHeader className="border-b px-2 py-1">
                <SheetTitle className="sr-only">File list</SheetTitle>
                <button
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={cycleSortMode}
                >
                  <ArrowUpDown className="size-3.5" />
                  <span>{SORT_LABELS[sortMode]}</span>
                </button>
              </SheetHeader>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
                      focusRef={commitFocusRef}
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
            </SheetContent>
          </Sheet>
        )}

        {/* File list (left) - desktop */}
        {!isMobile && (
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
                  focusRef={commitFocusRef}
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
        )}

        {/* Drag handle - desktop only */}
        {!isMobile && (
          <div
            className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent/50 active:bg-accent transition-colors"
            onMouseDown={handleDragStart}
          >
            <GripVertical className="size-3.5 text-muted-foreground/30" />
          </div>
        )}

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
