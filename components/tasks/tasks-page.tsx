"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { CheckSquare, GripVertical, PanelLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TaskSidebar } from "@/components/tasks/task-sidebar"
import { TaskList } from "@/components/tasks/task-list"
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel"
import { useClickUpSearch, useClickUpViewTasks } from "@/hooks/use-clickup"
import { useClickUpSettings } from "@/hooks/use-settings"
import { useResizablePanel } from "@/hooks/use-resizable-panel"
import { useIsMobile } from "@/hooks/use-mobile"
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
  const isMobile = useIsMobile()
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

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [isMobileDetailOpen, setIsMobileDetailOpen] = useState(false)

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

  const handleMobileSelect = useCallback((sel: SidebarSelection) => {
    setSelection(sel)
    setIsMobileSidebarOpen(false)
  }, [])

  const handleMobileSearchChange = useCallback((query: string) => {
    handleSearchChange(query)
    if (query.length >= 2) {
      setIsMobileSidebarOpen(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection])

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
    if (isMobile && task.id !== selectedTask?.id) {
      setIsMobileDetailOpen(true)
    }
  }

  function handleCloseTask() {
    setSelectedTask(null)
    setIsMobileDetailOpen(false)
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

  const sidebarContent = (
    <TaskSidebar
      selection={selection}
      onSelect={isMobile ? handleMobileSelect : setSelection}
      searchQuery={searchQuery}
      onSearchChange={isMobile ? handleMobileSearchChange : handleSearchChange}
    />
  )

  const hasSelection = selection != null || isSearch

  return (
    <div className="flex h-full overflow-hidden">
      {/* Mobile: sidebar Sheet */}
      {isMobile && (
        <Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
          <SheetContent side="left" className="w-[280px] p-0" showCloseButton={false}>
            <SheetHeader className="sr-only">
              <SheetTitle>Task browser</SheetTitle>
            </SheetHeader>
            {sidebarContent}
          </SheetContent>
        </Sheet>
      )}

      {/* Desktop: inline sidebar */}
      {!isMobile && (
        <>
          <div style={{ width: sidebarWidth }} className="shrink-0">
            {sidebarContent}
          </div>
          <div
            className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent/50 active:bg-accent transition-colors"
            onMouseDown={handleSidebarDragStart}
          >
            <GripVertical className="size-3.5 text-muted-foreground/30" />
          </div>
        </>
      )}

      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Mobile toolbar */}
        {isMobile && (
          <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setIsMobileSidebarOpen(true)}
            >
              <PanelLeft className="size-3.5" />
            </Button>
            {contextLabel && (
              <span className="text-xs font-medium text-muted-foreground truncate">
                {contextLabel}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {!hasSelection ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
              <CheckSquare className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {isMobile
                  ? "Tap the sidebar button to browse views and lists, or search for tasks."
                  : "Select a view or list from the sidebar, or search for tasks."}
              </p>
            </div>
          ) : (
            <TaskList
              tasks={tasks}
              isLoading={isLoading}
              error={error}
              contextLabel={isMobile ? undefined : contextLabel}
              selectedTaskId={selectedTask?.id ?? null}
              onSelectTask={handleSelectTask}
            />
          )}

          {/* Mobile: detail Sheet */}
          {isMobile && selectedTask && (
            <Sheet open={isMobileDetailOpen} onOpenChange={(open) => {
              setIsMobileDetailOpen(open)
              if (!open) handleCloseTask()
            }}>
              <SheetContent side="right" className="w-full sm:w-[380px] p-0" showCloseButton={false}>
                <SheetHeader className="sr-only">
                  <SheetTitle>Task detail</SheetTitle>
                </SheetHeader>
                <TaskDetailPanel
                  task={selectedTask}
                  onClose={handleCloseTask}
                  className="border-l-0"
                />
              </SheetContent>
            </Sheet>
          )}

          {/* Desktop: inline detail panel */}
          {!isMobile && selectedTask && (
            <>
              <div
                className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent/50 active:bg-accent transition-colors"
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
    </div>
  )
}
