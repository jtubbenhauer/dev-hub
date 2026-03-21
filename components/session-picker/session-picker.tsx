"use client"

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  createContext,
  useContext,
} from "react"
import { useRouter, usePathname } from "next/navigation"
import { useChatStore } from "@/stores/chat-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { fuzzySearch, type FuzzyMatch } from "@/lib/fuzzy-match"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Brain, MessageSquare, Plus, Search } from "lucide-react"
import type { Session } from "@/lib/opencode/types"

// ---------------------------------------------------------------------------
// Context – lets any component open/close the global session picker
// ---------------------------------------------------------------------------

interface SessionPickerContextValue {
  isOpen: boolean
  open: () => void
  close: () => void
}

const SessionPickerContext = createContext<SessionPickerContextValue | null>(null)

export function useSessionPicker() {
  const ctx = useContext(SessionPickerContext)
  if (!ctx) throw new Error("useSessionPicker must be used within SessionPickerProvider")
  return ctx
}

export function SessionPickerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  return (
    <SessionPickerContext.Provider value={{ isOpen, open, close }}>
      {children}
    </SessionPickerContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Session entry type for the picker
// ---------------------------------------------------------------------------

interface SessionEntry {
  session: Session
  workspaceId: string
  workspaceName: string
  workspaceColor: string | null
  searchText: string
}

// ---------------------------------------------------------------------------
// Highlighted text renderer (reused fuzzy match highlight pattern)
// ---------------------------------------------------------------------------

function HighlightedText({ text, positions }: { text: string; positions: Set<number> }) {
  if (positions.size === 0) {
    return <>{text}</>
  }

  const parts: React.ReactNode[] = []
  let i = 0
  while (i < text.length) {
    if (positions.has(i)) {
      let end = i
      while (end < text.length && positions.has(end)) end++
      parts.push(
        <span key={i} className="text-primary font-semibold">
          {text.slice(i, end)}
        </span>
      )
      i = end
    } else {
      let end = i
      while (end < text.length && !positions.has(end)) end++
      parts.push(<span key={i}>{text.slice(i, end)}</span>)
      i = end
    }
  }

  return <>{parts}</>
}

// ---------------------------------------------------------------------------
// Relative time formatting
// ---------------------------------------------------------------------------

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp * 1000
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

// ---------------------------------------------------------------------------
// Session Picker Dialog (global overlay)
// ---------------------------------------------------------------------------

export function SessionPickerDialog() {
  const { isOpen, close } = useSessionPicker()
  const router = useRouter()
  const pathname = usePathname()

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const workspaceStates = useChatStore((s) => s.workspaceStates)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const setActiveSession = useChatStore((s) => s.setActiveSession)
  const setActiveWorkspaceId = useChatStore((s) => s.setActiveWorkspaceId)
  const createSession = useChatStore((s) => s.createSession)

  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const workspaceMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string | null }>()
    for (const ws of workspaces) {
      map.set(ws.id, { name: ws.name, color: ws.color })
    }
    return map
  }, [workspaces])

  // Build flat list of all sessions across workspaces, sorted by most recently updated
  const sessionEntries = useMemo<SessionEntry[]>(() => {
    const entries: SessionEntry[] = []
    for (const [workspaceId, ws] of Object.entries(workspaceStates)) {
      const wsInfo = workspaceMap.get(workspaceId)
      const workspaceName = wsInfo?.name ?? workspaceId
      const workspaceColor = wsInfo?.color ?? null
      for (const session of Object.values(ws.sessions)) {
        if (session.parentID) continue
        entries.push({
          session,
          workspaceId,
          workspaceName,
          workspaceColor,
          searchText: session.title || "Untitled",
        })
      }
    }
    entries.sort((a, b) => b.session.time.updated - a.session.time.updated)
    return entries
  }, [workspaceStates, workspaceMap])

  const searchTexts = useMemo(
    () => sessionEntries.map((e) => e.searchText),
    [sessionEntries],
  )

  const fuzzyResults = useMemo(
    () => fuzzySearch(query, searchTexts, 100),
    [query, searchTexts],
  )

  // Map fuzzy results back to session entries
  const results = useMemo(() => {
    if (!query) return sessionEntries
    const textToEntry = new Map<string, SessionEntry[]>()
    for (const entry of sessionEntries) {
      const list = textToEntry.get(entry.searchText) ?? []
      list.push(entry)
      textToEntry.set(entry.searchText, list)
    }
    // Track consumed entries per searchText to handle duplicates
    const consumed = new Map<string, number>()
    return fuzzyResults.map((match) => {
      const list = textToEntry.get(match.path) ?? []
      const idx = consumed.get(match.path) ?? 0
      consumed.set(match.path, idx + 1)
      return { entry: list[idx] ?? list[0], match }
    })
  }, [query, sessionEntries, fuzzyResults])

  // Total items: "New Session" row + session results
  const hasNewSessionRow = !query
  const totalItems = (hasNewSessionRow ? 1 : 0) + results.length

  // Reset state when dialog opens (during-render pattern)
  const [prevIsOpen, setPrevIsOpen] = useState(false)
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true)
    setQuery("")
    setSelectedIndex(0)
  } else if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false)
  }

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  // Clamp selectedIndex when results change (during render)
  if (selectedIndex >= totalItems && totalItems > 0) {
    setSelectedIndex(Math.max(0, totalItems - 1))
  }

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`)
    if (selected) {
      selected.scrollIntoView({ block: "nearest" })
    }
  }, [selectedIndex])

  const navigateToChat = useCallback(() => {
    if (!pathname.startsWith("/chat")) {
      router.push("/chat")
    }
  }, [pathname, router])

  const handleSelectSession = useCallback(
    (entry: SessionEntry) => {
      if (entry.workspaceId !== activeWorkspaceId) {
        useWorkspaceStore.getState().setActiveWorkspaceId(entry.workspaceId)
        setActiveWorkspaceId(entry.workspaceId)
      }
      setActiveSession(entry.session.id)
      close()
      navigateToChat()
    },
    [activeWorkspaceId, setActiveWorkspaceId, setActiveSession, close, navigateToChat],
  )

  const handleNewSession = useCallback(async () => {
    if (!activeWorkspaceId) return
    close()
    navigateToChat()
    await createSession(activeWorkspaceId)
  }, [activeWorkspaceId, close, navigateToChat, createSession])

  const handleSelect = useCallback(
    (index: number) => {
      if (hasNewSessionRow && index === 0) {
        handleNewSession()
        return
      }
      const resultIndex = hasNewSessionRow ? index - 1 : index
      const result = results[resultIndex]
      if (result) {
        const entry = query ? (result as { entry: SessionEntry; match: FuzzyMatch }).entry : result as unknown as SessionEntry
        handleSelectSession(entry)
      }
    },
    [hasNewSessionRow, results, query, handleNewSession, handleSelectSession],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
        case "j":
          if (e.ctrlKey || e.key === "ArrowDown") {
            e.preventDefault()
            setSelectedIndex((i) => Math.min(i + 1, totalItems - 1))
          }
          break
        case "ArrowUp":
        case "k":
          if (e.ctrlKey || e.key === "ArrowUp") {
            e.preventDefault()
            setSelectedIndex((i) => Math.max(i - 1, 0))
          }
          break
        case "Enter":
          e.preventDefault()
          handleSelect(selectedIndex)
          break
        case "Escape":
          e.preventDefault()
          close()
          break
      }
    },
    [totalItems, selectedIndex, handleSelect, close],
  )

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0"
        showCloseButton={false}
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Switch session</DialogTitle>
          <DialogDescription>Search and switch between chat sessions</DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder="Search sessions..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Results */}
        <ScrollArea className="h-[min(400px,60vh)] [&>[data-slot=scroll-area-viewport]]:!overflow-x-hidden [&>[data-slot=scroll-area-viewport]>div]:!block">
          <div ref={listRef} className="p-1">
            {totalItems === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No sessions match
              </p>
            )}

            {/* New Session row (only when no search query) */}
            {hasNewSessionRow && (
              <button
                data-index={0}
                className={cn(
                  "flex w-full items-center gap-2 overflow-hidden rounded-sm px-2 py-1.5 text-left text-sm",
                  selectedIndex === 0
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
                onClick={handleNewSession}
                onMouseEnter={() => setSelectedIndex(0)}
              >
                <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 truncate text-xs">New Session</div>
                {activeWorkspaceId && (() => {
                  const wsInfo = workspaceMap.get(activeWorkspaceId)
                  if (!wsInfo) return null
                  return (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: wsInfo.color ?? "var(--color-muted-foreground)" }}
                      />
                      <span className="max-w-[100px] truncate">{wsInfo.name}</span>
                    </span>
                  )
                })()}
              </button>
            )}

            {/* Session entries */}
            {results.map((result, i) => {
              const displayIndex = hasNewSessionRow ? i + 1 : i
              const isSelected = displayIndex === selectedIndex

              let entry: SessionEntry
              let positions: Set<number>
              if (query) {
                const r = result as { entry: SessionEntry; match: FuzzyMatch }
                entry = r.entry
                positions = r.match.positions
              } else {
                entry = result as SessionEntry
                positions = new Set<number>()
              }

              const isCurrentSession = entry.session.id === activeSessionId
              const title = entry.session.title || "Untitled"
              const status = workspaceStates[entry.workspaceId]?.sessionStatuses[entry.session.id]
              const isBusy = status?.type === "busy"

              return (
                <button
                  key={`${entry.workspaceId}-${entry.session.id}`}
                  data-index={displayIndex}
                  className={cn(
                    "flex w-full items-center gap-2 overflow-hidden rounded-sm px-2 py-1.5 text-left text-sm",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                  onClick={() => handleSelectSession(entry)}
                  onMouseEnter={() => setSelectedIndex(displayIndex)}
                >
                  {isBusy ? (
                    <Brain
                      className="size-3.5 shrink-0 animate-pulse"
                      style={entry.workspaceColor ? { color: entry.workspaceColor } : { color: "var(--color-amber-500)" }}
                    />
                  ) : (
                    <MessageSquare
                      className={cn("size-3.5 shrink-0", !entry.workspaceColor && "text-muted-foreground")}
                      style={entry.workspaceColor ? { color: entry.workspaceColor } : undefined}
                    />
                  )}
                  <div className={cn("min-w-0 flex-1 truncate text-xs", isCurrentSession && "font-semibold")}>
                    <HighlightedText text={title} positions={positions} />
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: entry.workspaceColor ?? "var(--color-muted-foreground)" }}
                    />
                    <span className="max-w-[100px] truncate">{entry.workspaceName}</span>
                    <span>·</span>
                    <span className="whitespace-nowrap">{formatRelativeTime(entry.session.time.updated)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </ScrollArea>

        {/* Footer hints */}
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground/60">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
