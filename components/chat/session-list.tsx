"use client"

import { useMemo } from "react"
import { Plus, Trash2, MessageSquare, Globe, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Session, SessionStatus } from "@/lib/opencode/types"
import type { SessionWithWorkspace } from "@/stores/chat-store"

interface BaseSessionListProps {
  activeSessionId: string | null
  sessionStatuses: Record<string, SessionStatus>
  onCreateSession: () => void
  onDeleteSession: (sessionId: string) => void
  isUnifiedMode?: boolean
  onToggleMode?: () => void
}

interface WorkspaceSessionListProps extends BaseSessionListProps {
  mode: "workspace"
  sessions: Record<string, Session>
  onSelectSession: (sessionId: string) => void
}

interface UnifiedSessionListProps extends BaseSessionListProps {
  mode: "unified"
  sessions: SessionWithWorkspace[]
  workspaceNames: Record<string, string>
  onSelectSession: (sessionId: string, workspaceId: string) => void
}

type SessionListProps = WorkspaceSessionListProps | UnifiedSessionListProps

export function SessionList(props: SessionListProps) {
  const { activeSessionId, sessionStatuses, onCreateSession, onDeleteSession } = props

  const sortedSessions = useMemo(() => {
    if (props.mode === "workspace") {
      return Object.values(props.sessions)
        .filter((s) => !s.parentID)
        .sort((a, b) => b.time.updated - a.time.updated)
    }
    return props.sessions
  }, [props.mode, props.sessions])

  const handleSelect = (session: Session | SessionWithWorkspace) => {
    if (props.mode === "unified") {
      props.onSelectSession(session.id, (session as SessionWithWorkspace).workspaceId)
    } else {
      props.onSelectSession(session.id)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-muted/30">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">
          {props.mode === "unified" ? "All sessions" : "Sessions"}
        </span>
        <div className="flex items-center gap-1">
          {props.onToggleMode && (
            <Button
              size="icon-xs"
              variant={props.isUnifiedMode ? "secondary" : "ghost"}
              onClick={props.onToggleMode}
              title={props.isUnifiedMode ? "Show current workspace" : "Show all workspaces"}
            >
              {props.isUnifiedMode ? (
                <Layers className="size-3.5" />
              ) : (
                <Globe className="size-3.5" />
              )}
            </Button>
          )}
          <Button size="icon-xs" variant="ghost" onClick={onCreateSession}>
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1">
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
                status={sessionStatuses[session.id] ?? null}
                workspaceName={
                  props.mode === "unified"
                    ? props.workspaceNames[(session as SessionWithWorkspace).workspaceId]
                    : undefined
                }
                onSelect={() => handleSelect(session)}
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
  status: SessionStatus | null
  workspaceName?: string
  onSelect: () => void
  onDelete: () => void
}

function SessionItem({
  session,
  isActive,
  status,
  workspaceName,
  onSelect,
  onDelete,
}: SessionItemProps) {
  const formattedTime = useMemo(() => {
    return formatRelativeTime(session.time.updated)
  }, [session.time.updated])

  const isRunning = status !== null && status.type !== "idle"

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
        "group flex min-w-0 w-full cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-left text-sm",
        "hover:bg-muted transition-colors",
        isActive && "bg-muted"
      )}
    >
      <div className="relative mt-0.5 shrink-0">
        <MessageSquare className="size-3.5 text-muted-foreground" />
        {isRunning && (
          <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-emerald-500 animate-pulse" />
        )}
      </div>
      <div className="min-w-0 w-0 flex-1 overflow-hidden">
        <p className="truncate font-medium" title={session.title || "Untitled"}>
          {session.title || "Untitled"}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs text-muted-foreground">{formattedTime}</p>
          {workspaceName && (
            <Badge variant="outline" className="text-xs px-1 py-0 font-normal">
              {workspaceName}
            </Badge>
          )}
        </div>
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
