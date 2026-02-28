"use client"

import { useState, useCallback, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useEditorStore } from "@/stores/editor-store"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Search,
} from "lucide-react"
import type { FileTreeEntry, FileGitStatus } from "@/types"

const GIT_STATUS_COLORS: Record<FileGitStatus, string> = {
  modified: "text-yellow-500",
  staged: "text-green-500",
  untracked: "text-zinc-400",
  deleted: "text-red-500",
  renamed: "text-blue-500",
  conflicted: "text-red-600",
  added: "text-green-400",
}

interface FileTreeNodeProps {
  entry: FileTreeEntry
  depth: number
  expandedPaths: Set<string>
  onToggleExpand: (path: string) => void
  onFileClick: (entry: FileTreeEntry) => void
}

function FileTreeNode({
  entry,
  depth,
  expandedPaths,
  onToggleExpand,
  onFileClick,
}: FileTreeNodeProps) {
  const isExpanded = expandedPaths.has(entry.path)
  const activeFilePath = useEditorStore((s) => s.activeFilePath)
  const isActive = entry.type === "file" && entry.path === activeFilePath
  const gitColorClass = entry.gitStatus
    ? GIT_STATUS_COLORS[entry.gitStatus]
    : undefined

  const handleClick = () => {
    if (entry.type === "directory") {
      onToggleExpand(entry.path)
    } else {
      onFileClick(entry)
    }
  }

  return (
    <>
      <button
        className={cn(
          "flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-sm hover:bg-accent",
          isActive && "bg-accent text-accent-foreground",
          gitColorClass
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={handleClick}
      >
        {entry.type === "directory" ? (
          <>
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            {isExpanded ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-blue-400" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-blue-400" />
            )}
          </>
        ) : (
          <>
            <span className="h-3.5 w-3.5 shrink-0" />
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate">{entry.name}</span>
      </button>

      {entry.type === "directory" && isExpanded && entry.children && (
        <>
          {entry.children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onFileClick={onFileClick}
            />
          ))}
        </>
      )}
    </>
  )
}

function filterTree(
  entries: FileTreeEntry[],
  query: string
): FileTreeEntry[] {
  const lowerQuery = query.toLowerCase()
  const result: FileTreeEntry[] = []

  for (const entry of entries) {
    if (entry.type === "file") {
      if (entry.name.toLowerCase().includes(lowerQuery)) {
        result.push(entry)
      }
    } else {
      const filteredChildren = entry.children
        ? filterTree(entry.children, query)
        : []
      if (
        filteredChildren.length > 0 ||
        entry.name.toLowerCase().includes(lowerQuery)
      ) {
        result.push({
          ...entry,
          children: filteredChildren.length > 0 ? filteredChildren : entry.children,
        })
      }
    }
  }

  return result
}

export function FileTree() {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState("")
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const openFile = useEditorStore((s) => s.openFile)

  const { data: rootEntries, isLoading } = useQuery<FileTreeEntry[]>({
    queryKey: ["file-tree", activeWorkspaceId, "root"],
    queryFn: async () => {
      const response = await fetch(
        `/api/files/tree?workspaceId=${activeWorkspaceId}&path=.&depth=1`
      )
      if (!response.ok) throw new Error("Failed to load file tree")
      return response.json()
    },
    enabled: !!activeWorkspaceId,
  })

  const fetchChildren = useCallback(
    async (dirPath: string): Promise<FileTreeEntry[]> => {
      const response = await fetch(
        `/api/files/tree?workspaceId=${activeWorkspaceId}&path=${encodeURIComponent(dirPath)}&depth=1`
      )
      if (!response.ok) throw new Error("Failed to load directory")
      return response.json()
    },
    [activeWorkspaceId]
  )

  const [lazyEntries, setLazyEntries] = useState<
    Map<string, FileTreeEntry[]>
  >(new Map())

  const onToggleExpand = useCallback(
    async (dirPath: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(dirPath)) {
          next.delete(dirPath)
        } else {
          next.add(dirPath)
        }
        return next
      })

      if (!lazyEntries.has(dirPath)) {
        const children = await fetchChildren(dirPath)
        setLazyEntries((prev) => new Map(prev).set(dirPath, children))
      }
    },
    [fetchChildren, lazyEntries]
  )

  const onFileClick = useCallback(
    async (entry: FileTreeEntry) => {
      const response = await fetch(
        `/api/files/content?workspaceId=${activeWorkspaceId}&path=${encodeURIComponent(entry.path)}`
      )

      if (!response.ok) {
        return
      }

      const data = await response.json()

      openFile({
        path: entry.path,
        name: entry.name,
        content: data.content,
        language: data.language,
        isDirty: false,
        originalContent: data.content,
      })
    },
    [activeWorkspaceId, openFile]
  )

  // Merge lazy-loaded children into root entries
  const mergedEntries = useMemo(() => {
    if (!rootEntries) return []

    function mergeChildren(entries: FileTreeEntry[]): FileTreeEntry[] {
      return entries.map((entry) => {
        if (entry.type !== "directory") return entry

        const loadedChildren = lazyEntries.get(entry.path)
        const children = loadedChildren
          ? mergeChildren(loadedChildren)
          : entry.children
            ? mergeChildren(entry.children)
            : undefined

        return { ...entry, children }
      })
    }

    return mergeChildren(rootEntries)
  }, [rootEntries, lazyEntries])

  const displayedEntries = searchQuery
    ? filterTree(mergedEntries, searchQuery)
    : mergedEntries

  if (!activeWorkspaceId) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Select a workspace</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : displayedEntries.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {searchQuery ? "No files match" : "Empty directory"}
            </p>
          ) : (
            displayedEntries.map((entry) => (
              <FileTreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                expandedPaths={expandedPaths}
                onToggleExpand={onToggleExpand}
                onFileClick={onFileClick}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
