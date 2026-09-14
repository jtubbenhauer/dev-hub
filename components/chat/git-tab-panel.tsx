"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpFromLine,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { SidePanelDiffView } from "@/components/chat/side-panel-diff-view";
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
  useGitPush,
} from "@/hooks/use-git";
import { openFileInSidePanel } from "@/lib/side-panel-open-file";
import { cn } from "@/lib/utils";
import { useSidePanelStore } from "@/stores/side-panel-store";

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

export function GitTabPanel({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const { data: status } = useGitStatus(workspaceId);
  const fileDiffs = useGitFileDiffs(workspaceId);
  const gitTabSelection = useSidePanelStore((s) => s.gitTabSelection);
  const setGitTabSelection = useSidePanelStore((s) => s.setGitTabSelection);

  const stageMutation = useGitStage(workspaceId);
  const unstageMutation = useGitUnstage(workspaceId);
  const commitMutation = useGitCommit(workspaceId);
  const pushMutation = useGitPush(workspaceId);

  const [commitMessage, setCommitMessage] = useState("");

  const GIT_LIST_STORAGE_KEY = "dev-hub:git-tab-list-height";
  const GIT_LIST_MIN_HEIGHT = 80;
  const GIT_LIST_MAX_HEIGHT = 600;
  const GIT_LIST_DEFAULT_HEIGHT = 200;

  const [listHeight, setListHeight] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(GIT_LIST_STORAGE_KEY);
      if (stored === null) return GIT_LIST_DEFAULT_HEIGHT;
      const parsed = parseInt(stored, 10);
      if (isNaN(parsed)) return GIT_LIST_DEFAULT_HEIGHT;
      return Math.max(
        GIT_LIST_MIN_HEIGHT,
        Math.min(GIT_LIST_MAX_HEIGHT, parsed),
      );
    } catch {
      return GIT_LIST_DEFAULT_HEIGHT;
    }
  });

  const listHeightRef = useRef(listHeight);
  useEffect(() => {
    listHeightRef.current = listHeight;
  });

  const listDragRef = useRef({
    isDragging: false,
    startY: 0,
    startHeight: 0,
  });

  const handleListDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const drag = listDragRef.current;
    drag.isDragging = true;
    drag.startY = e.clientY;
    drag.startHeight = listHeightRef.current;

    const handleMove = (me: MouseEvent) => {
      if (!drag.isDragging) return;
      const delta = me.clientY - drag.startY;
      const next = Math.max(
        GIT_LIST_MIN_HEIGHT,
        Math.min(GIT_LIST_MAX_HEIGHT, drag.startHeight + delta),
      );
      listHeightRef.current = next;
      setListHeight(next);
    };

    const handleUp = () => {
      if (!drag.isDragging) return;
      drag.isDragging = false;
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(
          GIT_LIST_STORAGE_KEY,
          String(listHeightRef.current),
        );
      } catch {}
    };

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, []);

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

  // Unique dirty paths across every bucket (matches the side-panel badge).
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
  // file-content must be refreshed too so the diff screen never shows stale
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
  const pushMutate = pushMutation.mutate;

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

  const handlePush = useCallback(() => {
    pushMutate({ action: "push" });
  }, [pushMutate]);

  const selectRow = useCallback(
    (row: GitRow) => {
      setGitTabSelection({
        workspaceId,
        path: row.path,
        staged: row.section === "staged",
      });
    },
    [workspaceId, setGitTabSelection],
  );

  const selectionWorkspaceId = gitTabSelection?.workspaceId;
  const selectionPath = gitTabSelection?.path;

  // Clear stale cross-workspace selections, and auto-return to the list once
  // the selected path leaves every status bucket (e.g. after a commit).
  useEffect(() => {
    if (!gitTabSelection) return;
    if (selectionWorkspaceId !== workspaceId) {
      setGitTabSelection(null);
      return;
    }
    if (status && selectionPath && !presentPaths.has(selectionPath)) {
      setGitTabSelection(null);
    }
  }, [
    gitTabSelection,
    selectionWorkspaceId,
    selectionPath,
    workspaceId,
    status,
    presentPaths,
    setGitTabSelection,
  ]);

  const handleOpenInFiles = useCallback(async () => {
    if (!selectionPath) return;
    let failed = false;
    await openFileInSidePanel(workspaceId, selectionPath, () => {
      failed = true;
      toast.error("Could not open file");
    });
    // openFileInSidePanel resolves even on failure — the fallback is the ONLY
    // failure signal. Keep the diff screen open when the open failed so the
    // user does not silently lose context.
    if (!failed) setGitTabSelection(null);
  }, [workspaceId, selectionPath, setGitTabSelection]);

  const hasValidSelection =
    !!gitTabSelection && gitTabSelection.workspaceId === workspaceId;

  const selection = hasValidSelection ? gitTabSelection : null;

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
    <div className="flex h-[calc(100%-2.5rem)] flex-col">
      <div
        className={
          selection
            ? "shrink-0 overflow-y-auto p-1"
            : "min-h-0 flex-1 overflow-y-auto p-1"
        }
        style={selection ? { height: listHeight } : undefined}
      >
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
                  const isSelected =
                    !!selection &&
                    selection.path === row.path &&
                    selection.staged === isStaged;
                  return (
                    <div
                      key={`${row.section}-${row.path}`}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group hover:bg-accent/50 flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm",
                        isSelected && "bg-accent",
                      )}
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
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {selection && (
        <div
          className="hover:bg-accent/50 active:bg-accent flex h-1.5 shrink-0 cursor-row-resize items-center justify-center border-y transition-colors"
          data-testid="git-list-resize-handle"
          onMouseDown={handleListDragStart}
        />
      )}
      {selection && (
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-testid="git-tab-diff-screen"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setGitTabSelection(null);
            }
          }}
        >
          <div className="flex h-8 items-center gap-1 border-b px-1">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Close diff"
              data-testid="git-diff-close"
              onClick={() => setGitTabSelection(null)}
            >
              <X className="size-3.5" />
            </Button>
            <Tooltip delayDuration={500} disableHoverableContent>
              <TooltipTrigger asChild>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {selection.path}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left">{selection.path}</TooltipContent>
            </Tooltip>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Open in Files tab"
              data-testid="git-diff-open-in-files"
              onClick={handleOpenInFiles}
            >
              <ExternalLink className="size-3.5" />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <SidePanelDiffView
              workspaceId={workspaceId}
              filePath={selection.path}
              staged={selection.staged}
            />
          </div>
        </div>
      )}

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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Push"
                data-testid="git-push-button"
                disabled={pushMutation.isPending}
                onClick={handlePush}
              >
                {pushMutation.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <ArrowUpFromLine className="size-3" />
                )}
                {status.ahead > 0 && (
                  <span
                    className="ml-0.5 text-[10px] tabular-nums"
                    data-testid="git-ahead-count"
                  >
                    {status.ahead}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Push{status.ahead > 0 ? ` (${status.ahead})` : ""}
            </TooltipContent>
          </Tooltip>
        </div>
        {pushMutation.isError && (
          <p className="text-destructive text-xs" data-testid="git-push-error">
            {pushMutation.error instanceof Error
              ? pushMutation.error.message
              : "Push failed"}
          </p>
        )}
      </div>
    </div>
  );
}
