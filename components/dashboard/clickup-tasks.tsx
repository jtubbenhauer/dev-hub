"use client"

import { useState } from "react"
import Link from "next/link"
import { ExternalLink, CheckSquare, AlertTriangle, RefreshCw, GitFork } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useMyClickUpTasks } from "@/hooks/use-clickup"
import { useClickUpSettings } from "@/hooks/use-settings"
import { TaskWorktreeDialog } from "@/components/dashboard/task-worktree-dialog"
import type { ClickUpTask } from "@/types"

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  normal: "bg-blue-500",
  low: "bg-gray-400",
}

function formatRelativeTime(unixMs: string): string {
  const diffMs = Date.now() - Number(unixMs)
  const diffMinutes = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  return new Date(Number(unixMs)).toLocaleDateString()
}

function TaskRow({ task }: { task: ClickUpTask }) {
  const [worktreeOpen, setWorktreeOpen] = useState(false)
  const priorityColor = task.priority
    ? (PRIORITY_COLORS[task.priority.priority] ?? "bg-gray-400")
    : "bg-gray-300"

  return (
    <>
      <div className="flex items-center gap-2.5 py-1.5 px-0.5 rounded hover:bg-muted/50 transition-colors group">
        <span className={`size-2 rounded-full shrink-0 ${priorityColor}`} />
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-sm truncate min-w-0 hover:underline"
        >
          {task.name}
        </a>
        <Badge
          variant="secondary"
          className="text-xs py-0 px-1.5 shrink-0 font-normal"
          style={{ color: task.status.color }}
        >
          {task.status.status}
        </Badge>
        <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
          {formatRelativeTime(task.date_updated)}
        </span>
        <button
          onClick={() => setWorktreeOpen(true)}
          className="size-5 flex items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity hover:text-foreground hover:bg-muted"
          title="Create worktree from task"
        >
          <GitFork className="size-3" />
        </button>
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          className="size-5 flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity"
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
  )
}

function TaskListSkeleton() {
  return (
    <div className="space-y-1.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 py-1.5">
          <Skeleton className="size-2 rounded-full shrink-0" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16 shrink-0" />
          <Skeleton className="h-4 w-10 shrink-0" />
        </div>
      ))}
    </div>
  )
}

export function ClickUpTasks() {
  const { isConfigured, isLoading: isLoadingSettings } = useClickUpSettings()
  const { data: tasks, isLoading, error, refetch, isFetching } = useMyClickUpTasks({
    enabled: isConfigured,
  })

  if (isLoadingSettings) {
    return (
      <Card>
        <CardContent className="py-6">
          <TaskListSkeleton />
        </CardContent>
      </Card>
    )
  }

  if (!isConfigured) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckSquare className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">ClickUp is not connected yet.</p>
          <Link href="/settings" className="text-sm text-primary hover:underline">
            Configure in Settings
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            My Tasks
            {tasks && tasks.length > 0 && (
              <Badge variant="secondary" className="text-xs py-0 px-1.5">
                {tasks.length}
              </Badge>
            )}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`size-3 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        {isLoading ? (
          <TaskListSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <AlertTriangle className="size-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : !tasks || tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No tasks found.</p>
        ) : (
          <div className="space-y-0">
            {tasks.slice(0, 10).map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
