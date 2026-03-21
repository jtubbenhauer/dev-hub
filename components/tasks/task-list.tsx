"use client";

import { useState } from "react";
import {
  ExternalLink,
  GitFork,
  AlertTriangle,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskWorktreeDialog } from "@/components/dashboard/task-worktree-dialog";
import type { ClickUpTask, ClickUpCustomField } from "@/types";

/** Find a "score" custom field on a task — supports number and formula types */
function getScoreField(task: ClickUpTask): ClickUpCustomField | undefined {
  return task.custom_fields?.find(
    (f) =>
      (f.type === "number" || f.type === "formula") && /score/i.test(f.name),
  );
}

function getScoreValue(task: ClickUpTask): number | null {
  const field = getScoreField(task);
  if (!field || field.value == null) return null;
  const n = Number(field.value);
  return isNaN(n) ? null : n;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
};

function formatRelativeTime(unixMs: string): string {
  const diffMs = Date.now() - Number(unixMs);
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(Number(unixMs)).toLocaleDateString();
}

/**
 * Shared CSS grid template for both the header row and task rows.
 * Columns: priority-dot | task-name | [score] | list | status | updated | worktree-btn | link-btn
 */
function getGridTemplate(showScore: boolean): string {
  const cols = [
    "0.5rem",
    "1fr",
    ...(showScore ? ["2.5rem"] : []),
    "minmax(0, 6.5rem)",
    "auto",
    "4.5rem",
    "1.5rem",
    "1.5rem",
  ];
  return cols.join(" ");
}

interface TaskRowProps {
  task: ClickUpTask;
  isSelected: boolean;
  onSelect: (task: ClickUpTask) => void;
  showScore: boolean;
  gridTemplate: string;
}

function TaskRow({
  task,
  isSelected,
  onSelect,
  showScore,
  gridTemplate,
}: TaskRowProps) {
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const priorityColor = task.priority
    ? (PRIORITY_COLORS[task.priority.priority] ?? "bg-gray-400")
    : "bg-gray-300";
  const score = showScore ? getScoreValue(task) : null;

  return (
    <>
      <div
        className={`group grid cursor-pointer items-center gap-x-2.5 rounded-md px-2 py-2 transition-colors ${
          isSelected ? "bg-accent" : "hover:bg-muted/50"
        }`}
        style={{ gridTemplateColumns: gridTemplate }}
        onClick={() => onSelect(task)}
      >
        {/* Priority dot */}
        <span className={`size-2 rounded-full ${priorityColor}`} />

        {/* Task name */}
        <span className="min-w-0 truncate text-sm">{task.name}</span>

        {/* Score — conditional column */}
        {showScore && (
          <span
            className="text-foreground text-right font-mono text-xs font-semibold tabular-nums"
            title="Score"
          >
            {score ?? ""}
          </span>
        )}

        {/* List name — hidden below sm */}
        <span className="text-muted-foreground hidden truncate text-xs sm:block">
          {task.list.name}
        </span>

        {/* Status badge */}
        <Badge
          variant="secondary"
          className="w-fit px-1.5 py-0 text-xs font-normal"
          style={{ color: task.status.color }}
        >
          {task.status.status}
        </Badge>

        {/* Updated time — hidden below md */}
        <span className="text-muted-foreground hidden text-xs tabular-nums md:block">
          {formatRelativeTime(task.date_updated)}
        </span>

        {/* Worktree button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setWorktreeOpen(true);
          }}
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex size-6 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
          title="Create worktree from task"
        >
          <GitFork className="size-3" />
        </button>

        {/* External link */}
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
        >
          <ExternalLink className="size-3" />
        </a>
      </div>
      <TaskWorktreeDialog
        task={task}
        open={worktreeOpen}
        onOpenChange={setWorktreeOpen}
      />
    </>
  );
}

export function TaskListSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-2">
          <Skeleton className="size-2 shrink-0 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20 shrink-0" />
          <Skeleton className="h-4 w-14 shrink-0" />
        </div>
      ))}
    </div>
  );
}

interface TaskListProps {
  tasks: ClickUpTask[] | undefined;
  isLoading: boolean;
  error: Error | null;
  contextLabel?: string;
  selectedTaskId: string | null;
  onSelectTask: (task: ClickUpTask) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

export function TaskList({
  tasks,
  isLoading,
  error,
  contextLabel,
  selectedTaskId,
  onSelectTask,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: TaskListProps) {
  if (isLoading) {
    return (
      <div className="min-w-0 flex-1 overflow-auto p-2">
        {contextLabel && (
          <div className="text-muted-foreground px-2 pb-2 text-xs font-medium tracking-wide uppercase">
            {contextLabel}
          </div>
        )}
        <TaskListSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="text-destructive size-8" />
        <p className="text-muted-foreground text-sm">{error.message}</p>
      </div>
    );
  }

  if (!tasks || tasks.length === 0) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center p-8 text-center">
        <p className="text-muted-foreground text-sm">No tasks found.</p>
      </div>
    );
  }

  // Check if any task has a score custom field
  const hasScores = tasks.some((t) => getScoreValue(t) != null);

  // Sort by score (highest first) when scores are present
  const sortedTasks = hasScores
    ? [...tasks].sort(
        (a, b) =>
          (getScoreValue(b) ?? -Infinity) - (getScoreValue(a) ?? -Infinity),
      )
    : tasks;

  const gridTemplate = getGridTemplate(hasScores);

  return (
    <div className="min-w-0 flex-1 overflow-auto p-2">
      {contextLabel && (
        <div className="text-muted-foreground px-2 pb-2 text-xs font-medium tracking-wide uppercase">
          {contextLabel}
        </div>
      )}
      {hasScores && (
        <div
          className="text-muted-foreground/60 grid items-center gap-x-2.5 px-2 pb-1 text-[11px] font-medium tracking-wide uppercase"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {/* Priority dot spacer */}
          <span />
          {/* Task name */}
          <span>Task</span>
          {/* Score */}
          <span className="text-right">Score</span>
          {/* List — hidden below sm */}
          <span className="hidden sm:block">List</span>
          {/* Status */}
          <span>Status</span>
          {/* Updated — hidden below md */}
          <span className="hidden md:block">Updated</span>
          {/* Worktree button spacer */}
          <span />
          {/* Link spacer */}
          <span />
        </div>
      )}
      <div className="space-y-0.5">
        {sortedTasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            isSelected={task.id === selectedTaskId}
            onSelect={onSelectTask}
            showScore={hasScores}
            gridTemplate={gridTemplate}
          />
        ))}
      </div>
      {hasMore && (
        <div className="flex justify-center pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="text-muted-foreground"
          >
            {isLoadingMore ? (
              <Loader2 className="mr-2 size-3 animate-spin" />
            ) : (
              <ChevronDown className="mr-2 size-3" />
            )}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
