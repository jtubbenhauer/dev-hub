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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Check, Globe, Search } from "lucide-react";
import type { Workspace } from "@/types";

interface WorkspacePickerContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const WorkspacePickerContext =
  createContext<WorkspacePickerContextValue | null>(null);

export function useWorkspacePicker() {
  const ctx = useContext(WorkspacePickerContext);
  if (!ctx)
    throw new Error(
      "useWorkspacePicker must be used within WorkspacePickerProvider",
    );
  return ctx;
}

export function WorkspacePickerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <WorkspacePickerContext.Provider value={{ isOpen, open, close }}>
      {children}
    </WorkspacePickerContext.Provider>
  );
}

function HighlightedText({
  text,
  positions,
}: {
  text: string;
  positions: Set<number>;
}) {
  if (positions.size === 0) {
    return <>{text}</>;
  }

  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    if (positions.has(i)) {
      let end = i;
      while (end < text.length && positions.has(end)) end++;
      parts.push(
        <span key={i} className="text-primary font-semibold">
          {text.slice(i, end)}
        </span>,
      );
      i = end;
    } else {
      let end = i;
      while (end < text.length && !positions.has(end)) end++;
      parts.push(<span key={i}>{text.slice(i, end)}</span>);
      i = end;
    }
  }

  return <>{parts}</>;
}

export function WorkspacePickerDialog() {
  const { isOpen, close } = useWorkspacePicker();
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId } =
    useWorkspaceStore();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const workspaceNames = useMemo(
    () => workspaces.map((w) => w.name),
    [workspaces],
  );

  const fuzzyResults = useMemo(
    () => (query ? fuzzySearch(query, workspaceNames, 100) : []),
    [query, workspaceNames],
  );

  const results = useMemo<
    Array<{ workspace: Workspace; match: FuzzyMatch | null }>
  >(() => {
    if (!query) {
      return workspaces.map((workspace) => ({ workspace, match: null }));
    }

    const nameToWorkspaces = new Map<string, Workspace[]>();
    for (const workspace of workspaces) {
      const list = nameToWorkspaces.get(workspace.name) ?? [];
      list.push(workspace);
      nameToWorkspaces.set(workspace.name, list);
    }
    const consumed = new Map<string, number>();
    return fuzzyResults.map((match) => {
      const list = nameToWorkspaces.get(match.path) ?? [];
      const idx = consumed.get(match.path) ?? 0;
      consumed.set(match.path, idx + 1);
      return { workspace: list[idx] ?? list[0], match };
    });
  }, [query, workspaces, fuzzyResults]);

  const totalItems = results.length;

  // Reset state when dialog opens (during-render pattern)
  const [prevIsOpen, setPrevIsOpen] = useState(false);
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
    setQuery("");
    setSelectedIndex(0);
  } else if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // Clamp selectedIndex when results change (during render)
  if (selectedIndex >= totalItems && totalItems > 0) {
    setSelectedIndex(Math.max(0, totalItems - 1));
  }

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`);
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (workspace: Workspace) => {
      setActiveWorkspaceId(workspace.id);
      close();
    },
    [setActiveWorkspaceId, close],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
        case "j":
          if (e.ctrlKey || e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((i) => Math.min(i + 1, totalItems - 1));
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
            handleSelect(results[selectedIndex].workspace);
          }
          break;
        case "Escape":
          e.preventDefault();
          close();
          break;
      }
    },
    [totalItems, selectedIndex, results, handleSelect, close],
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0"
        showCloseButton={false}
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Switch workspace</DialogTitle>
          <DialogDescription>
            Search and switch between workspaces
          </DialogDescription>
        </DialogHeader>

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
            placeholder="Search workspaces..."
            className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <ScrollArea className="h-[min(400px,60vh)] [&>[data-slot=scroll-area-viewport]]:!overflow-x-hidden [&>[data-slot=scroll-area-viewport]>div]:!block">
          <div ref={listRef} className="p-1">
            {totalItems === 0 && (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {workspaces.length === 0
                  ? "No workspaces"
                  : "No matching workspaces"}
              </p>
            )}

            {results.map((result, i) => {
              const isSelected = i === selectedIndex;
              const { workspace, match } = result;
              const isActive = workspace.id === activeWorkspaceId;
              const isRemote = workspace.backend === "remote";

              return (
                <button
                  type="button"
                  key={workspace.id}
                  data-index={i}
                  className={cn(
                    "flex w-full items-center gap-2 overflow-hidden rounded-sm px-2 py-1.5 text-left text-sm",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                  onClick={() => handleSelect(workspace)}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: workspace.color ?? "var(--muted)",
                    }}
                  />

                  <div className="min-w-0 flex-1 truncate text-xs">
                    {match ? (
                      <HighlightedText
                        text={workspace.name}
                        positions={match.positions}
                      />
                    ) : (
                      workspace.name
                    )}
                  </div>

                  <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-[11px]">
                    <Badge
                      variant="secondary"
                      className="px-1 py-0 text-[10px] font-normal"
                    >
                      {workspace.type}
                    </Badge>
                    {isRemote && <Globe className="size-3 text-blue-500" />}
                    {isActive && <Check className="size-3 text-green-500" />}
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>

        <div className="text-muted-foreground/60 flex items-center gap-3 border-t px-3 py-1.5 text-[10px]">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
