"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Star,
  ChevronRight,
  ChevronDown,
  List,
  Folder,
  Layout,
  Loader2,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskSearch } from "@/components/tasks/task-search";
import { cn, isEditorElement } from "@/lib/utils";
import {
  useClickUpHierarchy,
  useClickUpPinnedViews,
  usePinView,
  useUnpinView,
} from "@/hooks/use-clickup";
import { useClickUpSettings } from "@/hooks/use-settings";
import type {
  ClickUpView,
  ClickUpSpace,
  ClickUpFolder,
  ClickUpList,
  ClickUpPinnedView,
} from "@/types";

const SPACES_KEY = "dev-hub:tasks-expanded-spaces";
const FOLDERS_KEY = "dev-hub:tasks-expanded-folders";

function readStoredSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function persistSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {}
}

// Discriminated union for every visible sidebar row
type SidebarItem =
  | { kind: "pinned-view"; id: string; view: ClickUpPinnedView }
  | { kind: "space"; id: string; spaceId: string }
  | { kind: "view"; id: string; view: ClickUpView }
  | { kind: "folder"; id: string; folderId: string }
  | { kind: "list"; id: string; listId: string; listName: string };

function flattenVisibleSidebarItems(
  pinnedViews: ClickUpPinnedView[],
  hierarchy: { spaces: ClickUpSpace[]; views: ClickUpView[] } | undefined,
  expandedSpaces: Set<string>,
  expandedFolders: Set<string>,
): SidebarItem[] {
  const items: SidebarItem[] = [];

  // Pinned views
  for (const view of pinnedViews) {
    items.push({ kind: "pinned-view", id: `pinned:${view.id}`, view });
  }

  if (!hierarchy) return items;

  for (const space of hierarchy.spaces) {
    items.push({ kind: "space", id: `space:${space.id}`, spaceId: space.id });

    if (!expandedSpaces.has(space.id)) continue;

    // Space-level views
    const spaceViews = hierarchy.views.filter((v) => v.parent?.id === space.id);
    for (const view of spaceViews) {
      items.push({ kind: "view", id: `view:${view.id}`, view });
    }

    // Folders
    for (const folder of space.folders) {
      items.push({
        kind: "folder",
        id: `folder:${folder.id}`,
        folderId: folder.id,
      });
      if (expandedFolders.has(folder.id)) {
        for (const list of folder.lists) {
          items.push({
            kind: "list",
            id: `list:${list.id}`,
            listId: list.id,
            listName: list.name,
          });
        }
      }
    }

    // Folderless lists
    for (const list of space.lists) {
      items.push({
        kind: "list",
        id: `list:${list.id}`,
        listId: list.id,
        listName: list.name,
      });
    }
  }

  // Workspace-level views
  const wsViews = hierarchy.views.filter(
    (v) =>
      !v.parent?.id || !hierarchy.spaces.some((s) => s.id === v.parent?.id),
  );
  for (const view of wsViews) {
    items.push({ kind: "view", id: `view:${view.id}`, view });
  }

  return items;
}

type SidebarSelection =
  | { type: "search"; query: string }
  | { type: "view"; view: ClickUpPinnedView }
  | { type: "list"; listId: string; listName: string };

interface TaskSidebarProps {
  selection: SidebarSelection | null;
  onSelect: (selection: SidebarSelection) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchInputRef?: React.Ref<HTMLInputElement>;
  focusContainerRef?: React.RefObject<HTMLElement | null>;
}

function PinnedViewItem({
  view,
  isSelected,
  isKeySelected,
  sidebarId,
  onSelect,
  onUnpin,
}: {
  view: ClickUpPinnedView;
  isSelected: boolean;
  isKeySelected: boolean;
  sidebarId: string;
  onSelect: () => void;
  onUnpin: () => void;
}) {
  return (
    <div
      data-sidebar-id={sidebarId}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50",
        isKeySelected && "ring-ring ring-1",
      )}
      onClick={onSelect}
    >
      <Layout className="text-muted-foreground size-3.5 shrink-0" />
      <span className="flex-1 truncate text-sm">{view.name}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onUnpin();
        }}
        className="hover:text-foreground flex size-5 items-center justify-center rounded text-yellow-500 opacity-0 transition-opacity group-hover:opacity-100"
        title="Unpin view"
      >
        <Star className="size-3 fill-current" />
      </button>
    </div>
  );
}

function ViewBrowseItem({
  view,
  isPinned,
  isSelected,
  isKeySelected,
  sidebarId,
  onSelect,
  onPin,
}: {
  view: ClickUpView;
  isPinned: boolean;
  isSelected: boolean;
  isKeySelected: boolean;
  sidebarId: string;
  onSelect: () => void;
  onPin: () => void;
}) {
  return (
    <div
      data-sidebar-id={sidebarId}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50",
        isKeySelected && "ring-ring ring-1",
      )}
      onClick={onSelect}
    >
      <Layout className="text-muted-foreground size-3 shrink-0" />
      <span className="flex-1 truncate text-xs">{view.name}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onPin();
        }}
        className={cn(
          "flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100",
          isPinned
            ? "text-yellow-500"
            : "text-muted-foreground hover:text-yellow-500",
        )}
        title={isPinned ? "Pinned" : "Pin view"}
      >
        <Star className={cn("size-3", isPinned && "fill-current")} />
      </button>
    </div>
  );
}

function ListBrowseItem({
  list,
  isSelected,
  isKeySelected,
  sidebarId,
  onSelect,
}: {
  list: ClickUpList;
  isSelected: boolean;
  isKeySelected: boolean;
  sidebarId: string;
  onSelect: () => void;
}) {
  return (
    <div
      data-sidebar-id={sidebarId}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50",
        isKeySelected && "ring-ring ring-1",
      )}
      onClick={onSelect}
    >
      <List className="text-muted-foreground size-3 shrink-0" />
      <span className="flex-1 truncate text-xs">{list.name}</span>
      {list.task_count != null && (
        <span className="text-muted-foreground text-xs tabular-nums">
          {list.task_count}
        </span>
      )}
    </div>
  );
}

function FolderItem({
  folder,
  isOpen,
  isKeySelected,
  sidebarId,
  keySelectedId,
  onToggle,
  selection,
  onSelect,
}: {
  folder: ClickUpFolder;
  isOpen: boolean;
  isKeySelected: boolean;
  sidebarId: string;
  keySelectedId: string | null;
  onToggle: () => void;
  selection: SidebarSelection | null;
  onSelect: (selection: SidebarSelection) => void;
}) {
  return (
    <div>
      <button
        data-sidebar-id={sidebarId}
        className={cn(
          "text-muted-foreground hover:bg-muted/30 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors",
          isKeySelected && "ring-ring ring-1",
        )}
        onClick={onToggle}
      >
        {isOpen ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <Folder className="size-3 shrink-0" />
        <span className="truncate">{folder.name}</span>
      </button>
      {isOpen && (
        <div className="ml-4 space-y-0.5">
          {folder.lists.map((list) => (
            <ListBrowseItem
              key={list.id}
              list={list}
              isSelected={
                selection?.type === "list" && selection.listId === list.id
              }
              isKeySelected={keySelectedId === `list:${list.id}`}
              sidebarId={`list:${list.id}`}
              onSelect={() =>
                onSelect({ type: "list", listId: list.id, listName: list.name })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HierarchySkeleton() {
  return (
    <div className="space-y-1.5 px-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}

export function TaskSidebar({
  selection,
  onSelect,
  searchQuery,
  onSearchChange,
  searchInputRef,
  focusContainerRef,
}: TaskSidebarProps) {
  const { isConfigured } = useClickUpSettings();
  const { pinnedViews } = useClickUpPinnedViews();
  const { data: hierarchy, isLoading: isLoadingHierarchy } =
    useClickUpHierarchy({ enabled: isConfigured });
  const pinView = usePinView();
  const unpinView = useUnpinView();

  const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(() =>
    readStoredSet(SPACES_KEY),
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() =>
    readStoredSet(FOLDERS_KEY),
  );

  useEffect(() => {
    const handlePickerSelect = (event: Event) => {
      const { task } = (
        event as CustomEvent<{
          taskId: string;
          task: import("@/types").ClickUpTask;
        }>
      ).detail;
      setExpandedSpaces((prev) => {
        if (prev.has(task.space.id)) return prev;
        const next = new Set(prev);
        next.add(task.space.id);
        persistSet(SPACES_KEY, next);
        return next;
      });
      setExpandedFolders((prev) => {
        if (prev.has(task.folder.id)) return prev;
        const next = new Set(prev);
        next.add(task.folder.id);
        persistSet(FOLDERS_KEY, next);
        return next;
      });
    };
    window.addEventListener("devhub:select-task", handlePickerSelect);
    return () =>
      window.removeEventListener("devhub:select-task", handlePickerSelect);
  }, []);

  const toggleSpace = useCallback((spaceId: string) => {
    setExpandedSpaces((prev) => {
      const next = new Set(prev);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      persistSet(SPACES_KEY, next);
      return next;
    });
  }, []);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      persistSet(FOLDERS_KEY, next);
      return next;
    });
  }, []);

  function handleSearchChange(query: string) {
    onSearchChange(query);
    if (query.length >= 2) {
      onSelect({ type: "search", query });
    }
  }

  const pinnedViewIds = new Set(pinnedViews.map((v) => v.id));

  // j/k/Enter keyboard navigation
  const flatItems = useMemo(
    () =>
      flattenVisibleSidebarItems(
        pinnedViews,
        hierarchy,
        expandedSpaces,
        expandedFolders,
      ),
    [pinnedViews, hierarchy, expandedSpaces, expandedFolders],
  );

  const [keySelectedId, setKeySelectedId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Clamp selection when visible items change
  if (
    keySelectedId !== null &&
    !flatItems.some((item) => item.id === keySelectedId)
  ) {
    setKeySelectedId(null);
  }

  // Scroll keyboard-selected item into view
  useEffect(() => {
    if (!keySelectedId) return;
    const el = scrollContainerRef.current?.querySelector(
      `[data-sidebar-id="${CSS.escape(keySelectedId)}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [keySelectedId]);

  // Stable refs for the keyboard handler
  const flatItemsRef = useRef(flatItems);
  const keySelectedIdRef = useRef(keySelectedId);
  const onSelectRef = useRef(onSelect);
  const toggleSpaceRef = useRef(toggleSpace);
  const toggleFolderRef = useRef(toggleFolder);
  const pinnedViewIdsRef = useRef(pinnedViewIds);
  const unpinViewRef = useRef(unpinView);
  const pinViewRef = useRef(pinView);
  const focusContainerRefRef = useRef(focusContainerRef);
  useEffect(() => {
    flatItemsRef.current = flatItems;
    keySelectedIdRef.current = keySelectedId;
    onSelectRef.current = onSelect;
    toggleSpaceRef.current = toggleSpace;
    toggleFolderRef.current = toggleFolder;
    pinnedViewIdsRef.current = pinnedViewIds;
    unpinViewRef.current = unpinView;
    pinViewRef.current = pinView;
    focusContainerRefRef.current = focusContainerRef;
  });

  useEffect(() => {
    function handleSidebarKeyboard(e: KeyboardEvent) {
      // Only handle when the sidebar focus container owns focus
      const container = focusContainerRefRef.current?.current;
      if (container) {
        const active = document.activeElement;
        if (!container.contains(active)) return;
      }

      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && isEditorElement(e.target))
      ) {
        return;
      }

      const flat = flatItemsRef.current;
      if (flat.length === 0) return;

      const currentIdx = flat.findIndex(
        (item) => item.id === keySelectedIdRef.current,
      );

      switch (e.key) {
        case "j":
        case "ArrowDown": {
          if (e.key === "j" && (e.ctrlKey || e.metaKey || e.altKey)) return;
          e.preventDefault();
          const nextIdx =
            currentIdx === -1 ? 0 : Math.min(currentIdx + 1, flat.length - 1);
          setKeySelectedId(flat[nextIdx].id);
          break;
        }
        case "k":
        case "ArrowUp": {
          if (e.key === "k" && (e.ctrlKey || e.metaKey || e.altKey)) return;
          e.preventDefault();
          const prevIdx = currentIdx === -1 ? 0 : Math.max(currentIdx - 1, 0);
          setKeySelectedId(flat[prevIdx].id);
          break;
        }
        case "Enter": {
          if (currentIdx === -1) break;
          e.preventDefault();
          const item = flat[currentIdx];
          switch (item.kind) {
            case "space":
              toggleSpaceRef.current(item.spaceId);
              break;
            case "folder":
              toggleFolderRef.current(item.folderId);
              break;
            case "pinned-view":
              onSelectRef.current({
                type: "view",
                view: item.view,
              });
              break;
            case "view":
              onSelectRef.current({
                type: "view",
                view: { id: item.view.id, name: item.view.name },
              });
              break;
            case "list":
              onSelectRef.current({
                type: "list",
                listId: item.listId,
                listName: item.listName,
              });
              break;
          }
          break;
        }
      }
    }

    window.addEventListener("keydown", handleSidebarKeyboard);
    return () => window.removeEventListener("keydown", handleSidebarKeyboard);
  }, []);

  return (
    <aside className="bg-sidebar flex h-full shrink-0 flex-col border-r">
      <div className="border-b p-2">
        <TaskSearch
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Search tasks..."
          searchInputRef={searchInputRef}
        />
      </div>

      <ScrollArea className="flex-1">
        <div ref={scrollContainerRef} className="space-y-4 py-2">
          {/* Pinned Views */}
          {pinnedViews.length > 0 && (
            <section>
              <div className="text-muted-foreground px-3 pb-1 text-xs font-semibold tracking-wide uppercase">
                Pinned Views
              </div>
              <div className="space-y-0.5 px-1">
                {pinnedViews.map((view) => (
                  <PinnedViewItem
                    key={view.id}
                    view={view}
                    isSelected={
                      selection?.type === "view" &&
                      selection.view.id === view.id
                    }
                    isKeySelected={keySelectedId === `pinned:${view.id}`}
                    sidebarId={`pinned:${view.id}`}
                    onSelect={() => onSelect({ type: "view", view })}
                    onUnpin={() => unpinView.mutate(view.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Browse */}
          <section>
            <div className="text-muted-foreground px-3 pb-1 text-xs font-semibold tracking-wide uppercase">
              Browse
            </div>

            {isLoadingHierarchy ? (
              <HierarchySkeleton />
            ) : !hierarchy ? null : (
              <div className="space-y-0.5 px-1">
                {hierarchy.spaces.map((space) => {
                  const isExpanded = expandedSpaces.has(space.id);
                  const spaceViews = hierarchy.views.filter(
                    (v) => v.parent?.id === space.id,
                  );

                  return (
                    <div key={space.id}>
                      <button
                        data-sidebar-id={`space:${space.id}`}
                        className={cn(
                          "hover:bg-muted/30 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                          keySelectedId === `space:${space.id}` &&
                            "ring-ring ring-1",
                        )}
                        onClick={() => toggleSpace(space.id)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                        ) : (
                          <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                        )}
                        {space.color && (
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: space.color }}
                          />
                        )}
                        <span className="truncate">{space.name}</span>
                      </button>

                      {isExpanded && (
                        <div className="mt-0.5 ml-4 space-y-0.5">
                          {/* Space-level views */}
                          {spaceViews.map((view) => (
                            <ViewBrowseItem
                              key={view.id}
                              view={view}
                              isPinned={pinnedViewIds.has(view.id)}
                              isSelected={
                                selection?.type === "view" &&
                                selection.view.id === view.id
                              }
                              isKeySelected={
                                keySelectedId === `view:${view.id}`
                              }
                              sidebarId={`view:${view.id}`}
                              onSelect={() =>
                                onSelect({
                                  type: "view",
                                  view: { id: view.id, name: view.name },
                                })
                              }
                              onPin={() => {
                                if (pinnedViewIds.has(view.id)) {
                                  unpinView.mutate(view.id);
                                } else {
                                  pinView.mutate({
                                    id: view.id,
                                    name: view.name,
                                  });
                                }
                              }}
                            />
                          ))}

                          {/* Folders */}
                          {space.folders.map((folder) => (
                            <FolderItem
                              key={folder.id}
                              folder={folder}
                              isOpen={expandedFolders.has(folder.id)}
                              isKeySelected={
                                keySelectedId === `folder:${folder.id}`
                              }
                              sidebarId={`folder:${folder.id}`}
                              keySelectedId={keySelectedId}
                              onToggle={() => toggleFolder(folder.id)}
                              selection={selection}
                              onSelect={onSelect}
                            />
                          ))}

                          {/* Folderless lists */}
                          {space.lists.map((list) => (
                            <ListBrowseItem
                              key={list.id}
                              list={list}
                              isSelected={
                                selection?.type === "list" &&
                                selection.listId === list.id
                              }
                              isKeySelected={
                                keySelectedId === `list:${list.id}`
                              }
                              sidebarId={`list:${list.id}`}
                              onSelect={() =>
                                onSelect({
                                  type: "list",
                                  listId: list.id,
                                  listName: list.name,
                                })
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Workspace-level views (no specific space parent) */}
                {hierarchy.views
                  .filter(
                    (v) =>
                      !v.parent?.id ||
                      !hierarchy.spaces.some((s) => s.id === v.parent?.id),
                  )
                  .map((view) => (
                    <ViewBrowseItem
                      key={view.id}
                      view={view}
                      isPinned={pinnedViewIds.has(view.id)}
                      isSelected={
                        selection?.type === "view" &&
                        selection.view.id === view.id
                      }
                      isKeySelected={keySelectedId === `view:${view.id}`}
                      sidebarId={`view:${view.id}`}
                      onSelect={() =>
                        onSelect({
                          type: "view",
                          view: { id: view.id, name: view.name },
                        })
                      }
                      onPin={() => {
                        if (pinnedViewIds.has(view.id)) {
                          unpinView.mutate(view.id);
                        } else {
                          pinView.mutate({ id: view.id, name: view.name });
                        }
                      }}
                    />
                  ))}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>

      {(pinView.isPending || unpinView.isPending) && (
        <div className="text-muted-foreground flex items-center gap-2 border-t p-2 text-xs">
          <Loader2 className="size-3 animate-spin" />
          Saving...
        </div>
      )}
    </aside>
  );
}
