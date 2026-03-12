"use client"

import { useState } from "react"
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

type SidebarSelection =
  | { type: "search"; query: string }
  | { type: "view"; view: ClickUpPinnedView }
  | { type: "list"; listId: string; listName: string }

export function TasksPage() {
  const { isConfigured, isLoading: isLoadingSettings } = useClickUpSettings()
  const { width: sidebarWidth, handleDragStart } = useResizablePanel({
    minWidth: MIN_SIDEBAR_WIDTH,
    maxWidth: MAX_SIDEBAR_WIDTH,
    defaultWidth: DEFAULT_SIDEBAR_WIDTH,
    storageKey: "dev-hub:tasks-sidebar-width",
  })
  const [selection, setSelection] = useState<SidebarSelection | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTask, setSelectedTask] = useState<ClickUpTask | null>(null)
  const [viewPage, _setViewPage] = useState(0)

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

  function handleSearchChange(query: string) {
    setSearchQuery(query)
    if (query.length >= 2) {
      setSelection({ type: "search", query })
    } else if (selection?.type === "search") {
      setSelection(null)
    }
  }

  function handleSelectTask(task: ClickUpTask) {
    setSelectedTask((prev) => (prev?.id === task.id ? null : task))
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
        onMouseDown={handleDragStart}
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
          <TaskDetailPanel
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
          />
        )}
      </div>
    </div>
  )
}
