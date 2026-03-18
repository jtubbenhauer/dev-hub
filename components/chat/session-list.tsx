"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { Plus, Trash2, MessageSquare, Globe, Layers, FolderGit2, Check, GitBranch, Brain, ArrowUpDown, Group, GripVertical, ChevronDown, ChevronRight, Pin, PinOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { Session, SessionStatus } from "@/lib/opencode/types"
import type { SessionWithWorkspace } from "@/stores/chat-store"

interface BaseSessionListProps {
  activeSessionId: string | null
  sessionStatuses: Record<string, SessionStatus>
  lastViewedAt: Record<string, number>
  pinnedSessionIds?: Set<string>
  isLoading?: boolean
  onCreateSession: () => void
  onDeleteSession: (sessionId: string, workspaceId?: string) => void
  onPinSession?: (sessionId: string, workspaceId?: string) => void
  onUnpinSession?: (sessionId: string, workspaceId?: string) => void
  isUnifiedMode?: boolean
  onToggleMode?: () => void
}

interface WorkspaceSessionListProps extends BaseSessionListProps {
  mode: "workspace"
  sessions: Record<string, Session>
  workspaceColor?: string
  onSelectSession: (sessionId: string) => void
}

interface UnifiedSessionListProps extends BaseSessionListProps {
  mode: "unified"
  sessions: SessionWithWorkspace[]
  workspaceNames: Record<string, string>
  workspaceBranches: Record<string, string>
  workspaceColors?: Record<string, string>
  hasMore?: boolean
  onLoadMore?: () => void
  onSelectSession: (sessionId: string, workspaceId: string) => void
  workspaces?: { id: string; name: string; backend: string }[]
  activeWorkspaceId?: string | null
  onCreateSessionInWorkspace?: (workspaceId: string) => void
  groupByWorkspace?: boolean
  onToggleGroupByWorkspace?: () => void
  workspaceOrder?: string[]
  onWorkspaceOrderChange?: (order: string[]) => void
  expandedWorkspaces?: Record<string, boolean>
  onToggleWorkspaceExpanded?: (workspaceId: string) => void
}

type SessionListProps = WorkspaceSessionListProps | UnifiedSessionListProps

export function SessionList(props: SessionListProps) {
  const { activeSessionId, sessionStatuses, lastViewedAt, pinnedSessionIds, onCreateSession, onDeleteSession, onPinSession, onUnpinSession } = props

  const sortedSessions = useMemo(() => {
    if (props.mode === "workspace") {
      return Object.values(props.sessions)
        .filter((s) => !s.parentID)
        .sort((a, b) => {
          const aPinned = pinnedSessionIds?.has(a.id) ?? false
          const bPinned = pinnedSessionIds?.has(b.id) ?? false
          if (aPinned !== bPinned) return aPinned ? -1 : 1
          return b.time.updated - a.time.updated
        })
    }
    if (pinnedSessionIds && pinnedSessionIds.size > 0) {
      return [...props.sessions].sort((a, b) => {
        const aPinned = pinnedSessionIds.has(a.id)
        const bPinned = pinnedSessionIds.has(b.id)
        if (aPinned !== bPinned) return aPinned ? -1 : 1
        return b.time.updated - a.time.updated
      })
    }
    return props.sessions
  }, [props.mode, props.sessions, pinnedSessionIds])

  const isGrouped = props.mode === "unified" && !!props.groupByWorkspace
  const workspaceOrder = props.mode === "unified" ? props.workspaceOrder : undefined

  const allWorkspaceIds = props.mode === "unified" ? props.workspaces?.map((ws) => ws.id) : undefined

  const groupedSessions = useMemo(() => {
    if (!isGrouped) return null
    const groups = new Map<string, SessionWithWorkspace[]>()
    if (allWorkspaceIds) {
      for (const id of allWorkspaceIds) {
        groups.set(id, [])
      }
    }
    for (const session of sortedSessions as SessionWithWorkspace[]) {
      const existing = groups.get(session.workspaceId)
      if (existing) {
        existing.push(session)
      } else {
        groups.set(session.workspaceId, [session])
      }
    }
    const entries = [...groups.entries()]
    if (workspaceOrder && workspaceOrder.length > 0) {
      const orderIndex = new Map(workspaceOrder.map((id, i) => [id, i]))
      entries.sort((a, b) => {
        const ai = orderIndex.get(a[0]) ?? Infinity
        const bi = orderIndex.get(b[0]) ?? Infinity
        if (ai !== Infinity || bi !== Infinity) return ai - bi
        const aTime = a[1][0]?.time.updated ?? 0
        const bTime = b[1][0]?.time.updated ?? 0
        return bTime - aTime
      })
    } else {
      entries.sort(([, a], [, b]) => {
        const aTime = a[0]?.time.updated ?? 0
        const bTime = b[0]?.time.updated ?? 0
        return bTime - aTime
      })
    }
    return entries
  }, [isGrouped, sortedSessions, workspaceOrder, allWorkspaceIds])

  const [draggedWorkspaceId, setDraggedWorkspaceId] = useState<string | null>(null)
  const [dragOverWorkspaceId, setDragOverWorkspaceId] = useState<string | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDragOverWorkspaceId(targetId)
  }, [])

  const handleDragEnd = useCallback(() => {
    if (
      draggedWorkspaceId &&
      dragOverWorkspaceId &&
      draggedWorkspaceId !== dragOverWorkspaceId &&
      groupedSessions &&
      props.mode === "unified" &&
      props.onWorkspaceOrderChange
    ) {
      const currentOrder = groupedSessions.map(([id]) => id)
      const fromIndex = currentOrder.indexOf(draggedWorkspaceId)
      const toIndex = currentOrder.indexOf(dragOverWorkspaceId)
      if (fromIndex >= 0 && toIndex >= 0) {
        const next = [...currentOrder]
        next.splice(fromIndex, 1)
        next.splice(toIndex, 0, draggedWorkspaceId)
        props.onWorkspaceOrderChange(next)
      }
    }
    setDraggedWorkspaceId(null)
    setDragOverWorkspaceId(null)
  }, [draggedWorkspaceId, dragOverWorkspaceId, groupedSessions, props])

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
          {props.mode === "unified" && props.onToggleGroupByWorkspace && (
            <Button
              size="icon-xs"
              variant={props.groupByWorkspace ? "secondary" : "ghost"}
              onClick={props.onToggleGroupByWorkspace}
              title={props.groupByWorkspace ? "Sort by recent" : "Group by workspace"}
            >
              {props.groupByWorkspace ? (
                <Group className="size-3.5" />
              ) : (
                <ArrowUpDown className="size-3.5" />
              )}
            </Button>
          )}
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
          {props.mode === "unified" && props.workspaces && props.workspaces.length > 0 && props.onCreateSessionInWorkspace ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-xs" variant="ghost">
                  <Plus className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                {props.workspaces.map((ws) => (
                  <DropdownMenuItem
                    key={ws.id}
                    onClick={() => props.onCreateSessionInWorkspace!(ws.id)}
                    className="gap-2"
                  >
                    {ws.backend === "remote" ? (
                      <Globe className="size-3.5 text-blue-500" />
                    ) : (
                      <FolderGit2 className="size-3.5" />
                    )}
                    <span className="truncate flex-1">{ws.name}</span>
                    {ws.id === props.activeWorkspaceId && (
                      <Check className="size-3.5 text-muted-foreground" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="icon-xs" variant="ghost" onClick={onCreateSession}>
              <Plus className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1 [&>[data-slot=scroll-area-viewport]]:!overflow-x-hidden [&>[data-slot=scroll-area-viewport]>div]:!block">
        {props.isLoading ? (
          <SessionListSkeleton />
        ) : sortedSessions.length === 0 && (!groupedSessions || groupedSessions.length === 0) ? (
          <div className="flex flex-col items-center gap-2 p-4 text-center">
            <MessageSquare className="size-8 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">No sessions yet</p>
            <Button size="sm" variant="outline" onClick={onCreateSession}>
              <Plus className="size-3.5" />
              New Chat
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden p-1">
            {groupedSessions ? (
              groupedSessions.map(([workspaceId, wsSessions]) => (
                <WorkspaceGroup
                  key={workspaceId}
                  workspaceId={workspaceId}
                  workspaceName={
                    props.mode === "unified"
                      ? props.workspaceNames[workspaceId] ?? workspaceId
                      : workspaceId
                  }
                  workspaceColor={
                    props.mode === "unified"
                      ? props.workspaceColors?.[workspaceId]
                      : undefined
                  }
                  sessions={wsSessions}
                  activeSessionId={activeSessionId}
                  sessionStatuses={sessionStatuses}
                  lastViewedAt={lastViewedAt}
                  isExpanded={
                    props.mode === "unified"
                      ? props.expandedWorkspaces?.[workspaceId] ?? false
                      : false
                  }
                  onToggleExpanded={
                    props.mode === "unified"
                      ? () => props.onToggleWorkspaceExpanded?.(workspaceId)
                      : undefined
                  }
                  pinnedSessionIds={pinnedSessionIds}
                  onSelectSession={(session: Session | SessionWithWorkspace) => handleSelect(session)}
                  onDeleteSession={onDeleteSession}
                  onPinSession={onPinSession}
                  onUnpinSession={onUnpinSession}
                  onCreateSession={
                    props.mode === "unified" && props.onCreateSessionInWorkspace
                      ? () => props.onCreateSessionInWorkspace!(workspaceId)
                      : undefined
                  }
                  onDragStart={() => setDraggedWorkspaceId(workspaceId)}
                  onDragOver={(e: React.DragEvent) => handleDragOver(e, workspaceId)}
                  onDragEnd={handleDragEnd}
                  isDragTarget={dragOverWorkspaceId === workspaceId && draggedWorkspaceId !== workspaceId}
                />
              ))
            ) : (
              sortedSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  isPinned={pinnedSessionIds?.has(session.id) ?? false}
                  status={sessionStatuses[session.id] ?? null}
                  isUnread={!!(
                    session.id !== activeSessionId &&
                    lastViewedAt[session.id] != null &&
                    session.time.updated > lastViewedAt[session.id]
                  )}
                  workspaceBranch={
                    props.mode === "unified"
                      ? props.workspaceBranches[(session as SessionWithWorkspace).workspaceId] ??
                        props.workspaceNames[(session as SessionWithWorkspace).workspaceId]
                      : undefined
                  }
                  workspaceColor={
                    props.mode === "unified"
                      ? props.workspaceColors?.[(session as SessionWithWorkspace).workspaceId]
                      : props.mode === "workspace"
                        ? props.workspaceColor
                        : undefined
                  }
                  onSelect={() => handleSelect(session)}
                  onDelete={() => onDeleteSession(
                    session.id,
                    props.mode === "unified" ? (session as SessionWithWorkspace).workspaceId : undefined
                  )}
                  onTogglePin={onPinSession && onUnpinSession ? () => {
                    const wsId = props.mode === "unified" ? (session as SessionWithWorkspace).workspaceId : undefined
                    if (pinnedSessionIds?.has(session.id)) {
                      onUnpinSession(session.id, wsId)
                    } else {
                      onPinSession(session.id, wsId)
                    }
                  } : undefined}
                />
              ))
            )}
            {props.mode === "unified" && !isGrouped && props.hasMore && props.onLoadMore && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={props.onLoadMore}
              >
                Load more
              </Button>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

const COLLAPSED_SESSION_LIMIT = 3

interface WorkspaceGroupProps {
  workspaceId: string
  workspaceName: string
  workspaceColor?: string
  sessions: SessionWithWorkspace[]
  activeSessionId: string | null
  sessionStatuses: Record<string, SessionStatus>
  lastViewedAt: Record<string, number>
  pinnedSessionIds?: Set<string>
  isExpanded: boolean
  onToggleExpanded?: () => void
  onSelectSession: (session: SessionWithWorkspace) => void
  onDeleteSession: (sessionId: string, workspaceId?: string) => void
  onPinSession?: (sessionId: string, workspaceId?: string) => void
  onUnpinSession?: (sessionId: string, workspaceId?: string) => void
  onCreateSession?: () => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragEnd: () => void
  isDragTarget: boolean
}

function WorkspaceGroup({
  workspaceId,
  workspaceName,
  workspaceColor,
  sessions,
  activeSessionId,
  sessionStatuses,
  lastViewedAt,
  pinnedSessionIds,
  isExpanded,
  onToggleExpanded,
  onSelectSession,
  onDeleteSession,
  onPinSession,
  onUnpinSession,
  onCreateSession,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragTarget,
}: WorkspaceGroupProps) {
  const visibleSessions = isExpanded ? sessions : sessions.slice(0, COLLAPSED_SESSION_LIMIT)
  const hiddenCount = sessions.length - COLLAPSED_SESSION_LIMIT
  const canExpand = sessions.length > COLLAPSED_SESSION_LIMIT

  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden transition-colors",
        isDragTarget && "bg-accent/50 rounded-md"
      )}
      onDragOver={onDragOver}
      onDrop={(e) => { e.preventDefault(); onDragEnd() }}
    >
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move"
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        className="group/header flex min-w-0 cursor-grab items-center gap-1 px-1 pb-0.5 pt-2 first:pt-1 active:cursor-grabbing"
      >
        <GripVertical className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover/header:text-muted-foreground/50" />
        {canExpand && onToggleExpanded ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpanded()
            }}
            className="flex min-w-0 flex-1 items-center gap-1 cursor-pointer"
          >
            <ChevronRight
              className={cn("size-2.5 shrink-0 text-muted-foreground/60 transition-transform", isExpanded && "rotate-90")}
            />
            <FolderGit2
              className="size-3 shrink-0"
              style={workspaceColor ? { color: workspaceColor } : undefined}
            />
            <span className="min-w-0 flex-1 truncate text-left text-xs font-medium text-muted-foreground">
              {workspaceName}
            </span>
          </button>
        ) : (
          <>
            <FolderGit2
              className="size-3 shrink-0"
              style={workspaceColor ? { color: workspaceColor } : undefined}
            />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
              {workspaceName}
            </span>
          </>
        )}
        {onCreateSession && (
          <Button
            size="icon-xs"
            variant="ghost"
            className="size-4 shrink-0 opacity-0 transition-opacity group-hover/header:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onCreateSession()
            }}
            title={`New chat in ${workspaceName}`}
          >
            <Plus className="size-3" />
          </Button>
        )}
        <span className="shrink-0 pr-1 text-[10px] tabular-nums text-muted-foreground/60">
          {sessions.length}
        </span>
      </div>

      {visibleSessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          isPinned={pinnedSessionIds?.has(session.id) ?? false}
          status={sessionStatuses[session.id] ?? null}
          isUnread={!!(
            session.id !== activeSessionId &&
            lastViewedAt[session.id] != null &&
            session.time.updated > lastViewedAt[session.id]
          )}
          workspaceColor={workspaceColor}
          onSelect={() => onSelectSession(session)}
          onDelete={() => onDeleteSession(session.id, workspaceId)}
          onTogglePin={onPinSession && onUnpinSession ? () => {
            if (pinnedSessionIds?.has(session.id)) {
              onUnpinSession(session.id, workspaceId)
            } else {
              onPinSession(session.id, workspaceId)
            }
          } : undefined}
        />
      ))}

      {canExpand && (
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex w-full items-center justify-center gap-1 rounded-sm py-0.5 text-[10px] text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground"
        >
          {isExpanded ? (
            <>
              <ChevronRight className="size-2.5 -rotate-90" />
              Show less
            </>
          ) : (
            <>
              <ChevronRight className="size-2.5 rotate-90" />
              {hiddenCount} more
            </>
          )}
        </button>
      )}
    </div>
  )
}

interface SessionItemProps {
  session: Session
  isActive: boolean
  isPinned: boolean
  status: SessionStatus | null
  isUnread: boolean
  workspaceBranch?: string
  workspaceColor?: string
  onSelect: () => void
  onDelete: () => void
  onTogglePin?: () => void
}

function SessionItem({
  session,
  isActive,
  isPinned,
  status,
  isUnread,
  workspaceBranch,
  workspaceColor,
  onSelect,
  onDelete,
  onTogglePin,
}: SessionItemProps) {
  const formattedTime = useMemo(() => {
    return formatRelativeTime(session.time.updated)
  }, [session.time.updated])

  const isBusy = status !== null && status.type === "busy"

  return (
    <div
      role="button"
      tabIndex={0}
      data-session-id={session.id}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "group flex min-w-0 w-full cursor-pointer items-start gap-2 overflow-hidden rounded-md px-2 py-2 text-left text-sm",
        "hover:bg-muted transition-colors",
        isActive && "bg-muted"
      )}
    >
      <div className="relative mt-0.5 shrink-0">
        {isBusy ? (
          <Brain
            className="size-3.5 animate-pulse"
            style={workspaceColor ? { color: workspaceColor } : { color: "var(--color-amber-500)" }}
          />
        ) : isPinned ? (
          <Pin
            className="size-3.5 rotate-45"
            style={workspaceColor ? { color: workspaceColor } : undefined}
          />
        ) : (
          <MessageSquare
            className={cn("size-3.5", !workspaceColor && "text-muted-foreground")}
            style={workspaceColor ? { color: workspaceColor } : undefined}
          />
        )}
        {isUnread && (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-blue-500" />
        )}
      </div>
      <div className="min-w-0 w-0 flex-1 overflow-hidden">
        <p className={cn("truncate", isUnread ? "font-semibold" : "font-medium")} title={session.title || "Untitled"}>
          {session.title || "Untitled"}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs text-muted-foreground">{formattedTime}</p>
          {workspaceBranch && (
            <Badge variant="outline" className="text-xs px-1 py-0 font-normal gap-0.5">
              <GitBranch className="size-2.5" />
              {workspaceBranch}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {onTogglePin && (
          <Button
            size="icon-xs"
            variant="ghost"
            className={cn(
              "shrink-0 transition-opacity",
              "opacity-0 group-hover:opacity-100"
            )}
            onClick={(event) => {
              event.stopPropagation()
              onTogglePin()
            }}
            title={isPinned ? "Unpin" : "Pin"}
          >
            {isPinned ? (
              <PinOff className="size-3 text-muted-foreground" />
            ) : (
              <Pin className="size-3 text-muted-foreground" />
            )}
          </Button>
        )}
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
    </div>
  )
}

function SessionListSkeleton() {
  return (
    <div className="space-y-1 p-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-2 px-2 py-2">
          <Skeleton className="mt-0.5 size-3.5 shrink-0 rounded" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 rounded" style={{ width: `${60 + (i % 3) * 15}%` }} />
            <Skeleton className="h-3 w-12 rounded" />
          </div>
        </div>
      ))}
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
