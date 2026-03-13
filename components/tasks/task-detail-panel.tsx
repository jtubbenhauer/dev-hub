"use client"

import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  X,
  ExternalLink,
  GitFork,
  Loader2,
  AlertTriangle,
  Clock,
  User,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { TaskWorktreeDialog } from "@/components/dashboard/task-worktree-dialog"
import { CreateProviderWorkspaceDialog } from "@/components/workspace/create-provider-workspace-dialog"
import { useClickUpTaskDetail, useClickUpTaskComments } from "@/hooks/use-clickup"
import { useWorkspaceProviders } from "@/hooks/use-settings"
import { cn } from "@/lib/utils"
import type { ClickUpTask, ClickUpCustomField } from "@/types"

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
}

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

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function CustomFieldValue({ field }: { field: ClickUpCustomField }) {
  if (field.value == null || field.value === "") return <span className="text-muted-foreground">—</span>

  switch (field.type) {
    case "number":
      return <span>{String(field.value)}</span>
    case "text":
    case "email":
    case "url":
    case "phone":
      return <span className="break-all">{String(field.value)}</span>
    case "date": {
      const ts = Number(field.value)
      return <span>{isNaN(ts) ? String(field.value) : new Date(ts).toLocaleDateString()}</span>
    }
    case "checkbox":
      return <span>{field.value ? "Yes" : "No"}</span>
    case "dropdown": {
      const config = field.type_config as { options?: Array<{ orderindex: number; name: string; color: string }> } | undefined
      const options = config?.options ?? []
      const selected = options.find((o) => o.orderindex === field.value)
      return selected ? (
        <Badge variant="secondary" className="text-xs" style={{ color: selected.color }}>
          {selected.name}
        </Badge>
      ) : (
        <span>{String(field.value)}</span>
      )
    }
    case "labels": {
      const labels = Array.isArray(field.value) ? field.value : []
      const config = field.type_config as { options?: Array<{ id: string; label: string; color: string }> } | undefined
      const options = config?.options ?? []
      return (
        <div className="flex flex-wrap gap-1">
          {(labels as string[]).map((labelId) => {
            const opt = options.find((o) => o.id === labelId)
            return (
              <Badge
                key={labelId}
                variant="secondary"
                className="text-xs"
                style={opt ? { backgroundColor: opt.color + "33", color: opt.color } : undefined}
              >
                {opt?.label ?? labelId}
              </Badge>
            )
          })}
        </div>
      )
    }
    default:
      return <span className="text-xs text-muted-foreground break-all">{JSON.stringify(field.value)}</span>
  }
}

interface TaskDetailPanelProps {
  task: ClickUpTask
  onClose: () => void
  style?: React.CSSProperties
  className?: string
}

export function TaskDetailPanel({ task, onClose, style, className }: TaskDetailPanelProps) {
  const [worktreeOpen, setWorktreeOpen] = useState(false)

  const { data: detail, isLoading: isLoadingDetail, error: detailError } = useClickUpTaskDetail(task.id)
  const { data: comments, isLoading: isLoadingComments } = useClickUpTaskComments(task.id)
  const { providers } = useWorkspaceProviders()

  const priorityColor = task.priority
    ? (PRIORITY_COLORS[task.priority.priority] ?? "bg-gray-400")
    : null

  const nonEmptyCustomFields = (detail?.custom_fields ?? []).filter(
    (f) => f.value != null && f.value !== "" && !(Array.isArray(f.value) && f.value.length === 0)
  )

  return (
    <>
      <div className={cn("flex flex-col h-full border-l shrink-0 bg-background", className)} style={style}>
        {/* Header */}
        <div className="flex items-start gap-2 p-3 border-b">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {priorityColor && (
                <span className={`size-2 rounded-full shrink-0 ${priorityColor}`} />
              )}
              <Badge
                variant="secondary"
                className="text-xs py-0 px-1.5 font-normal"
                style={{ color: task.status.color }}
              >
                {task.status.status}
              </Badge>
              {task.priority && (
                <span className="text-xs text-muted-foreground">
                  {PRIORITY_LABELS[task.priority.priority]}
                </span>
              )}
              {task.custom_id && (
                <span className="text-xs text-muted-foreground font-mono">{task.custom_id}</span>
              )}
            </div>
            <h2 className="text-sm font-semibold mt-1 leading-snug">{task.name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {task.list.name}
              {task.folder?.name && task.folder.name !== "hidden" && ` · ${task.folder.name}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-5">
            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setWorktreeOpen(true)}>
                <GitFork className="mr-2 size-3.5" />
                Create Worktree
              </Button>
              {providers.length > 0 && (
                <CreateProviderWorkspaceDialog workspaces={[]} />
              )}
              <a href={task.url} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="ghost" className="text-muted-foreground">
                  <ExternalLink className="mr-2 size-3.5" />
                  Open in ClickUp
                </Button>
              </a>
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {task.assignees.length > 0 && (
                <>
                  <span className="text-muted-foreground flex items-center gap-1">
                    <User className="size-3" /> Assignees
                  </span>
                  <span>{task.assignees.map((a) => a.username).join(", ")}</span>
                </>
              )}
              {task.due_date && (
                <>
                  <span className="text-muted-foreground">Due</span>
                  <span>{new Date(Number(task.due_date)).toLocaleDateString()}</span>
                </>
              )}
              {detail?.time_estimate != null && detail.time_estimate > 0 && (
                <>
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Clock className="size-3" /> Estimate
                  </span>
                  <span>{formatDuration(detail.time_estimate)}</span>
                </>
              )}
              {detail?.time_spent != null && detail.time_spent > 0 && (
                <>
                  <span className="text-muted-foreground">Time spent</span>
                  <span>{formatDuration(detail.time_spent)}</span>
                </>
              )}
              <span className="text-muted-foreground">Updated</span>
              <span>{formatRelativeTime(task.date_updated)}</span>
            </div>

            {/* Custom fields */}
            {isLoadingDetail ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : detailError ? (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle className="size-3.5" />
                Failed to load task details
              </div>
            ) : nonEmptyCustomFields.length > 0 ? (
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Custom Fields
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {nonEmptyCustomFields.map((field) => (
                    <>
                      <span key={`label-${field.id}`} className="text-muted-foreground truncate" title={field.name}>
                        {field.name}
                      </span>
                      <div key={`value-${field.id}`}>
                        <CustomFieldValue field={field} />
                      </div>
                    </>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Description */}
            {isLoadingDetail ? (
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            ) : detail?.markdown_description ? (
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Description
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {detail.markdown_description}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}

            {/* Comments */}
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Comments
              </div>
              {isLoadingComments ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Loading comments...
                </div>
              ) : !comments || comments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No comments yet.</p>
              ) : (
                <div className="space-y-3">
                  {comments.map((comment) => (
                    <div key={comment.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{comment.user.username}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(comment.date)}
                        </span>
                        {comment.resolved && (
                          <Badge variant="secondary" className="text-xs py-0 px-1">resolved</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                        {comment.comment_text}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>

      <TaskWorktreeDialog task={task} open={worktreeOpen} onOpenChange={setWorktreeOpen} />
    </>
  )
}
