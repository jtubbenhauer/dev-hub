"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { CheckSquare, GripVertical } from "lucide-react"
import { TaskSidebar } from "@/components/tasks/task-sidebar"
import { TaskList } from "@/components/tasks/task-list"
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel"
import { useClickUpSearch, useClickUpViewTasks } from "@/hooks/use-clickup"
import { useClickUpSettings } from "@/hooks/use-settings"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import type { ClickUpTask, ClickUpPinnedView } from "@/types"

const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 500
const DEFAULT_SIDEBAR_WIDTH = 224

const MIN_DETAIL_WIDTH = 280
const MAX_DETAIL_WIDTH = 700
const DEFAULT_DETAIL_WIDTH = 384

type SidebarSelection =
  | { type: "search"; query: string }
  | { type: "view"; view: ClickUpPinnedView }
  | { type: "list"; listId: string; listName: string }

export function TasksPage() {
  const { isConfigured, isLoading: isLoadingSettings } = useClickUpSettings()
  const { width: sidebarWidth, handleDragStart: handleSidebarDragStart } = useResizablePanel({
    minWidth: MIN_SIDEBAR_WIDTH,
    maxWidth: MAX_SIDEBAR_WIDTH,
    defaultWidth: DEFAULT_SIDEBAR_WIDTH,
    storageKey: "dev-hub:tasks-sidebar-width",
  })
  const { width: detailWidth, handleDragStart: handleDetailDragStart } = useResizablePanel({
    minWidth: MIN_DETAIL_WIDTH,
    maxWidth: MAX_DETAIL_WIDTH,
    defaultWidth: DEFAULT_DETAIL_WIDTH,
    storageKey: "dev-hub:tasks-detail-width",
    reverse: true,
  })
  const [selection, setSelection] = useState<SidebarSelection | null>(() => {
    try {
      const stored = localStorage.getItem("dev-hub:tasks-selection")
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })
  const [searchQuery, setSearchQuery] = useState(() => {
    try {
      return localStorage.getItem("dev-hub:tasks-search") ?? ""
    } catch {
      return ""
    }
  })
  const [selectedTask, setSelectedTask] = useState<ClickUpTask | null>(null)
  const [viewPage, _setViewPage] = useState(0)
  const restoredTaskRef = useRef(false)

  const activeViewId = selection?.type === "view" ? selection.view.id : null
  const viewTasksResult = useClickUpViewTasks(activeViewId, viewPage, { enabled: !!activeViewId })

  const isSearch = selection?.type === "search" || (searchQuery.length >= 2 && !selection)
  const isListBrowse = selection?.type === "list"
  const listId = isListBrowse ? selection.listId : null

  const searchResults = useClickUpSearch(
    selection?.type === "search"
      ? selection.query
      : isListBrowse && listId
        ? ""
        : searchQuery,
    isListBrowse && listId ? { listIds: [listId] } : {},
    { enabled: isSearch || isListBrowse }
  )

  // Determine what to show in the main pane
  let tasks: ClickUpTask[] | undefined
  let isLoading = false
  let error: Error | null = null
  let contextLabel: string | undefined

  if (selection?.type === "view") {
    tasks = viewTasksResult.data
    isLoading = viewTasksResult.isLoading
    error = viewTasksResult.error
    contextLabel = selection.view.name
  } else if (selection?.type === "list") {
    tasks = searchResults.data
    isLoading = searchResults.isLoading
    error = searchResults.error
    contextLabel = selection.listName
  } else if (isSearch) {
    tasks = searchResults.data
    isLoading = searchResults.isLoading
    error = searchResults.error
    contextLabel = "Search results"
  }

  useEffect(() => {
    try {
      if (selection) {
        localStorage.setItem("dev-hub:tasks-selection", JSON.stringify(selection))
      } else {
        localStorage.removeItem("dev-hub:tasks-selection")
      }
    } catch {}
  }, [selection])

  // Restore selected task from loaded list once on mount — the ref guard
  // prevents re-triggering when the user manually changes selection later.
  useEffect(() => {
    if (restoredTaskRef.current || selectedTask) return
    if (!tasks?.length) return
    try {
      const id = localStorage.getItem("dev-hub:tasks-selected-task-id")
      if (!id) { restoredTaskRef.current = true; return }
      const found = tasks.find((t) => t.id === id)
      if (found) setSelectedTask(found)
    } catch {}
    restoredTaskRef.current = true
  }, [tasks, selectedTask])

  function handleSearchChange(query: string) {
    setSearchQuery(query)
    try { localStorage.setItem("dev-hub:tasks-search", query) } catch {}
    if (query.length >= 2) {
      setSelection({ type: "search", query })
    } else if (selection?.type === "search") {
      setSelection(null)
    }
  }

  function handleSelectTask(task: ClickUpTask) {
    setSelectedTask((prev) => {
      const next = prev?.id === task.id ? null : task
      try {
        if (next) {
          localStorage.setItem("dev-hub:tasks-selected-task-id", next.id)
        } else {
          localStorage.removeItem("dev-hub:tasks-selected-task-id")
        }
      } catch {}
      return next
    })
  }

  function handleCloseTask() {
    setSelectedTask(null)
    try { localStorage.removeItem("dev-hub:tasks-selected-task-id") } catch {}
  }

  if (!isLoadingSettings && !isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <CheckSquare className="size-12 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">ClickUp not connected</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure your ClickUp API token and team in settings to get started.
          </p>
        </div>
        <Link href="/settings" className="text-sm text-primary hover:underline">
          Go to Settings
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      <TaskSidebar
        selection={selection}
        onSelect={setSelection}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        style={{ width: sidebarWidth }}
      />

      <div
        className="hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent/50 active:bg-accent transition-colors md:flex"
        onMouseDown={handleSidebarDragStart}
      >
        <GripVertical className="size-3.5 text-muted-foreground/30" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {selection == null && !isSearch ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
            <CheckSquare className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Select a view or list from the sidebar, or search for tasks.
            </p>
          </div>
        ) : (
          <TaskList
            tasks={tasks}
            isLoading={isLoading}
            error={error}
            contextLabel={contextLabel}
            selectedTaskId={selectedTask?.id ?? null}
            onSelectTask={handleSelectTask}
          />
        )}

        {selectedTask && (
          <>
            <div
              className="hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent/50 active:bg-accent transition-colors md:flex"
              onMouseDown={handleDetailDragStart}
            >
              <GripVertical className="size-3.5 text-muted-foreground/30" />
            </div>
            <TaskDetailPanel
              task={selectedTask}
              onClose={handleCloseTask}
              style={{ width: detailWidth }}
            />
          </>
        )}
      </div>
    </div>
  )
}
