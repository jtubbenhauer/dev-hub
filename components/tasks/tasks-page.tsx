"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { CheckSquare, GripVertical, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TaskSidebar } from "@/components/tasks/task-sidebar";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel";
import { TaskWorktreeDialog } from "@/components/dashboard/task-worktree-dialog";
import { useClickUpSearch, useClickUpViewTasks } from "@/hooks/use-clickup";
import { useClickUpSettings } from "@/hooks/use-settings";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLeaderAction } from "@/hooks/use-leader-action";
import type { ClickUpTask, ClickUpPinnedView } from "@/types";

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 500;
const DEFAULT_SIDEBAR_WIDTH = 224;

const MIN_DETAIL_WIDTH = 280;
const MAX_DETAIL_WIDTH = 700;
const DEFAULT_DETAIL_WIDTH = 384;

type SidebarSelection =
  | { type: "search"; query: string }
  | { type: "view"; view: ClickUpPinnedView }
  | { type: "list"; listId: string; listName: string };

export function TasksPage() {
  const { isConfigured, isLoading: isLoadingSettings } = useClickUpSettings();
  const isMobile = useIsMobile();
  const { width: sidebarWidth, handleDragStart: handleSidebarDragStart } =
    useResizablePanel({
      minWidth: MIN_SIDEBAR_WIDTH,
      maxWidth: MAX_SIDEBAR_WIDTH,
      defaultWidth: DEFAULT_SIDEBAR_WIDTH,
      storageKey: "dev-hub:tasks-sidebar-width",
    });
  const { width: detailWidth, handleDragStart: handleDetailDragStart } =
    useResizablePanel({
      minWidth: MIN_DETAIL_WIDTH,
      maxWidth: MAX_DETAIL_WIDTH,
      defaultWidth: DEFAULT_DETAIL_WIDTH,
      storageKey: "dev-hub:tasks-detail-width",
      reverse: true,
    });
  const [pendingContext] = useState(() => {
    try {
      const raw = localStorage.getItem("dev-hub:tasks-pending-context");
      if (!raw) return null;
      localStorage.removeItem("dev-hub:tasks-pending-context");
      return JSON.parse(raw) as {
        listId: string;
        listName: string;
        folderId: string;
        spaceId: string;
      };
    } catch {
      return null;
    }
  });

  const [selection, setSelection] = useState<SidebarSelection | null>(() => {
    const pending = pendingContext;
    if (pending) {
      return {
        type: "list",
        listId: pending.listId,
        listName: pending.listName,
      };
    }
    try {
      const stored = localStorage.getItem("dev-hub:tasks-selection");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [searchQuery, setSearchQuery] = useState(() => {
    try {
      return localStorage.getItem("dev-hub:tasks-search") ?? "";
    } catch {
      return "";
    }
  });
  const [selectedTask, setSelectedTask] = useState<ClickUpTask | null>(null);
  const [viewPage] = useState(0);

  const sidebarFocusRef = useRef<HTMLDivElement>(null);
  const taskListFocusRef = useRef<HTMLDivElement>(null);
  const detailFocusRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [worktreeOpen, setWorktreeOpen] = useState(false);

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isMobileDetailOpen, setIsMobileDetailOpen] = useState(false);

  const activeViewId = selection?.type === "view" ? selection.view.id : null;
  const viewTasksResult = useClickUpViewTasks(activeViewId, viewPage, {
    enabled: !!activeViewId,
  });

  const isSearch =
    selection?.type === "search" || (searchQuery.length >= 2 && !selection);
  const isListBrowse = selection?.type === "list";
  const listId = isListBrowse ? selection.listId : null;

  const searchResults = useClickUpSearch(
    selection?.type === "search"
      ? selection.query
      : isListBrowse && listId
        ? ""
        : searchQuery,
    isListBrowse && listId ? { listIds: [listId] } : {},
    { enabled: isSearch || isListBrowse },
  );

  let tasks: ClickUpTask[] | undefined;
  let isLoading = false;
  let error: Error | null = null;
  let contextLabel: string | undefined;

  if (selection?.type === "view") {
    tasks = viewTasksResult.data;
    isLoading = viewTasksResult.isLoading;
    error = viewTasksResult.error;
    contextLabel = selection.view.name;
  } else if (selection?.type === "list") {
    tasks = searchResults.data;
    isLoading = searchResults.isLoading;
    error = searchResults.error;
    contextLabel = selection.listName;
  } else if (isSearch) {
    tasks = searchResults.data;
    isLoading = searchResults.isLoading;
    error = searchResults.error;
    contextLabel = "Search results";
  }

  // Refs for stable leader key handlers
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const selectedTaskRef = useRef(selectedTask);
  selectedTaskRef.current = selectedTask;

  useEffect(() => {
    try {
      if (selection) {
        localStorage.setItem(
          "dev-hub:tasks-selection",
          JSON.stringify(selection),
        );
      } else {
        localStorage.removeItem("dev-hub:tasks-selection");
      }
    } catch {}
  }, [selection]);

  // Restore selected task from localStorage when tasks data arrives
  const [restoredTask, setRestoredTask] = useState(false);
  if (!restoredTask && !selectedTask && tasks?.length) {
    setRestoredTask(true);
    try {
      const id = localStorage.getItem("dev-hub:tasks-selected-task-id");
      if (id) {
        const found = tasks.find((t) => t.id === id);
        if (found) setSelectedTask(found);
      }
    } catch {}
  }

  // Expand sidebar spaces/folders for pending task context on mount
  useEffect(() => {
    if (!pendingContext) return;
    try {
      const SPACES_KEY = "dev-hub:tasks-expanded-spaces";
      const FOLDERS_KEY = "dev-hub:tasks-expanded-folders";
      const spaces: string[] = JSON.parse(
        localStorage.getItem(SPACES_KEY) ?? "[]",
      );
      if (!spaces.includes(pendingContext.spaceId)) {
        localStorage.setItem(
          SPACES_KEY,
          JSON.stringify([...spaces, pendingContext.spaceId]),
        );
      }
      const folders: string[] = JSON.parse(
        localStorage.getItem(FOLDERS_KEY) ?? "[]",
      );
      if (!folders.includes(pendingContext.folderId)) {
        localStorage.setItem(
          FOLDERS_KEY,
          JSON.stringify([...folders, pendingContext.folderId]),
        );
      }
    } catch {}
  }, [pendingContext]);

  useEffect(() => {
    const handleSelectTaskEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{
        taskId: string;
        task: ClickUpTask;
      }>;
      const task = customEvent.detail.task;
      setSelectedTask(task);
      setSelection({
        type: "list",
        listId: task.list.id,
        listName: task.list.name,
      });
      try {
        localStorage.setItem(
          "dev-hub:tasks-selected-task-id",
          customEvent.detail.taskId,
        );
      } catch {}
    };

    window.addEventListener("devhub:select-task", handleSelectTaskEvent);
    return () => {
      window.removeEventListener("devhub:select-task", handleSelectTaskEvent);
    };
  }, []);

  const handleSearchChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      try {
        localStorage.setItem("dev-hub:tasks-search", query);
      } catch {}
      if (query.length >= 2) {
        setSelection({ type: "search", query });
      } else if (selection?.type === "search") {
        setSelection(null);
      }
    },
    [selection],
  );

  const handleMobileSelect = useCallback((sel: SidebarSelection) => {
    setSelection(sel);
    setIsMobileSidebarOpen(false);
  }, []);

  const handleMobileSearchChange = useCallback(
    (query: string) => {
      handleSearchChange(query);
      if (query.length >= 2) {
        setIsMobileSidebarOpen(false);
      }
    },
    [handleSearchChange],
  );

  function handleSelectTask(task: ClickUpTask) {
    setSelectedTask((prev) => {
      const next = prev?.id === task.id ? null : task;
      try {
        if (next) {
          localStorage.setItem("dev-hub:tasks-selected-task-id", next.id);
        } else {
          localStorage.removeItem("dev-hub:tasks-selected-task-id");
        }
      } catch {}
      return next;
    });
    if (isMobile && task.id !== selectedTask?.id) {
      setIsMobileDetailOpen(true);
    }
  }

  function handleCloseTask() {
    setSelectedTask(null);
    setIsMobileDetailOpen(false);
    try {
      localStorage.removeItem("dev-hub:tasks-selected-task-id");
    } catch {}
  }

  const tasksLeaderActions = useMemo(
    () => [
      {
        action: {
          id: "tasks:focus-sidebar",
          label: "Focus sidebar",
          page: "tasks" as const,
        },
        handler: () => sidebarFocusRef.current?.focus(),
      },
      {
        action: {
          id: "tasks:focus-list",
          label: "Focus task list",
          page: "tasks" as const,
        },
        handler: () => taskListFocusRef.current?.focus(),
      },
      {
        action: {
          id: "tasks:focus-detail",
          label: "Focus detail panel",
          page: "tasks" as const,
        },
        handler: () => detailFocusRef.current?.focus(),
      },
      {
        action: {
          id: "tasks:focus-search",
          label: "Focus search",
          page: "tasks" as const,
        },
        handler: () => searchInputRef.current?.focus(),
      },
      {
        action: {
          id: "tasks:next-task",
          label: "Select next task",
          page: "tasks" as const,
        },
        handler: () => {
          const currentTasks = tasksRef.current;
          if (!currentTasks?.length) return;
          const idx = currentTasks.findIndex(
            (t) => t.id === selectedTaskRef.current?.id,
          );
          const next = currentTasks[idx + 1] ?? currentTasks[0];
          if (next) handleSelectTask(next);
        },
      },
      {
        action: {
          id: "tasks:prev-task",
          label: "Select previous task",
          page: "tasks" as const,
        },
        handler: () => {
          const currentTasks = tasksRef.current;
          if (!currentTasks?.length) return;
          const idx = currentTasks.findIndex(
            (t) => t.id === selectedTaskRef.current?.id,
          );
          const prev =
            currentTasks[idx - 1] ?? currentTasks[currentTasks.length - 1];
          if (prev) handleSelectTask(prev);
        },
      },
      {
        action: {
          id: "tasks:close-detail",
          label: "Close detail panel",
          page: "tasks" as const,
        },
        handler: () => handleCloseTask(),
      },
      {
        action: {
          id: "tasks:open-in-clickup",
          label: "Open in ClickUp",
          page: "tasks" as const,
        },
        handler: () => {
          if (selectedTaskRef.current?.url)
            window.open(selectedTaskRef.current.url, "_blank");
        },
      },
      {
        action: {
          id: "tasks:create-worktree",
          label: "Create worktree",
          page: "tasks" as const,
        },
        handler: () => {
          if (selectedTaskRef.current) setWorktreeOpen(true);
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useLeaderAction(tasksLeaderActions);

  if (!isLoadingSettings && !isConfigured) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <CheckSquare className="text-muted-foreground size-12" />
        <div>
          <h2 className="text-lg font-semibold">ClickUp not connected</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Configure your ClickUp API token and team in settings to get
            started.
          </p>
        </div>
        <Link href="/settings" className="text-primary text-sm hover:underline">
          Go to Settings
        </Link>
      </div>
    );
  }

  const sidebarContent = (
    <TaskSidebar
      selection={selection}
      onSelect={isMobile ? handleMobileSelect : setSelection}
      searchQuery={searchQuery}
      onSearchChange={isMobile ? handleMobileSearchChange : handleSearchChange}
      searchInputRef={searchInputRef}
      focusContainerRef={sidebarFocusRef}
    />
  );

  const hasSelection = selection != null || isSearch;

  return (
    <>
      <div className="flex h-full overflow-hidden">
        {/* Mobile: sidebar Sheet */}
        {isMobile && (
          <Sheet
            open={isMobileSidebarOpen}
            onOpenChange={setIsMobileSidebarOpen}
          >
            <SheetContent
              side="left"
              className="w-[280px] p-0"
              showCloseButton={false}
            >
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
            <div
              ref={(el) => {
                sidebarFocusRef.current = el;
              }}
              tabIndex={-1}
              style={{ width: sidebarWidth }}
              className="relative shrink-0"
            >
              {sidebarContent}
            </div>
            <div
              className="hover:bg-accent/50 active:bg-accent flex w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors"
              onMouseDown={handleSidebarDragStart}
            >
              <GripVertical className="text-muted-foreground/30 size-3.5" />
            </div>
          </>
        )}

        <div
          ref={(el) => {
            taskListFocusRef.current = el;
          }}
          tabIndex={-1}
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
        >
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
                <span className="text-muted-foreground truncate text-xs font-medium">
                  {contextLabel}
                </span>
              )}
            </div>
          )}

          <div className="flex flex-1 overflow-hidden">
            {!hasSelection ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <CheckSquare className="text-muted-foreground size-10" />
                <p className="text-muted-foreground text-sm">
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
                focusContainerRef={taskListFocusRef}
              />
            )}

            {/* Mobile: detail Sheet */}
            {isMobile && selectedTask && (
              <Sheet
                open={isMobileDetailOpen}
                onOpenChange={(open) => {
                  setIsMobileDetailOpen(open);
                  if (!open) handleCloseTask();
                }}
              >
                <SheetContent
                  side="right"
                  className="w-full p-0 sm:w-[380px]"
                  showCloseButton={false}
                >
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
                  className="hover:bg-accent/50 active:bg-accent flex w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors"
                  onMouseDown={handleDetailDragStart}
                >
                  <GripVertical className="text-muted-foreground/30 size-3.5" />
                </div>
                <div
                  ref={(el) => {
                    detailFocusRef.current = el;
                  }}
                  tabIndex={-1}
                  style={{ width: detailWidth }}
                  className="relative min-w-0 shrink-0"
                >
                  <TaskDetailPanel
                    task={selectedTask}
                    onClose={handleCloseTask}
                    className="border-l-0"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {selectedTask && (
        <TaskWorktreeDialog
          task={selectedTask}
          open={worktreeOpen}
          onOpenChange={setWorktreeOpen}
        />
      )}
    </>
  );
}
