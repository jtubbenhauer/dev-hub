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
import Link from "next/link"
import { useMyClickUpTasks, useClickUpSearch } from "@/hooks/use-clickup"
import { useClickUpSettings } from "@/hooks/use-settings"
import { fuzzySearch, type FuzzyMatch } from "@/lib/fuzzy-match"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Loader2, Search } from "lucide-react"
import type { ClickUpTask } from "@/types"

interface TaskPickerContextValue {
  isOpen: boolean
  open: () => void
  close: () => void
}

const TaskPickerContext = createContext<TaskPickerContextValue | null>(null)

export function useTaskPicker() {
  const ctx = useContext(TaskPickerContext)
  if (!ctx) throw new Error("useTaskPicker must be used within TaskPickerProvider")
  return ctx
}

export function TaskPickerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  return (
    <TaskPickerContext.Provider value={{ isOpen, open, close }}>
      {children}
    </TaskPickerContext.Provider>
  )
}

// Duplicated from session-picker — extract if a third picker appears
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

export function TaskPickerDialog() {
  const { isOpen, close } = useTaskPicker()
  const router = useRouter()
  const pathname = usePathname()
  const { isConfigured, isLoading: isSettingsLoading } = useClickUpSettings()

  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  const {
    data: myTasks,
    isLoading: isMyTasksLoading,
    error: myTasksError,
  } = useMyClickUpTasks({ enabled: isConfigured })

  const isServerSearch = debouncedQuery.length >= 2
  const {
    data: searchTasks,
    isLoading: isSearchLoading,
    error: searchError,
  } = useClickUpSearch(debouncedQuery, {}, { enabled: isConfigured && isServerSearch })

  const taskNames = useMemo(
    () => (myTasks ?? []).map((t) => t.name),
    [myTasks],
  )

  const fuzzyResults = useMemo(
    () => (isServerSearch ? [] : fuzzySearch(query, taskNames, 100)),
    [isServerSearch, query, taskNames],
  )

  const results = useMemo<Array<{ task: ClickUpTask; match: FuzzyMatch | null }>>(() => {
    if (isServerSearch) {
      return (searchTasks ?? []).map((task) => ({ task, match: null }))
    }

    if (!query) {
      return (myTasks ?? []).map((task) => ({ task, match: null }))
    }

    const nameToTasks = new Map<string, ClickUpTask[]>()
    for (const task of myTasks ?? []) {
      const list = nameToTasks.get(task.name) ?? []
      list.push(task)
      nameToTasks.set(task.name, list)
    }
    const consumed = new Map<string, number>()
    return fuzzyResults.map((match) => {
      const list = nameToTasks.get(match.path) ?? []
      const idx = consumed.get(match.path) ?? 0
      consumed.set(match.path, idx + 1)
      return { task: list[idx] ?? list[0], match }
    })
  }, [isServerSearch, query, myTasks, searchTasks, fuzzyResults])

  const totalItems = results.length

  const isLoading = isSettingsLoading || (isServerSearch ? isSearchLoading : isMyTasksLoading)
  const error = isServerSearch ? searchError : myTasksError

  useEffect(() => {
    if (isOpen) {
      setQuery("")
      setDebouncedQuery("")
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  useEffect(() => {
    if (selectedIndex >= totalItems) {
      setSelectedIndex(Math.max(0, totalItems - 1))
    }
  }, [totalItems, selectedIndex])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`)
    if (selected) {
      selected.scrollIntoView({ block: "nearest" })
    }
  }, [selectedIndex])

  const handleSelectTask = useCallback(
    (task: ClickUpTask) => {
      localStorage.setItem("dev-hub:tasks-selected-task-id", task.id)
      localStorage.setItem("dev-hub:tasks-pending-context", JSON.stringify({
        listId: task.list.id,
        listName: task.list.name,
        folderId: task.folder.id,
        spaceId: task.space.id,
      }))
      window.dispatchEvent(
        new CustomEvent("devhub:select-task", { detail: { taskId: task.id, task } })
      )
      if (!pathname.startsWith("/tasks")) {
        router.push("/tasks")
      }
      close()
    },
    [pathname, router, close],
  )

  const handleSelect = useCallback(
    (index: number) => {
      const result = results[index]
      if (result) {
        handleSelectTask(result.task)
      }
    },
    [results, handleSelectTask],
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
          <DialogTitle>Switch task</DialogTitle>
          <DialogDescription>Search and switch between ClickUp tasks</DialogDescription>
        </DialogHeader>

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
            placeholder="Search tasks..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <ScrollArea className="h-[min(400px,60vh)] [&>[data-slot=scroll-area-viewport]]:!overflow-x-hidden [&>[data-slot=scroll-area-viewport]>div]:!block">
          <div ref={listRef} className="p-1">
            {!isSettingsLoading && !isConfigured && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <p className="text-sm text-muted-foreground">ClickUp not configured</p>
                <Link
                  href="/settings"
                  onClick={() => close()}
                  className="text-sm text-primary underline underline-offset-4 hover:text-primary/80"
                >
                  Configure in Settings
                </Link>
              </div>
            )}

            {isConfigured && isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {isConfigured && !isLoading && error && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {error.message}
              </p>
            )}

            {isConfigured && !isLoading && !error && totalItems === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No tasks found
              </p>
            )}

            {isConfigured && !isLoading && !error && results.map((result, i) => {
              const isSelected = i === selectedIndex
              const { task, match } = result
              const priorityColor = task.priority
                ? (PRIORITY_COLORS[task.priority.priority] ?? "bg-gray-400")
                : "bg-gray-300"

              return (
                <button
                  type="button"
                  key={task.id}
                  data-index={i}
                  className={cn(
                    "flex w-full items-center gap-2 overflow-hidden rounded-sm px-2 py-1.5 text-left text-sm",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                  onClick={() => handleSelectTask(task)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className={cn("size-2 shrink-0 rounded-full", priorityColor)} />

                  <div className="min-w-0 flex-1 truncate text-xs">
                    {match ? (
                      <HighlightedText text={task.name} positions={match.positions} />
                    ) : (
                      task.name
                    )}
                  </div>

                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="max-w-[80px] truncate">{task.list.name}</span>
                    <span>·</span>
                    <Badge
                      variant="secondary"
                      className="px-1 py-0 text-[10px] font-normal"
                      style={{ color: task.status.color }}
                    >
                      {task.status.status}
                    </Badge>
                    <span>·</span>
                    <span className="whitespace-nowrap">{formatRelativeTime(task.date_updated)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </ScrollArea>

        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground/60">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
