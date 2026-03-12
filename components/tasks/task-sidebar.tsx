"use client"

import { useState } from "react"
import { Star, ChevronRight, ChevronDown, List, Folder, Layout, Loader2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { TaskSearch } from "@/components/tasks/task-search"
import { useClickUpHierarchy, useClickUpPinnedViews, usePinView, useUnpinView } from "@/hooks/use-clickup"
import { useClickUpSettings } from "@/hooks/use-settings"
import type { ClickUpView, ClickUpFolder, ClickUpList, ClickUpPinnedView } from "@/types"

type SidebarSelection =
  | { type: "search"; query: string }
  | { type: "view"; view: ClickUpPinnedView }
  | { type: "list"; listId: string; listName: string }

interface TaskSidebarProps {
  selection: SidebarSelection | null
  onSelect: (selection: SidebarSelection) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  style?: React.CSSProperties
}

function PinnedViewItem({
  view,
  isSelected,
  onSelect,
  onUnpin,
}: {
  view: ClickUpPinnedView
  isSelected: boolean
  onSelect: () => void
  onUnpin: () => void
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer group transition-colors ${
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
      }`}
      onClick={onSelect}
    >
      <Layout className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm truncate">{view.name}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onUnpin() }}
        className="size-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground text-yellow-500"
        title="Unpin view"
      >
        <Star className="size-3 fill-current" />
      </button>
    </div>
  )
}

function ViewBrowseItem({
  view,
  isPinned,
  isSelected,
  onSelect,
  onPin,
}: {
  view: ClickUpView
  isPinned: boolean
  isSelected: boolean
  onSelect: () => void
  onPin: () => void
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer group transition-colors ${
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
      }`}
      onClick={onSelect}
    >
      <Layout className="size-3 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-xs truncate">{view.name}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onPin() }}
        className={`size-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity ${
          isPinned ? "text-yellow-500" : "text-muted-foreground hover:text-yellow-500"
        }`}
        title={isPinned ? "Pinned" : "Pin view"}
      >
        <Star className={`size-3 ${isPinned ? "fill-current" : ""}`} />
      </button>
    </div>
  )
}

function ListBrowseItem({
  list,
  isSelected,
  onSelect,
}: {
  list: ClickUpList
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
      }`}
      onClick={onSelect}
    >
      <List className="size-3 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-xs truncate">{list.name}</span>
      {list.task_count != null && (
        <span className="text-xs text-muted-foreground tabular-nums">{list.task_count}</span>
      )}
    </div>
  )
}

function FolderItem({
  folder,
  selection,
  onSelect,
}: {
  folder: ClickUpFolder
  selection: SidebarSelection | null
  onSelect: (selection: SidebarSelection) => void
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {isOpen ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
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
              onSelect={() => onSelect({ type: "list", listId: list.id, listName: list.name })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function HierarchySkeleton() {
  return (
    <div className="space-y-1.5 px-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  )
}

export function TaskSidebar({ selection, onSelect, searchQuery, onSearchChange, style }: TaskSidebarProps) {
  const { isConfigured } = useClickUpSettings()
  const { pinnedViews } = useClickUpPinnedViews()
  const { data: hierarchy, isLoading: isLoadingHierarchy } = useClickUpHierarchy({ enabled: isConfigured })
  const pinView = usePinView()
  const unpinView = useUnpinView()

  const [expandedSpaces, setExpandedSpaces] = useState<Set<string>>(new Set())

  function toggleSpace(spaceId: string) {
    setExpandedSpaces((prev) => {
      const next = new Set(prev)
      if (next.has(spaceId)) next.delete(spaceId)
      else next.add(spaceId)
      return next
    })
  }

  function handleSearchChange(query: string) {
    onSearchChange(query)
    if (query.length >= 2) {
      onSelect({ type: "search", query })
    }
  }

  const pinnedViewIds = new Set(pinnedViews.map((v) => v.id))

  return (
    <aside className="flex flex-col h-full border-r shrink-0 bg-sidebar" style={style}>
      <div className="p-2 border-b">
        <TaskSearch
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Search tasks..."
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="py-2 space-y-4">
          {/* Pinned Views */}
          {pinnedViews.length > 0 && (
            <section>
              <div className="px-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Pinned Views
              </div>
              <div className="px-1 space-y-0.5">
                {pinnedViews.map((view) => (
                  <PinnedViewItem
                    key={view.id}
                    view={view}
                    isSelected={selection?.type === "view" && selection.view.id === view.id}
                    onSelect={() => onSelect({ type: "view", view })}
                    onUnpin={() => unpinView.mutate(view.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Browse */}
          <section>
            <div className="px-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Browse
            </div>

            {isLoadingHierarchy ? (
              <HierarchySkeleton />
            ) : !hierarchy ? null : (
              <div className="px-1 space-y-0.5">
                {hierarchy.spaces.map((space) => {
                  const isExpanded = expandedSpaces.has(space.id)
                  const spaceViews = hierarchy.views.filter(
                    (v) => v.parent?.id === space.id
                  )

                  return (
                    <div key={space.id}>
                      <button
                        className="flex w-full items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium hover:bg-muted/30 transition-colors"
                        onClick={() => toggleSpace(space.id)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        {space.color && (
                          <span
                            className="size-2 rounded-full shrink-0"
                            style={{ backgroundColor: space.color }}
                          />
                        )}
                        <span className="truncate">{space.name}</span>
                      </button>

                      {isExpanded && (
                        <div className="ml-4 space-y-0.5 mt-0.5">
                          {/* Space-level views */}
                          {spaceViews.map((view) => (
                            <ViewBrowseItem
                              key={view.id}
                              view={view}
                              isPinned={pinnedViewIds.has(view.id)}
                              isSelected={selection?.type === "view" && selection.view.id === view.id}
                              onSelect={() => onSelect({ type: "view", view: { id: view.id, name: view.name } })}
                              onPin={() => {
                                if (pinnedViewIds.has(view.id)) {
                                  unpinView.mutate(view.id)
                                } else {
                                  pinView.mutate({ id: view.id, name: view.name })
                                }
                              }}
                            />
                          ))}

                          {/* Folders */}
                          {space.folders.map((folder) => (
                            <FolderItem
                              key={folder.id}
                              folder={folder}
                              selection={selection}
                              onSelect={onSelect}
                            />
                          ))}

                          {/* Folderless lists */}
                          {space.lists.map((list) => (
                            <ListBrowseItem
                              key={list.id}
                              list={list}
                              isSelected={selection?.type === "list" && selection.listId === list.id}
                              onSelect={() => onSelect({ type: "list", listId: list.id, listName: list.name })}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Workspace-level views (no specific space parent) */}
                {hierarchy.views
                  .filter((v) => !v.parent?.id || !hierarchy.spaces.some((s) => s.id === v.parent?.id))
                  .map((view) => (
                    <ViewBrowseItem
                      key={view.id}
                      view={view}
                      isPinned={pinnedViewIds.has(view.id)}
                      isSelected={selection?.type === "view" && selection.view.id === view.id}
                      onSelect={() => onSelect({ type: "view", view: { id: view.id, name: view.name } })}
                      onPin={() => {
                        if (pinnedViewIds.has(view.id)) {
                          unpinView.mutate(view.id)
                        } else {
                          pinView.mutate({ id: view.id, name: view.name })
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
        <div className="p-2 border-t flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Saving...
        </div>
      )}
    </aside>
  )
}
