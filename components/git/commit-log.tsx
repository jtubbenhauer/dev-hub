"use client"

import { useState } from "react"
import {
  GitCommitHorizontal,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { DiffViewer } from "@/components/git/diff-viewer"
import { useGitCommitDiff } from "@/hooks/use-git"
import { cn } from "@/lib/utils"
import type { GitLogEntry } from "@/types"

interface CommitLogProps {
  entries: GitLogEntry[]
  workspaceId: string
  isLoading: boolean
}

export function CommitLog({ entries, workspaceId, isLoading }: CommitLogProps) {
  const [expandedHash, setExpandedHash] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading commit history...
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No commits yet
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-px p-2">
        {entries.map((entry) => (
          <CommitEntry
            key={entry.hash}
            entry={entry}
            workspaceId={workspaceId}
            isExpanded={expandedHash === entry.hash}
            onToggle={() =>
              setExpandedHash(expandedHash === entry.hash ? null : entry.hash)
            }
          />
        ))}
      </div>
    </ScrollArea>
  )
}

function CommitEntry({
  entry,
  workspaceId,
  isExpanded,
  onToggle,
}: {
  entry: GitLogEntry
  workspaceId: string
  isExpanded: boolean
  onToggle: () => void
}) {
  const { data: diff, isLoading: isDiffLoading } = useGitCommitDiff(
    isExpanded ? workspaceId : null,
    isExpanded ? entry.hash : null
  )

  const relativeDate = formatRelativeDate(entry.date)

  return (
    <div className="rounded-sm">
      <div
        className={cn(
          "flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent/50",
          isExpanded && "bg-accent/30"
        )}
        onClick={onToggle}
      >
        <span className="mt-0.5 shrink-0">
          {isExpanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </span>
        <GitCommitHorizontal className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-primary/70">{entry.abbrevHash}</span>
            <span className="truncate flex-1">{entry.message}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="size-2.5" />
              {entry.author}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-2.5" />
              {relativeDate}
            </span>
            {entry.refs && (
              <span className="text-primary/60 truncate">{entry.refs}</span>
            )}
          </div>
        </div>
      </div>
      {isExpanded && (
        <div className="ml-6 max-h-80 overflow-hidden border-l-2 border-border/50 pl-2">
          <DiffViewer diff={diff ?? ""} isLoading={isDiffLoading} />
        </div>
      )}
    </div>
  )
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}
