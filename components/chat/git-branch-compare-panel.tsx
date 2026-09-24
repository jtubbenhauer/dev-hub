"use client";

import { useCallback, useMemo, useState } from "react";

import { ArrowUpDown, FolderTree, RefreshCw, X } from "lucide-react";

import { SidePanelDiffView } from "@/components/chat/side-panel-diff-view";
import { useGitDiffDialog } from "@/components/chat/git-diff-dialog";
import { ChangedFileList } from "@/components/git/changed-file-list";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGitBranches, useGitChangedFiles } from "@/hooks/use-git";
import { useGitFolderGrouping } from "@/hooks/use-git-folder-grouping";
import {
  SORT_LABELS,
  getNextSortMode,
  sortFiles,
  type SortMode,
} from "@/lib/git-panel-logic";
import { cn } from "@/lib/utils";
import { useGitReviewStore } from "@/stores/git-review-store";
import { useSidePanelStore } from "@/stores/side-panel-store";

import type { GitBranch } from "@/types";

export function getDefaultCompareBranch(
  comparableBranches: GitBranch[],
): string | null {
  const defaultBranch = comparableBranches.find(
    (b) => b.name === "main" || b.name === "master",
  );
  return defaultBranch?.name ?? null;
}

export function GitBranchComparePanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { data: branches, isLoading: isBranchesLoading } =
    useGitBranches(workspaceId);
  const storedBaseRef = useSidePanelStore(
    (s) => s.branchCompareBaseRefs[workspaceId] ?? null,
  );
  const setBranchCompareBaseRef = useSidePanelStore(
    (s) => s.setBranchCompareBaseRef,
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const { isDialogMode, openDiffDialog, diffDialog } =
    useGitDiffDialog(workspaceId);

  const comparableBranches = useMemo(
    () => (branches ?? []).filter((b) => !b.current),
    [branches],
  );
  const currentBranchName = branches?.find((b) => b.current)?.name ?? null;

  const isStoredBaseRefValid =
    !!storedBaseRef && comparableBranches.some((b) => b.name === storedBaseRef);
  const baseRef = isStoredBaseRefValid
    ? storedBaseRef
    : getDefaultCompareBranch(comparableBranches);

  const {
    data: changedFiles = [],
    isLoading: isChangedFilesLoading,
    isFetching: isChangedFilesFetching,
    error: changedFilesError,
    refetch: refetchChangedFiles,
  } = useGitChangedFiles(workspaceId, baseRef);

  const [sortMode, setSortMode] = useState<SortMode>("path");
  const {
    isGroupedByFolder,
    toggleGroupedByFolder,
    collapsedFolders,
    toggleFolder,
  } = useGitFolderGrouping(workspaceId);

  const sortedChangedFiles = useMemo(
    () => sortFiles(changedFiles, sortMode),
    [changedFiles, sortMode],
  );

  // Same key format as the git page's branch view so reviewed marks are shared.
  const reviewKey = `${workspaceId}:branch:${baseRef ?? ""}`;
  const reviewedPaths = useGitReviewStore((s) => s.reviewedFiles[reviewKey]);
  const reviewedFiles = useMemo(
    () => new Set(reviewedPaths ?? []),
    [reviewedPaths],
  );
  const handleToggleReviewed = useCallback(
    (path: string) => {
      useGitReviewStore.getState().toggleReviewed(reviewKey, path);
    },
    [reviewKey],
  );

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const file of changedFiles) {
      additions += file.additions ?? 0;
      deletions += file.deletions ?? 0;
    }
    return { additions, deletions };
  }, [changedFiles]);

  const activeSelectedPath =
    selectedPath && changedFiles.some((f) => f.path === selectedPath)
      ? selectedPath
      : null;

  const handleBaseRefChange = (value: string) => {
    setBranchCompareBaseRef(workspaceId, value);
    setSelectedPath(null);
  };

  const handleSelectFile = (path: string) => {
    if (!baseRef) return;
    if (isDialogMode) {
      openDiffDialog(path, false, baseRef);
      return;
    }
    setSelectedPath(path);
  };

  if (isBranchesLoading) {
    return (
      <div className="text-muted-foreground px-3 py-4 text-xs">Loading…</div>
    );
  }

  if (comparableBranches.length === 0) {
    return (
      <div
        className="text-muted-foreground px-3 py-4 text-xs"
        data-testid="compare-no-branches"
      >
        No other branches to compare against
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100%-2.5rem)] flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <Select value={baseRef ?? ""} onValueChange={handleBaseRefChange}>
          <SelectTrigger
            className="h-6 min-w-0 flex-1 text-xs"
            data-testid="compare-base-select"
          >
            <SelectValue placeholder="Compare with…" />
          </SelectTrigger>
          <SelectContent>
            {comparableBranches.map((branch) => (
              <SelectItem
                key={branch.name}
                value={branch.name}
                className="text-xs"
              >
                {branch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {currentBranchName && (
          <span
            className="text-muted-foreground max-w-[45%] shrink-0 truncate font-mono text-[10px]"
            title={currentBranchName}
          >
            ← {currentBranchName}
          </span>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Refresh comparison"
          data-testid="compare-refresh"
          disabled={!baseRef || isChangedFilesFetching}
          onClick={() => void refetchChangedFiles()}
        >
          <RefreshCw
            className={cn("size-3", isChangedFilesFetching && "animate-spin")}
          />
        </Button>
      </div>

      <div
        className={cn(
          "flex min-h-0 flex-col",
          activeSelectedPath ? "max-h-[40%] shrink-0" : "flex-1",
        )}
      >
        {!baseRef ? (
          <p className="text-muted-foreground px-2 py-3 text-xs">
            Select a branch to compare against
          </p>
        ) : changedFilesError ? (
          <p
            className="text-destructive px-2 py-3 text-xs"
            data-testid="compare-error"
          >
            {changedFilesError instanceof Error
              ? changedFilesError.message
              : "Failed to load changed files"}
          </p>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-testid="compare-sort-toggle"
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] transition-colors"
                    onClick={() => setSortMode(getNextSortMode(sortMode))}
                  >
                    <ArrowUpDown className="size-3.5" />
                    <span>{SORT_LABELS[sortMode]}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Cycle sort order</TooltipContent>
              </Tooltip>
              <span className="flex-1" />
              {changedFiles.length > 0 && (
                <span
                  className="text-muted-foreground font-mono text-[10px] tabular-nums"
                  data-testid="compare-summary"
                >
                  {changedFiles.length}{" "}
                  {changedFiles.length === 1 ? "file" : "files"}{" "}
                  <span className="text-green-500">+{totals.additions}</span>{" "}
                  <span className="text-red-500">-{totals.deletions}</span>
                </span>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isGroupedByFolder ? "secondary" : "ghost"}
                    size="icon-xs"
                    aria-label="Group by folder"
                    aria-pressed={isGroupedByFolder}
                    data-testid="compare-group-toggle"
                    onClick={toggleGroupedByFolder}
                  >
                    <FolderTree className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Group by folder</TooltipContent>
              </Tooltip>
            </div>
            <ChangedFileList
              files={sortedChangedFiles}
              selectedFile={activeSelectedPath}
              isLoading={isChangedFilesLoading}
              reviewedFiles={reviewedFiles}
              sortMode={sortMode}
              isGroupedByFolder={isGroupedByFolder}
              collapsedFolders={collapsedFolders}
              onToggleFolder={toggleFolder}
              emptyMessage={`No differences from ${baseRef}`}
              onSelectFile={handleSelectFile}
              onToggleReviewed={handleToggleReviewed}
            />
          </>
        )}
      </div>

      {activeSelectedPath && baseRef && (
        <div
          className="flex min-h-0 flex-1 flex-col border-t"
          data-testid="compare-diff-screen"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setSelectedPath(null);
            }
          }}
        >
          <div className="flex h-8 shrink-0 items-center gap-1 border-b px-1">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Close diff"
              data-testid="compare-diff-close"
              onClick={() => setSelectedPath(null)}
            >
              <X className="size-3.5" />
            </Button>
            <span
              className="min-w-0 flex-1 truncate font-mono text-xs"
              title={activeSelectedPath}
            >
              {activeSelectedPath}
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <SidePanelDiffView
              workspaceId={workspaceId}
              filePath={activeSelectedPath}
              baseRef={baseRef}
            />
          </div>
        </div>
      )}
      {diffDialog}
    </div>
  );
}
