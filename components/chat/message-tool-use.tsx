"use client"

import { useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Wrench,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { ToolPart } from "@/lib/opencode/types"

interface MessageToolUseProps {
  part: ToolPart
}

export function MessageToolUse({ part }: MessageToolUseProps) {
  const { state } = part
  // Auto-expand while running/pending, collapse once done — user toggle overrides
  const isActiveStatus = state.status === "running" || state.status === "pending"
  const [userToggled, setUserToggled] = useState(false)
  const [manualExpanded, setManualExpanded] = useState(false)
  const isExpanded = userToggled ? manualExpanded : isActiveStatus

  const statusIcon = getStatusIcon(state.status)
  const statusColor = getStatusColor(state.status)
  const title = getToolTitle(part)

  const handleToggle = () => {
    if (userToggled) {
      setManualExpanded((prev) => !prev)
    } else {
      // First manual toggle: take over from auto state, flipping it
      setUserToggled(true)
      setManualExpanded(!isActiveStatus)
    }
  }

  return (
    <div className="min-w-0 w-full overflow-hidden rounded-lg border bg-muted/30">
      <button
        onClick={handleToggle}
        className={cn(
          "flex w-full min-w-0 overflow-hidden items-center gap-2 px-3 py-2 text-left text-sm",
          "hover:bg-muted/50 transition-colors rounded-lg"
        )}
      >
        {isExpanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate font-medium">{title}</span>
        <span className={cn("shrink-0", statusColor)}>{statusIcon}</span>
      </button>

      {isExpanded && (
        <div className="border-t px-3 py-2 text-xs overflow-hidden">
          {state.input && Object.keys(state.input).length > 0 && (
            <div className="mb-2">
              <span className="font-medium text-muted-foreground">Input:</span>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs break-all max-w-full">
                {formatToolData(state.input)}
              </pre>
            </div>
          )}

          {state.status === "completed" && state.output && (
            <div>
              <span className="font-medium text-muted-foreground">
                Output:
              </span>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs max-w-full">
                {truncateOutput(state.output)}
              </pre>
            </div>
          )}

          {state.status === "error" && (
            <div className="text-destructive">
              <span className="font-medium">Error:</span> {state.error}
            </div>
          )}

          {(state.status === "completed" || state.status === "error") &&
            state.time && (
              <div className="mt-2 text-muted-foreground">
                Duration:{" "}
                {formatDuration(state.time.end - state.time.start)}
              </div>
            )}
        </div>
      )}
    </div>
  )
}

function getStatusIcon(status: string) {
  switch (status) {
    case "pending":
      return <Clock className="size-3.5" />
    case "running":
      return <Loader2 className="size-3.5 animate-spin" />
    case "completed":
      return <CheckCircle2 className="size-3.5" />
    case "error":
      return <XCircle className="size-3.5" />
    default:
      return null
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "pending":
      return "text-muted-foreground"
    case "running":
      return "text-blue-500"
    case "completed":
      return "text-green-500"
    case "error":
      return "text-destructive"
    default:
      return "text-muted-foreground"
  }
}

function getToolTitle(part: ToolPart): string {
  if (part.state.status === "completed" && part.state.title) {
    return part.state.title
  }
  if (part.state.status === "running" && part.state.title) {
    return part.state.title
  }
  return part.tool
}

function formatToolData(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

function truncateOutput(output: string, maxLength = 2000): string {
  if (output.length <= maxLength) return output
  return output.slice(0, maxLength) + "\n... (truncated)"
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}
