"use client"

import { useMemo } from "react"
import { Plus, Trash2, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { Session } from "@/lib/opencode/types"

interface SessionListProps {
  sessions: Record<string, Session>
  activeSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onCreateSession: () => void
  onDeleteSession: (sessionId: string) => void
}

export function SessionList({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
}: SessionListProps) {
  const sortedSessions = useMemo(() => {
    return Object.values(sessions)
      .filter((s) => !s.parentID)
      .sort((a, b) => b.time.updated - a.time.updated)
  }, [sessions])

  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-muted/30">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">Sessions</span>
        <Button size="icon-xs" variant="ghost" onClick={onCreateSession}>
          <Plus className="size-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {sortedSessions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <MessageSquare className="size-8 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">No sessions yet</p>
            <Button size="sm" variant="outline" onClick={onCreateSession}>
              <Plus className="size-3.5" />
              New Chat
            </Button>
          </div>
        ) : (
          <div className="p-1">
            {sortedSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onSelect={() => onSelectSession(session.id)}
                onDelete={() => onDeleteSession(session.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

interface SessionItemProps {
  session: Session
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
}

function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
}: SessionItemProps) {
  const formattedTime = useMemo(() => {
    return formatRelativeTime(session.time.updated)
  }, [session.time.updated])

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "group flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-left text-sm",
        "hover:bg-muted transition-colors",
        isActive && "bg-muted"
      )}
    >
      <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 overflow-hidden">
        <p className="truncate font-medium" title={session.title || "Untitled"}>
          {session.title || "Untitled"}
        </p>
        <p className="text-xs text-muted-foreground">{formattedTime}</p>
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
      >
        <Trash2 className="size-3 text-muted-foreground" />
      </Button>
    </div>
  )
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "just now"

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`

  return new Date(timestamp).toLocaleDateString()
}
