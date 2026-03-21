"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  CheckSquare,
  AlertTriangle,
  RefreshCw,
  GitFork,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyClickUpTasks } from "@/hooks/use-clickup";
import { useClickUpSettings } from "@/hooks/use-settings";
import { TaskWorktreeDialog } from "@/components/dashboard/task-worktree-dialog";
import type { ClickUpTask } from "@/types";

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

function TaskRow({ task }: { task: ClickUpTask }) {
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const priorityColor = task.priority
    ? (PRIORITY_COLORS[task.priority.priority] ?? "bg-gray-400")
    : "bg-gray-300";

  return (
    <>
      <div className="hover:bg-muted/50 group flex items-center gap-2.5 rounded px-0.5 py-1.5 transition-colors">
        <span className={`size-2 shrink-0 rounded-full ${priorityColor}`} />
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-sm hover:underline"
        >
          {task.name}
        </a>
        <Badge
          variant="secondary"
          className="shrink-0 px-1.5 py-0 text-xs font-normal"
          style={{ color: task.status.color }}
        >
          {task.status.status}
        </Badge>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {formatRelativeTime(task.date_updated)}
        </span>
        <button
          onClick={() => setWorktreeOpen(true)}
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex size-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100"
          title="Create worktree from task"
        >
          <GitFork className="size-3" />
        </button>
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground flex size-5 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
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

function TaskListSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 py-1.5">
          <Skeleton className="size-2 shrink-0 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16 shrink-0" />
          <Skeleton className="h-4 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function ClickUpTasks() {
  const { isConfigured, isLoading: isLoadingSettings } = useClickUpSettings();
  const {
    data: tasks,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useMyClickUpTasks({
    enabled: isConfigured,
  });

  if (isLoadingSettings) {
    return (
      <Card>
        <CardContent className="py-6">
          <TaskListSkeleton />
        </CardContent>
      </Card>
    );
  }

  if (!isConfigured) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckSquare className="text-muted-foreground size-10" />
          <p className="text-muted-foreground text-sm">
            ClickUp is not connected yet.
          </p>
          <Link
            href="/settings"
            className="text-primary text-sm hover:underline"
          >
            Configure in Settings
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            My Tasks
            {tasks && tasks.length > 0 && (
              <Badge variant="secondary" className="px-1.5 py-0 text-xs">
                {tasks.length}
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-6"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw
              className={`size-3 ${isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        {isLoading ? (
          <TaskListSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <AlertTriangle className="text-destructive size-6" />
            <p className="text-muted-foreground text-sm">{error.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : !tasks || tasks.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No tasks found.
          </p>
        ) : (
          <div className="space-y-0">
            {tasks.slice(0, 10).map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
