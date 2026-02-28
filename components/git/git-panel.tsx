"use client"

import { useState, useCallback } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
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
  X,
} from "lucide-react"
import { FileStatusList } from "@/components/git/file-status"
import { DiffViewer } from "@/components/git/diff-viewer"
import { CommitPanel } from "@/components/git/commit-panel"
import { BranchSelector } from "@/components/git/branch-selector"
import { CommitLog } from "@/components/git/commit-log"
import {
  useGitStatus,
  useGitLog,
  useGitBranches,
  useGitDiff,
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
import type { Workspace } from "@/types"

interface GitPanelProps {
  workspace: Workspace
  onClose: () => void
}

export function GitPanel({ workspace, onClose }: GitPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedStaged, setSelectedStaged] = useState(false)

  const { data: status, isLoading: isStatusLoading } = useGitStatus(workspace.id)
  const { data: log = [], isLoading: isLogLoading } = useGitLog(workspace.id)
  const { data: branches = [] } = useGitBranches(workspace.id)
  const { data: stashes = [] } = useGitStashList(workspace.id)
  const { data: diff, isLoading: isDiffLoading } = useGitDiff(
    workspace.id,
    selectedFile,
    selectedStaged
  )

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
    <div className="flex h-full min-h-0 flex-col border-l">
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
                <RefreshCw className={fetchMutation.isPending ? "size-3 animate-spin" : "size-3"} />
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
                <ArrowDownToLine className="size-3" />
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
                <ArrowUpFromLine className="size-3" />
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
                <Package className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stash changes</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon-xs" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Main tabs area */}
      <Tabs defaultValue="status" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="shrink-0 w-full justify-start rounded-none border-b" variant="line">
          <TabsTrigger value="status" className="gap-1 text-xs">
            <FileText className="size-3" />
            Status
          </TabsTrigger>
          <TabsTrigger value="branches" className="gap-1 text-xs">
            <GitBranch className="size-3" />
            Branches
          </TabsTrigger>
          <TabsTrigger value="log" className="gap-1 text-xs">
            <History className="size-3" />
            Log
          </TabsTrigger>
          {stashes.length > 0 && (
            <TabsTrigger value="stashes" className="gap-1 text-xs">
              <Package className="size-3" />
              Stash ({stashes.length})
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="status" className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {/* File list (left) */}
            <div className="flex w-64 min-h-0 shrink-0 flex-col border-r">
              <FileStatusList
                staged={status.staged}
                unstaged={status.unstaged}
                untracked={status.untracked}
                conflicted={status.conflicted}
                selectedFile={selectedFile}
                selectedStaged={selectedStaged}
                onSelectFile={handleSelectFile}
                onStageFiles={handleStageFiles}
                onUnstageFiles={handleUnstageFiles}
                onStageAll={handleStageAll}
                onUnstageAll={handleUnstageAll}
                onDiscardFiles={handleDiscardFiles}
              />
              <CommitPanel
                stagedCount={status.staged.length}
                onCommit={handleCommit}
                isCommitting={commitMutation.isPending}
              />
            </div>

            {/* Diff viewer (right) */}
            <div className="flex min-h-0 flex-1 flex-col">
              <DiffViewer
                diff={diff ?? ""}
                fileName={selectedFile ?? undefined}
                isLoading={isDiffLoading}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="branches" className="flex min-h-0 flex-1 flex-col">
          <BranchSelector
            branches={branches}
            currentBranch={status.branch}
            onSwitch={handleSwitchBranch}
            onCreate={handleCreateBranch}
            onDelete={handleDeleteBranch}
            isSwitching={switchBranchMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="log" className="flex min-h-0 flex-1 flex-col">
          <CommitLog
            entries={log}
            workspaceId={workspace.id}
            isLoading={isLogLoading}
          />
        </TabsContent>

        {stashes.length > 0 && (
          <TabsContent value="stashes" className="flex min-h-0 flex-1 flex-col">
            <StashList
              stashes={stashes}
              onPop={handleStashPop}
              onDrop={handleStashDrop}
              isPopping={stashPopMutation.isPending}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
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
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-px p-2">
        {stashes.map((stash) => (
          <div
            key={stash.index}
            className="group flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent/50"
          >
            <Package className="size-3 shrink-0 text-muted-foreground" />
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
                    <ArrowDownToLine className="size-3" />
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
                    <X className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Drop stash</TooltipContent>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}


