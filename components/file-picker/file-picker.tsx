"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  createContext,
  useContext,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { fuzzySearch, type FuzzyMatch } from "@/lib/fuzzy-match";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { File, Folder, Search, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Context – lets any component open/close the global file picker
// ---------------------------------------------------------------------------

interface FilePickerContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const FilePickerContext = createContext<FilePickerContextValue | null>(null);

export function useFilePicker() {
  const ctx = useContext(FilePickerContext);
  if (!ctx)
    throw new Error("useFilePicker must be used within FilePickerProvider");
  return ctx;
}

export function FilePickerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  return (
    <FilePickerContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </FilePickerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook to fetch all workspace files (cached via TanStack Query)
// ---------------------------------------------------------------------------

export function useWorkspaceFiles(workspaceId: string | null) {
  return useQuery<string[]>({
    queryKey: ["workspace-files", workspaceId],
    queryFn: async () => {
      const res = await fetch(`/api/files/search?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error("Failed to fetch file list");
      const data = await res.json();
      return data.files as string[];
    },
    enabled: !!workspaceId,
    staleTime: 60 * 1000, // cache for 1 minute
  });
}

// ---------------------------------------------------------------------------
// Highlighted path renderer
// ---------------------------------------------------------------------------

function HighlightedPath({
  path,
  positions,
}: {
  path: string;
  positions: Set<number>;
}) {
  if (positions.size === 0) {
    return <span className="truncate">{path}</span>;
  }

  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < path.length) {
    if (positions.has(i)) {
      // Find consecutive highlighted characters
      let end = i;
      while (end < path.length && positions.has(end)) end++;
      parts.push(
        <span key={i} className="text-primary font-semibold">
          {path.slice(i, end)}
        </span>,
      );
      i = end;
    } else {
      // Find consecutive non-highlighted characters
      let end = i;
      while (end < path.length && !positions.has(end)) end++;
      parts.push(<span key={i}>{path.slice(i, end)}</span>);
      i = end;
    }
  }

  return <span className="truncate">{parts}</span>;
}

// ---------------------------------------------------------------------------
// Skeleton rows shown during file list loading
// ---------------------------------------------------------------------------

function FilePickerSkeleton() {
  return (
    <div className="space-y-1 p-1">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5">
          <Skeleton className="size-3.5 shrink-0 rounded" />
          <Skeleton
            className="h-3.5 rounded"
            style={{ width: `${55 + (i % 3) * 15}%` }}
          />
          <Skeleton
            className="ml-auto h-3 rounded"
            style={{ width: `${20 + (i % 2) * 10}%` }}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File Picker Dialog (global overlay)
// ---------------------------------------------------------------------------

export function FilePickerDialog() {
  const { isOpen, close } = useFilePicker();
  const router = useRouter();
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);

  // Local workspace state — only mutates global store when a file is selected
  const [pickerWorkspaceId, setPickerWorkspaceId] = useState<string | null>(
    activeWorkspaceId,
  );

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: files, isLoading } = useWorkspaceFiles(pickerWorkspaceId);

  const results = useMemo(() => {
    if (!files) return [];
    return fuzzySearch(query, files, 100);
  }, [query, files]);

  // Reset state when dialog opens (during-render pattern)
  const [prevIsOpen, setPrevIsOpen] = useState(false);
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
    setPickerWorkspaceId(activeWorkspaceId);
    setQuery("");
    setSelectedIndex(0);
  } else if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // Clamp selectedIndex when results change (during render)
  if (selectedIndex >= results.length && results.length > 0) {
    setSelectedIndex(Math.max(0, results.length - 1));
  }

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`);
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (match: FuzzyMatch) => {
      // Switch global workspace only when actually opening a file
      if (pickerWorkspaceId && pickerWorkspaceId !== activeWorkspaceId) {
        setActiveWorkspaceId(pickerWorkspaceId);
      }
      close();
      router.push(`/files?open=${encodeURIComponent(match.path)}`);
    },
    [close, router, pickerWorkspaceId, activeWorkspaceId, setActiveWorkspaceId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
        case "j":
          if (e.ctrlKey || e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          }
          break;
        case "ArrowUp":
        case "k":
          if (e.ctrlKey || e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((i) => Math.max(i - 1, 0));
          }
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          close();
          break;
        case "Tab":
          // Cycle through workspaces locally — no global state mutation
          if (workspaces.length > 1) {
            e.preventDefault();
            const currentIdx = workspaces.findIndex(
              (w) => w.id === pickerWorkspaceId,
            );
            const nextIdx = e.shiftKey
              ? (currentIdx - 1 + workspaces.length) % workspaces.length
              : (currentIdx + 1) % workspaces.length;
            setPickerWorkspaceId(workspaces[nextIdx].id);
            setQuery("");
            setSelectedIndex(0);
          }
          break;
      }
    },
    [
      results,
      selectedIndex,
      handleSelect,
      close,
      workspaces,
      pickerWorkspaceId,
    ],
  );

  const pickerWorkspace = useMemo(
    () => workspaces.find((w) => w.id === pickerWorkspaceId),
    [workspaces, pickerWorkspaceId],
  );

  const showSkeleton = isLoading || !files;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0"
        showCloseButton={false}
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Find file</DialogTitle>
          <DialogDescription>
            Fuzzy search across all workspace files
          </DialogDescription>
        </DialogHeader>

        {/* Search input */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Find file..."
            className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {isLoading && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )}
        </div>

        {/* Workspace indicator + switcher hint */}
        {pickerWorkspace && (
          <div className="bg-muted/30 flex items-center gap-2 border-b px-3 py-1.5">
            <Folder className="text-muted-foreground size-3" />
            <span className="text-muted-foreground truncate text-[11px]">
              {pickerWorkspace.name}
            </span>
            {workspaces.length > 1 && (
              <span className="text-muted-foreground/60 ml-auto text-[10px]">
                Tab to switch
              </span>
            )}
          </div>
        )}

        {/* Results — fixed min-height prevents dialog from jumping during loading */}
        <ScrollArea className="h-[min(400px,60vh)]">
          {showSkeleton ? (
            <FilePickerSkeleton />
          ) : (
            <div ref={listRef} className="p-1">
              {results.length === 0 && (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {query ? "No files match" : "Type to search..."}
                </p>
              )}
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
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50",
                    )}
                    onClick={() => handleSelect(match)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <File className="text-muted-foreground size-3.5 shrink-0" />
                    <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                      <span className="truncate font-mono text-xs">
                        <HighlightedPath
                          path={basename}
                          positions={basenamePositions(match)}
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
            </div>
          )}
        </ScrollArea>

        {/* Footer hints */}
        <div className="text-muted-foreground/60 flex items-center gap-3 border-t px-3 py-1.5 text-[10px]">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          {workspaces.length > 1 && <span>tab switch workspace</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Remap positions from the full path into basename-relative positions
 */
function basenamePositions(match: FuzzyMatch): Set<number> {
  const lastSlash = match.path.lastIndexOf("/");
  if (lastSlash === -1) return match.positions;

  const offset = lastSlash + 1;
  const result = new Set<number>();
  for (const pos of match.positions) {
    if (pos >= offset) {
      result.add(pos - offset);
    }
  }
  return result;
}
