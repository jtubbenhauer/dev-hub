"use client";

import { useCallback, useMemo, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Minus, Plus } from "lucide-react";

import { GitSyncControls } from "@/components/chat/git-sync-controls";
import { GitRevertDialog } from "@/components/chat/git-revert-dialog";
import { GitRevertAction } from "@/components/chat/git-revert-action";
import { useGitDiffDialog } from "@/components/chat/git-diff-dialog";
import { useGitRevert } from "@/hooks/use-git-revert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useGitStatus,
  useGitFileDiffs,
  useGitStage,
  useGitUnstage,
  useGitCommit,
} from "@/hooks/use-git";
import { cn } from "@/lib/utils";

import type { GitStatusResult } from "@/types";

type GitRowSection = "staged" | "changes" | "untracked" | "conflicts";

interface GitRow {
  path: string;
  statusChar: string;
  statusColor: string;
  section: GitRowSection;
  staged: boolean;
}

// Normalize the raw git status into flat rows, giving conflicted paths
// precedence: a conflicted path renders ONLY under Conflicts and is excluded
// from Staged/Changes even when git also lists it there.
function buildGitRows(status: GitStatusResult): GitRow[] {
  const conflictedSet = new Set(status.conflicted);
  const rows: GitRow[] = [];

  for (const file of status.staged) {
    if (conflictedSet.has(file.path)) continue;
    rows.push({
      path: file.path,
      statusChar: file.index,
      statusColor: "text-green-500",
      section: "staged",
      staged: true,
    });
  }

  for (const file of status.unstaged) {
    if (conflictedSet.has(file.path)) continue;
    rows.push({
      path: file.path,
      statusChar: file.workingDir,
      statusColor: "text-yellow-500",
      section: "changes",
      staged: false,
    });
  }

  for (const path of status.untracked) {
    if (conflictedSet.has(path)) continue;
    rows.push({
      path,
      statusChar: "?",
      statusColor: "text-muted-foreground",
      section: "untracked",
      staged: false,
    });
  }

  for (const path of status.conflicted) {
    rows.push({
      path,
      statusChar: "!",
      statusColor: "text-red-500",
      section: "conflicts",
      staged: false,
    });
  }

  return rows;
}

const SECTION_ORDER: { key: GitRowSection; label: string }[] = [
  { key: "staged", label: "Staged" },
  { key: "changes", label: "Changes" },
  { key: "untracked", label: "Untracked" },
  { key: "conflicts", label: "Conflicts" },
];

function isActivateKey(e: React.KeyboardEvent): boolean {
  return e.key === "Enter" || e.key === " ";
}

export function GitTabPanel({
  workspaceId,
  onSelectFile,
}: {
  workspaceId: string;
  onSelectFile: (selection: { path: string; staged: boolean }) => void;
}) {
  const queryClient = useQueryClient();
  const { data: status } = useGitStatus(workspaceId);
  const fileDiffs = useGitFileDiffs(workspaceId);

  const stageMutation = useGitStage(workspaceId);
  const unstageMutation = useGitUnstage(workspaceId);
  const commitMutation = useGitCommit(workspaceId);

  const [commitMessage, setCommitMessage] = useState("");
  const { isDialogMode, openDiffDialog, diffDialog } =
    useGitDiffDialog(workspaceId);

  const rows = useMemo(() => (status ? buildGitRows(status) : []), [status]);

  const grouped = useMemo(() => {
    const map: Record<GitRowSection, GitRow[]> = {
      staged: [],
      changes: [],
      untracked: [],
      conflicts: [],
    };
    for (const row of rows) {
      map[row.section].push(row);
    }
    return map;
  }, [rows]);

  // Unique dirty paths across every bucket (matches the Changes badge).
  const presentPaths = useMemo(() => {
    const set = new Set<string>();
    if (status) {
      for (const f of status.staged) set.add(f.path);
      for (const f of status.unstaged) set.add(f.path);
      for (const p of status.untracked) set.add(p);
      for (const p of status.conflicted) set.add(p);
    }
    return set;
  }, [status]);

  // The built-in hook invalidations only touch git-status/git-log. Diffs and
  // file-content must be refreshed too so open diff tabs never show stale
  // content after a stage/unstage/commit.
  const invalidateFreshness = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["git-file-diffs", workspaceId],
    });
    queryClient.invalidateQueries({
      queryKey: ["git-file-content", workspaceId],
    });
  }, [queryClient, workspaceId]);

  const stageMutate = stageMutation.mutate;
  const unstageMutate = unstageMutation.mutate;
  const commitMutate = commitMutation.mutate;

  const {
    revertTarget,
    isDiscarding,
    requestRevert,
    clearRevert,
    confirmRevert,
  } = useGitRevert(workspaceId, invalidateFreshness);

  const isMutating =
    stageMutation.isPending || unstageMutation.isPending || isDiscarding;

  const handleStage = useCallback(
    (path: string) => {
      stageMutate(
        { action: "stage", files: [path] },
        { onSuccess: invalidateFreshness },
      );
    },
    [stageMutate, invalidateFreshness],
  );

  const handleUnstage = useCallback(
    (path: string) => {
      unstageMutate(
        { action: "unstage", files: [path] },
        { onSuccess: invalidateFreshness },
      );
    },
    [unstageMutate, invalidateFreshness],
  );

  const handleStageAllInSection = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      stageMutate(
        { action: "stage", files: paths },
        { onSuccess: invalidateFreshness },
      );
    },
    [stageMutate, invalidateFreshness],
  );

  const handleUnstageAllInSection = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      unstageMutate(
        { action: "unstage", files: paths },
        { onSuccess: invalidateFreshness },
      );
    },
    [unstageMutate, invalidateFreshness],
  );

  const handleCommit = useCallback(() => {
    const trimmed = commitMessage.trim();
    if (!trimmed) return;
    commitMutate(
      { action: "commit", message: trimmed },
      {
        onSuccess: () => {
          invalidateFreshness();
          setCommitMessage("");
        },
      },
    );
  }, [commitMessage, commitMutate, invalidateFreshness]);

  const handleStageAllAndCommit = useCallback(() => {
    const trimmed = commitMessage.trim();
    if (!trimmed) return;
    stageMutate(
      { action: "stage-all", files: [] },
      {
        onSuccess: () => {
          invalidateFreshness();
          commitMutate(
            { action: "commit", message: trimmed },
            {
              onSuccess: () => {
                invalidateFreshness();
                setCommitMessage("");
              },
            },
          );
        },
      },
    );
  }, [commitMessage, stageMutate, commitMutate, invalidateFreshness]);

  const selectRow = (row: GitRow) => {
    if (isDialogMode) return openDiffDialog(row.path, row.staged);
    onSelectFile({ path: row.path, staged: row.section === "staged" });
  };

  // ---- List states ----
  if (!status) {
    return (
      <div className="text-muted-foreground px-3 py-4 text-xs">Loading…</div>
    );
  }

  if (!status.isRepo) {
    return (
      <div className="text-muted-foreground px-3 py-4 text-xs">
        Not a git repository
      </div>
    );
  }

  const stagedCount = grouped.staged.length;
  const dirtyCount = presentPaths.size;
  const canCommit = commitMessage.trim().length > 0 && stagedCount > 0;
  const canStageAllAndCommit =
    commitMessage.trim().length > 0 && dirtyCount > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rows.length === 0 ? (
          <div className="px-3 py-4 text-xs">
            <p className="text-muted-foreground">No changes</p>
            {status.branch && (
              <p className="text-muted-foreground/60 mt-1 font-mono">
                {status.branch}
              </p>
            )}
          </div>
        ) : (
          SECTION_ORDER.map(({ key, label }) => {
            const sectionRows = grouped[key];
            if (sectionRows.length === 0) return null;
            return (
              <div key={key}>
                <div className="group/section text-muted-foreground/60 flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium tracking-wider uppercase">
                  <span>{label}</span>
                  <span>({sectionRows.length})</span>
                  <span className="flex-1" />
                  {key === "staged" && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Unstage all"
                      title="Unstage all"
                      data-testid="git-unstage-all-action"
                      className="text-muted-foreground hover:text-foreground hidden shrink-0 rounded p-0.5 transition-colors group-hover/section:block"
                      onClick={() =>
                        handleUnstageAllInSection(
                          sectionRows.map((r) => r.path),
                        )
                      }
                      onKeyDown={(e) => {
                        if (isActivateKey(e)) {
                          e.preventDefault();
                          handleUnstageAllInSection(
                            sectionRows.map((r) => r.path),
                          );
                        }
                      }}
                    >
                      <Minus className="size-3" />
                    </span>
                  )}
                  {(key === "changes" || key === "untracked") && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Stage all"
                      title="Stage all"
                      data-testid={`git-stage-all-${key}-action`}
                      className="text-muted-foreground hover:text-foreground hidden shrink-0 rounded p-0.5 transition-colors group-hover/section:block"
                      onClick={() =>
                        handleStageAllInSection(sectionRows.map((r) => r.path))
                      }
                      onKeyDown={(e) => {
                        if (isActivateKey(e)) {
                          e.preventDefault();
                          handleStageAllInSection(
                            sectionRows.map((r) => r.path),
                          );
                        }
                      }}
                    >
                      <Plus className="size-3" />
                    </span>
                  )}
                </div>
                {sectionRows.map((row) => {
                  const diffKey = `${row.staged ? "staged" : "unstaged"}:${row.path}`;
                  const diff = fileDiffs.get(diffKey);
                  const isStaged = row.section === "staged";
                  return (
                    <div
                      key={`${row.section}-${row.path}`}
                      role="button"
                      tabIndex={0}
                      className="group hover:bg-accent/50 flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm"
                      onClick={() => selectRow(row)}
                      onKeyDown={(e) => {
                        if (isActivateKey(e)) {
                          e.preventDefault();
                          selectRow(row);
                        }
                      }}
                    >
                      <Checkbox
                        checked={row.staged}
                        aria-label={isStaged ? "Unstage file" : "Stage file"}
                        data-testid={
                          isStaged ? "git-unstage-action" : "git-stage-action"
                        }
                        className="shrink-0"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        onCheckedChange={(checked) =>
                          checked
                            ? handleStage(row.path)
                            : handleUnstage(row.path)
                        }
                      />
                      <span
                        className={cn(
                          "w-4 shrink-0 text-center font-mono text-xs font-bold",
                          row.statusColor,
                        )}
                      >
                        {row.statusChar}
                      </span>
                      <Tooltip delayDuration={500} disableHoverableContent>
                        <TooltipTrigger asChild>
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">
                            {row.path}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">{row.path}</TooltipContent>
                      </Tooltip>
                      {diff && (diff.additions > 0 || diff.deletions > 0) && (
                        <span className="shrink-0 font-mono text-[10px] tabular-nums">
                          {diff.additions > 0 && (
                            <span className="text-green-500">
                              +{diff.additions}
                            </span>
                          )}
                          {diff.additions > 0 && diff.deletions > 0 && " "}
                          {diff.deletions > 0 && (
                            <span className="text-red-500">
                              -{diff.deletions}
                            </span>
                          )}
                        </span>
                      )}
                      {(row.section === "changes" ||
                        row.section === "untracked") && (
                        <GitRevertAction
                          disabled={isMutating}
                          onActivate={() =>
                            requestRevert({
                              workspaceId,
                              path: row.path,
                              isUntracked: row.section === "untracked",
                            })
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t p-2">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Commit message"
          rows={2}
          data-testid="git-commit-message"
          className={cn(
            "bg-muted/50 w-full resize-none rounded-md border px-2.5 py-1.5 text-sm",
            "placeholder:text-muted-foreground",
            "focus:ring-ring focus:ring-2 focus:outline-none",
          )}
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1"
            data-testid="git-commit-button"
            disabled={!canCommit || commitMutation.isPending}
            onClick={handleCommit}
          >
            {commitMutation.isPending && (
              <Loader2 className="mr-1.5 size-3 animate-spin" />
            )}
            Commit
          </Button>
          <Button
            size="sm"
            variant="secondary"
            data-testid="git-stage-all-commit-button"
            disabled={
              !canStageAllAndCommit ||
              stageMutation.isPending ||
              commitMutation.isPending
            }
            onClick={handleStageAllAndCommit}
          >
            Stage all &amp; commit
          </Button>
          <GitSyncControls
            workspaceId={workspaceId}
            hasDirtyTree={dirtyCount > 0}
            tracking={status.tracking}
            ahead={status.ahead}
            behind={status.behind}
            onSuccess={invalidateFreshness}
          />
        </div>
      </div>
      <GitRevertDialog
        target={revertTarget}
        onOpenChange={(open) => !open && clearRevert()}
        onConfirm={confirmRevert}
      />
      {diffDialog}
    </div>
  );
}
