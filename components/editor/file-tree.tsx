"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceFiles } from "@/components/file-picker/file-picker";
import {
  fuzzySearch,
  basenamePositions,
  type FuzzyMatch,
} from "@/lib/fuzzy-match";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn, isEditorElement } from "@/lib/utils";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Search,
} from "lucide-react";
import type { FileTreeEntry, FileGitStatus } from "@/types";

const GIT_STATUS_COLORS: Record<FileGitStatus, string> = {
  modified: "text-yellow-500",
  staged: "text-green-500",
  untracked: "text-zinc-400",
  deleted: "text-red-500",
  renamed: "text-blue-500",
  conflicted: "text-red-600",
  added: "text-green-400",
  committed: "text-cyan-500",
};

interface FileTreeNodeProps {
  entry: FileTreeEntry;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  activeFilePath: string | null;
  onToggleExpand: (path: string) => void;
  onFileClick: (entry: FileTreeEntry) => void;
}

function FileTreeNode({
  entry,
  depth,
  expandedPaths,
  selectedPath,
  activeFilePath,
  onToggleExpand,
  onFileClick,
}: FileTreeNodeProps) {
  const isExpanded = expandedPaths.has(entry.path);
  const isActive = entry.type === "file" && entry.path === activeFilePath;
  const isSelected = entry.path === selectedPath;
  const gitColorClass = entry.gitStatus
    ? GIT_STATUS_COLORS[entry.gitStatus]
    : undefined;

  const handleClick = () => {
    if (entry.type === "directory") {
      onToggleExpand(entry.path);
    } else {
      onFileClick(entry);
    }
  };

  return (
    <>
      <button
        data-tree-path={entry.path}
        className={cn(
          "hover:bg-accent flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-sm",
          isActive && "bg-accent text-accent-foreground",
          isSelected && !isActive && "ring-ring ring-1",
          isSelected && isActive && "ring-ring ring-1",
          gitColorClass,
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={handleClick}
      >
        {entry.type === "directory" ? (
          <>
            {isExpanded ? (
              <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
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
            <File className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
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
              selectedPath={selectedPath}
              activeFilePath={activeFilePath}
              onToggleExpand={onToggleExpand}
              onFileClick={onFileClick}
            />
          ))}
        </>
      )}
    </>
  );
}

function flattenVisibleEntries(
  entries: FileTreeEntry[],
  expandedPaths: Set<string>,
): FileTreeEntry[] {
  const result: FileTreeEntry[] = [];
  for (const entry of entries) {
    result.push(entry);
    if (
      entry.type === "directory" &&
      expandedPaths.has(entry.path) &&
      entry.children
    ) {
      result.push(...flattenVisibleEntries(entry.children, expandedPaths));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Highlighted path for fzf search results
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Flat fzf search result list (replaces tree when searching)
// ---------------------------------------------------------------------------

interface FuzzyResultListProps {
  results: FuzzyMatch[];
  selectedIndex: number;
  onSelect: (path: string) => void;
  onHover: (index: number) => void;
}

function FuzzyResultList({
  results,
  selectedIndex,
  onSelect,
  onHover,
}: FuzzyResultListProps) {
  if (results.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-center text-xs">
        No files match
      </p>
    );
  }

  return (
    <>
      {results.map((match, index) => {
        const isSelected = index === selectedIndex;
        const basename = match.path.split("/").pop() ?? match.path;
        const dirname = match.path.includes("/")
          ? match.path.slice(0, match.path.lastIndexOf("/"))
          : "";

        return (
          <button
            key={match.path}
            data-index={index}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-sm",
              isSelected
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50",
            )}
            onClick={() => onSelect(match.path)}
            onMouseEnter={() => onHover(index)}
          >
            <File className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="shrink-0 font-mono text-xs">
                <HighlightedText
                  text={basename}
                  positions={basenamePositions(match.path, match.positions)}
                />
              </span>
              {dirname && (
                <span className="text-muted-foreground truncate text-[11px]">
                  {dirname}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </>
  );
}

export interface FileTreeProps {
  workspaceId: string | null;
  expandedPaths: Set<string>;
  activeFilePath: string | null;
  onToggleExpand: (path: string) => void;
  onExpandPathToFile: (path: string) => void;
  onFileClick: (entry: FileTreeEntry) => void;
  onSearchResultClick: (filePath: string) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

export function FileTree({
  searchInputRef,
  workspaceId,
  expandedPaths,
  activeFilePath,
  onToggleExpand: onToggleExpandProp,
  onExpandPathToFile,
  onFileClick: onFileClickProp,
  onSearchResultClick: onSearchResultClickProp,
}: FileTreeProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: rootEntries, isLoading } = useQuery<FileTreeEntry[]>({
    queryKey: ["file-tree", workspaceId, "root"],
    queryFn: async () => {
      const response = await fetch(
        `/api/files/tree?workspaceId=${workspaceId}&path=.&depth=1`,
      );
      if (!response.ok) throw new Error("Failed to load file tree");
      return response.json();
    },
    enabled: !!workspaceId,
  });

  const fetchChildren = useCallback(
    async (dirPath: string): Promise<FileTreeEntry[]> => {
      const response = await fetch(
        `/api/files/tree?workspaceId=${workspaceId}&path=${encodeURIComponent(dirPath)}&depth=1`,
      );
      if (!response.ok) throw new Error("Failed to load directory");
      return response.json();
    },
    [workspaceId],
  );

  const [lazyEntries, setLazyEntries] = useState<Map<string, FileTreeEntry[]>>(
    new Map(),
  );

  const onToggleExpand = useCallback(
    async (dirPath: string) => {
      onToggleExpandProp(dirPath);

      if (!lazyEntries.has(dirPath)) {
        const children = await fetchChildren(dirPath);
        setLazyEntries((prev) => new Map(prev).set(dirPath, children));
      }
    },
    [onToggleExpandProp, fetchChildren, lazyEntries],
  );

  const fetchingRef = useRef(new Set<string>());

  useEffect(() => {
    if (!workspaceId) return;
    const missing: string[] = [];
    for (const p of expandedPaths) {
      if (!lazyEntries.has(p) && !fetchingRef.current.has(p)) {
        missing.push(p);
      }
    }
    if (missing.length === 0) return;

    for (const p of missing) fetchingRef.current.add(p);

    Promise.all(
      missing.map((dirPath) =>
        fetchChildren(dirPath).then((children) => [dirPath, children] as const),
      ),
    ).then((results) => {
      setLazyEntries((prev) => {
        const next = new Map(prev);
        for (const [dirPath, children] of results) {
          next.set(dirPath, children);
          fetchingRef.current.delete(dirPath);
        }
        return next;
      });
    });
  }, [workspaceId, expandedPaths, lazyEntries, fetchChildren]);

  const onFileClick = useCallback(
    (entry: FileTreeEntry) => {
      onFileClickProp(entry);
      onExpandPathToFile(entry.path);
    },
    [onFileClickProp, onExpandPathToFile],
  );

  // Merge lazy-loaded children into root entries
  const mergedEntries = useMemo(() => {
    if (!rootEntries) return [];

    function mergeChildren(entries: FileTreeEntry[]): FileTreeEntry[] {
      return entries.map((entry) => {
        if (entry.type !== "directory") return entry;

        const loadedChildren = lazyEntries.get(entry.path);
        const children = loadedChildren
          ? mergeChildren(loadedChildren)
          : entry.children
            ? mergeChildren(entry.children)
            : undefined;

        return { ...entry, children };
      });
    }

    return mergeChildren(rootEntries);
  }, [rootEntries, lazyEntries]);

  // Fzf-powered search across ALL workspace files
  const { data: allFiles } = useWorkspaceFiles(workspaceId);
  const isSearching = searchQuery.length > 0;

  // Flat list of visible tree entries for j/k keyboard navigation
  const flatVisible = useMemo(
    () => flattenVisibleEntries(mergedEntries, expandedPaths),
    [mergedEntries, expandedPaths],
  );

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const treeListRef = useRef<HTMLDivElement>(null);

  // Clamp selectedPath when the visible list changes
  const clampedSelectedPath =
    selectedPath !== null && !flatVisible.some((e) => e.path === selectedPath)
      ? (flatVisible[0]?.path ?? null)
      : selectedPath;
  if (clampedSelectedPath !== selectedPath) {
    setSelectedPath(clampedSelectedPath);
  }

  // Scroll active file into view when activeFilePath changes (e.g. tab click)
  useEffect(() => {
    if (!activeFilePath || isSearching) return;
    // Use requestAnimationFrame to allow the DOM to update after expanding dirs
    requestAnimationFrame(() => {
      const el = treeListRef.current?.querySelector(
        `[data-tree-path="${CSS.escape(activeFilePath)}"]`,
      );
      if (el) el.scrollIntoView({ block: "nearest" });
    });
  }, [activeFilePath, isSearching]);

  // Scroll keyboard-selected tree entry into view
  useEffect(() => {
    if (!selectedPath || isSearching) return;
    const el = treeListRef.current?.querySelector(
      `[data-tree-path="${CSS.escape(selectedPath)}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedPath, isSearching]);

  // Stable refs for keyboard handler — avoids re-registering on every j/k navigation
  const flatVisibleRef = useRef(flatVisible);
  const selectedPathRef = useRef(selectedPath);
  const isSearchingRef = useRef(isSearching);
  const onToggleExpandRef = useRef(onToggleExpand);
  const onFileClickRef = useRef(onFileClick);
  useEffect(() => {
    flatVisibleRef.current = flatVisible;
    selectedPathRef.current = selectedPath;
    isSearchingRef.current = isSearching;
    onToggleExpandRef.current = onToggleExpand;
    onFileClickRef.current = onFileClick;
  });

  // Keyboard navigation for tree entries (j/k/Enter)
  useEffect(() => {
    function handleTreeKeyboard(e: KeyboardEvent) {
      if (isSearchingRef.current) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && isEditorElement(e.target))
      ) {
        return;
      }

      const flatVisible = flatVisibleRef.current;
      if (flatVisible.length === 0) return;

      const currentIdx = flatVisible.findIndex(
        (entry) => entry.path === selectedPathRef.current,
      );

      switch (e.key) {
        case "j": {
          e.preventDefault();
          const nextIdx =
            currentIdx === -1
              ? 0
              : Math.min(currentIdx + 1, flatVisible.length - 1);
          setSelectedPath(flatVisible[nextIdx].path);
          break;
        }
        case "k": {
          e.preventDefault();
          const prevIdx = currentIdx === -1 ? 0 : Math.max(currentIdx - 1, 0);
          setSelectedPath(flatVisible[prevIdx].path);
          break;
        }
        case "Enter": {
          if (currentIdx === -1) break;
          e.preventDefault();
          const entry = flatVisible[currentIdx];
          if (entry.type === "directory") {
            onToggleExpandRef.current(entry.path);
          } else {
            onFileClickRef.current(entry);
          }
          break;
        }
      }
    }

    window.addEventListener("keydown", handleTreeKeyboard);
    return () => window.removeEventListener("keydown", handleTreeKeyboard);
  }, []);

  const searchResults = useMemo(() => {
    if (!isSearching || !allFiles) return [];
    return fuzzySearch(searchQuery, allFiles, 100);
  }, [searchQuery, allFiles, isSearching]);

  // Keyboard navigation state for search results
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchListRef = useRef<HTMLDivElement>(null);

  // Reset selectedIndex when query changes and clamp to results length
  const [prevSearchQuery, setPrevSearchQuery] = useState(searchQuery);
  if (prevSearchQuery !== searchQuery) {
    setPrevSearchQuery(searchQuery);
    setSelectedIndex(0);
  } else if (
    selectedIndex >= searchResults.length &&
    searchResults.length > 0
  ) {
    setSelectedIndex(Math.max(0, searchResults.length - 1));
  }

  // Scroll selected search result into view
  useEffect(() => {
    if (!isSearching) return;
    const list = searchListRef.current;
    if (!list) return;
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`);
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, isSearching]);

  // Open a file by path (used by fzf search results)
  const onSearchResultClick = useCallback(
    (filePath: string) => {
      onSearchResultClickProp(filePath);
    },
    [onSearchResultClickProp],
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isSearching) return;

      const isDown = e.key === "ArrowDown" || (e.ctrlKey && e.key === "j");
      const isUp = e.key === "ArrowUp" || (e.ctrlKey && e.key === "k");

      if (isDown) {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, searchResults.length - 1));
      } else if (isUp) {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (searchResults[selectedIndex]) {
          onSearchResultClick(searchResults[selectedIndex].path);
        }
      }
    },
    [isSearching, searchResults, selectedIndex, onSearchResultClick],
  );

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-muted-foreground text-sm">Select a workspace</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
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
              <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
            </div>
          ) : mergedEntries.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-xs">
              Empty directory
            </p>
          ) : (
            <div ref={treeListRef}>
              {mergedEntries.map((entry) => (
                <FileTreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  expandedPaths={expandedPaths}
                  selectedPath={selectedPath}
                  activeFilePath={activeFilePath}
                  onToggleExpand={onToggleExpand}
                  onFileClick={onFileClick}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
