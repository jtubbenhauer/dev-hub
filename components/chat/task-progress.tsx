"use client"

import { memo } from "react"
import {
  Circle,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Todo } from "@/lib/opencode/types"

interface TaskProgressPanelProps {
  todos: Todo[]
}

const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
const statusOrder: Record<string, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
  cancelled: 3,
}

function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    const statusDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
    if (statusDiff !== 0) return statusDiff
    return (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99)
  })
}

export const TaskProgressPanel = memo(function TaskProgressPanel({
  todos,
}: TaskProgressPanelProps) {
  const completed = todos.filter((t) => t.status === "completed").length
  const inProgress = todos.filter((t) => t.status === "in_progress").length
  const total = todos.length
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0
  const sortedTodos = sortTodos(todos)

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {completed}/{total} completed
            {inProgress > 0 && <span className="text-sky-500"> · {inProgress} running</span>}
          </span>
          <span className="tabular-nums">{progressPercent}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-sky-500/20 overflow-hidden">
          <div
            className="h-full rounded-full bg-sky-500 transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="space-y-0.5">
        {sortedTodos.map((todo) => (
          <TodoItem key={`${todo.status}-${todo.content}`} todo={todo} />
        ))}
      </div>
    </div>
  )
})

const TodoItem = memo(function TodoItem({ todo }: { todo: Todo }) {
  const icon = getStatusIcon(todo.status)
  const statusColor = getStatusColor(todo.status)
  const isCompleted = todo.status === "completed"
  const isCancelled = todo.status === "cancelled"
  const dimmed = isCompleted || isCancelled

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded px-1.5 py-1 text-xs transition-opacity",
        dimmed && "opacity-50"
      )}
    >
      <span className={cn("mt-0.5 shrink-0", statusColor)}>{icon}</span>
      <span
        className={cn(
          "flex-1 leading-relaxed",
          isCompleted && "line-through",
          isCancelled && "line-through"
        )}
      >
        {todo.content}
      </span>
      {todo.priority === "high" && !dimmed && (
        <span className="shrink-0 rounded bg-red-500/10 px-1 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
          high
        </span>
      )}
    </div>
  )
})

function getStatusIcon(status: string) {
  switch (status) {
    case "pending":
      return <Circle className="size-3" />
    case "in_progress":
      return <Loader2 className="size-3 animate-spin" />
    case "completed":
      return <CheckCircle2 className="size-3" />
    case "cancelled":
      return <XCircle className="size-3" />
    default:
      return <Circle className="size-3" />
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "pending":
      return "text-muted-foreground"
    case "in_progress":
      return "text-sky-500"
    case "completed":
      return "text-green-500"
    case "cancelled":
      return "text-muted-foreground"
    default:
      return "text-muted-foreground"
  }
}
