"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useEditorStore } from "@/stores/editor-store"
import { useWorkspaceFiles } from "@/components/file-picker/file-picker"
import { useFileTabsSetting } from "@/hooks/use-settings"
import { fuzzySearch, type FuzzyMatch } from "@/lib/fuzzy-match"
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
  committed: "text-cyan-500",
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

// ---------------------------------------------------------------------------
// Highlighted path for fzf search results
// ---------------------------------------------------------------------------

function HighlightedPath({ path, positions }: { path: string; positions: Set<number> }) {
  if (positions.size === 0) {
    return <span className="truncate">{path}</span>
  }

  const parts: React.ReactNode[] = []
  let i = 0
  while (i < path.length) {
    if (positions.has(i)) {
      let end = i
      while (end < path.length && positions.has(end)) end++
      parts.push(
        <span key={i} className="text-primary font-semibold">
          {path.slice(i, end)}
        </span>
      )
      i = end
    } else {
      let end = i
      while (end < path.length && !positions.has(end)) end++
      parts.push(<span key={i}>{path.slice(i, end)}</span>)
      i = end
    }
  }

  return <span className="truncate">{parts}</span>
}

// ---------------------------------------------------------------------------
// Flat fzf search result list (replaces tree when searching)
// ---------------------------------------------------------------------------

function basenamePositions(match: FuzzyMatch): Set<number> {
  const lastSlash = match.path.lastIndexOf("/")
  if (lastSlash === -1) return match.positions

  const offset = lastSlash + 1
  const result = new Set<number>()
  for (const pos of match.positions) {
    if (pos >= offset) {
      result.add(pos - offset)
    }
  }
  return result
}

interface FuzzyResultListProps {
  results: FuzzyMatch[]
  selectedIndex: number
  onSelect: (path: string) => void
  onHover: (index: number) => void
}

function FuzzyResultList({ results, selectedIndex, onSelect, onHover }: FuzzyResultListProps) {
  if (results.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        No files match
      </p>
    )
  }

  return (
    <>
      {results.map((match, index) => {
        const isSelected = index === selectedIndex
        const basename = match.path.split("/").pop() ?? match.path
        const dirname = match.path.includes("/")
          ? match.path.slice(0, match.path.lastIndexOf("/"))
          : ""

        return (
          <button
            key={match.path}
            data-index={index}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-sm",
              isSelected
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50"
            )}
            onClick={() => onSelect(match.path)}
            onMouseEnter={() => onHover(index)}
          >
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="shrink-0 font-mono text-xs">
                <HighlightedPath path={basename} positions={basenamePositions(match)} />
              </span>
              {dirname && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {dirname}
                </span>
              )}
            </div>
          </button>
        )
      })}
    </>
  )
}

export function FileTree({ searchInputRef }: { searchInputRef?: React.RefObject<HTMLInputElement | null> }) {
  const [searchQuery, setSearchQuery] = useState("")
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const openFile = useEditorStore((s) => s.openFile)
  const closeAllFiles = useEditorStore((s) => s.closeAllFiles)
  const toggleExpandedPath = useEditorStore((s) => s.toggleExpandedPath)
  const expandPathToFile = useEditorStore((s) => s.expandPathToFile)
  const workspaceFileStates = useEditorStore((s) => s.workspaceFileStates)

  const { isFileTabsDisabled } = useFileTabsSetting()

  const expandedPaths = useMemo(() => {
    if (!activeWorkspaceId) return new Set<string>()
    const ws = workspaceFileStates[activeWorkspaceId]
    return new Set(ws?.expandedPaths ?? [])
  }, [activeWorkspaceId, workspaceFileStates])

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
      if (activeWorkspaceId) {
        toggleExpandedPath(activeWorkspaceId, dirPath)
      }

      if (!lazyEntries.has(dirPath)) {
        const children = await fetchChildren(dirPath)
        setLazyEntries((prev) => new Map(prev).set(dirPath, children))
      }
    },
    [activeWorkspaceId, toggleExpandedPath, fetchChildren, lazyEntries]
  )

  const fetchingRef = useRef(new Set<string>())

  useEffect(() => {
    if (!activeWorkspaceId) return
    const missing: string[] = []
    for (const p of expandedPaths) {
      if (!lazyEntries.has(p) && !fetchingRef.current.has(p)) {
        missing.push(p)
      }
    }
    if (missing.length === 0) return

    for (const p of missing) fetchingRef.current.add(p)

    Promise.all(
      missing.map((dirPath) =>
        fetchChildren(dirPath).then((children) => [dirPath, children] as const)
      )
    ).then((results) => {
      setLazyEntries((prev) => {
        const next = new Map(prev)
        for (const [dirPath, children] of results) {
          next.set(dirPath, children)
          fetchingRef.current.delete(dirPath)
        }
        return next
      })
    })
  }, [activeWorkspaceId, expandedPaths, lazyEntries, fetchChildren])

  const onFileClick = useCallback(
    async (entry: FileTreeEntry) => {
      if (activeWorkspaceId) {
        expandPathToFile(activeWorkspaceId, entry.path)
      }

      const response = await fetch(
        `/api/files/content?workspaceId=${activeWorkspaceId}&path=${encodeURIComponent(entry.path)}`
      )

      if (!response.ok) {
        return
      }

      const data = await response.json()

      if (isFileTabsDisabled) closeAllFiles()
      openFile({
        path: entry.path,
        name: entry.name,
        content: data.content,
        language: data.language,
        isDirty: false,
        originalContent: data.content,
      })
    },
    [activeWorkspaceId, openFile, closeAllFiles, isFileTabsDisabled, expandPathToFile]
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

  // Fzf-powered search across ALL workspace files
  const { data: allFiles } = useWorkspaceFiles(activeWorkspaceId)
  const isSearching = searchQuery.length > 0

  const searchResults = useMemo(() => {
    if (!isSearching || !allFiles) return []
    return fuzzySearch(searchQuery, allFiles, 100)
  }, [searchQuery, allFiles, isSearching])

  // Keyboard navigation state for search results
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchListRef = useRef<HTMLDivElement>(null)

  // Reset selectedIndex when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery])

  // Clamp selectedIndex when results change
  useEffect(() => {
    if (selectedIndex >= searchResults.length) {
      setSelectedIndex(Math.max(0, searchResults.length - 1))
    }
  }, [searchResults.length, selectedIndex])

  // Scroll selected search result into view
  useEffect(() => {
    if (!isSearching) return
    const list = searchListRef.current
    if (!list) return
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`)
    if (selected) {
      selected.scrollIntoView({ block: "nearest" })
    }
  }, [selectedIndex, isSearching])

  // Open a file by path (used by fzf search results)
  const onSearchResultClick = useCallback(
    async (filePath: string) => {
      const name = filePath.split("/").pop() ?? filePath

      if (activeWorkspaceId) {
        expandPathToFile(activeWorkspaceId, filePath)
      }

      const response = await fetch(
        `/api/files/content?workspaceId=${activeWorkspaceId}&path=${encodeURIComponent(filePath)}`
      )
      if (!response.ok) return

      const data = await response.json()
      if (isFileTabsDisabled) closeAllFiles()
      openFile({
        path: filePath,
        name,
        content: data.content,
        language: data.language,
        isDirty: false,
        originalContent: data.content,
      })
    },
    [activeWorkspaceId, openFile, closeAllFiles, isFileTabsDisabled, expandPathToFile]
  )

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isSearching) return

      const isDown = e.key === "ArrowDown" || (e.ctrlKey && e.key === "j")
      const isUp = e.key === "ArrowUp" || (e.ctrlKey && e.key === "k")

      if (isDown) {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, searchResults.length - 1))
      } else if (isUp) {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (searchResults[selectedIndex]) {
          onSearchResultClick(searchResults[selectedIndex].path)
        }
      }
    },
    [isSearching, searchResults, selectedIndex, onSearchResultClick]
  )

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
            ref={searchInputRef}
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1">
          {isSearching ? (
            <div ref={searchListRef}>
              <FuzzyResultList
                results={searchResults}
                selectedIndex={selectedIndex}
                onSelect={onSearchResultClick}
                onHover={setSelectedIndex}
              />
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : mergedEntries.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              Empty directory
            </p>
          ) : (
            mergedEntries.map((entry) => (
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
