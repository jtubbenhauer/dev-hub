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
import { useRouter, usePathname } from "next/navigation";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  useGitStatus,
  useGitChangedFiles,
  useGitBranches,
} from "@/hooks/use-git";
import { fuzzySearch, type FuzzyMatch } from "@/lib/fuzzy-match";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { GitCompare, FileText, Search, Loader2 } from "lucide-react";
import type {
  GitStatusResult,
  ReviewChangedFile,
  ReviewFileStatus,
} from "@/types";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface GitPickerContextValue {
  isOpen: boolean;
  openCount: number;
  open: () => void;
  close: () => void;
}

const GitPickerContext = createContext<GitPickerContextValue | null>(null);

export function useGitPicker() {
  const ctx = useContext(GitPickerContext);
  if (!ctx)
    throw new Error("useGitPicker must be used within GitPickerProvider");
  return ctx;
}

export function GitPickerProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const open = useCallback(() => {
    setOpenCount((c) => c + 1);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <GitPickerContext.Provider value={{ isOpen, openCount, open, close }}>
      {children}
    </GitPickerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PickerMode = "status" | "branch";

interface PickerFile {
  path: string;
  statusChar: string;
  statusColor: string;
  section: "staged" | "changes" | "conflicts" | "branch";
}

const REVIEW_STATUS_MAP: Record<
  ReviewFileStatus,
  { char: string; color: string }
> = {
  added: { char: "A", color: "text-green-500" },
  modified: { char: "M", color: "text-yellow-500" },
  deleted: { char: "D", color: "text-red-500" },
  renamed: { char: "R", color: "text-blue-500" },
  copied: { char: "C", color: "text-blue-500" },
  "type-changed": { char: "T", color: "text-yellow-500" },
  untracked: { char: "?", color: "text-muted-foreground" },
};

function buildStatusFiles(status: GitStatusResult): PickerFile[] {
  const files: PickerFile[] = [];

  for (const file of status.staged) {
    files.push({
      path: file.path,
      statusChar: file.index,
      statusColor: "text-green-500",
      section: "staged",
    });
  }

  for (const file of status.unstaged) {
    files.push({
      path: file.path,
      statusChar: file.workingDir,
      statusColor: "text-yellow-500",
      section: "changes",
    });
  }

  for (const path of status.untracked) {
    files.push({
      path,
      statusChar: "?",
      statusColor: "text-muted-foreground",
      section: "changes",
    });
  }

  for (const path of status.conflicted) {
    files.push({
      path,
      statusChar: "!",
      statusColor: "text-red-500",
      section: "conflicts",
    });
  }

  return files;
}

function buildBranchFiles(changedFiles: ReviewChangedFile[]): PickerFile[] {
  return changedFiles.map((file) => {
    const mapping = REVIEW_STATUS_MAP[file.status] ?? {
      char: "?",
      color: "text-muted-foreground",
    };
    return {
      path: file.path,
      statusChar: mapping.char,
      statusColor: mapping.color,
      section: "branch" as const,
    };
  });
}

// ---------------------------------------------------------------------------
// Highlighted text renderer
// ---------------------------------------------------------------------------

function HighlightedText({
  text,
  positions,
}: {
  text: string;
  positions: Set<number>;
}) {
  if (positions.size === 0) return <>{text}</>;

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

function basenamePositions(
  fullPath: string,
  positions: Set<number>,
): Set<number> {
  const lastSlash = fullPath.lastIndexOf("/");
  if (lastSlash === -1) return positions;

  const offset = lastSlash + 1;
  const result = new Set<number>();
  for (const pos of positions) {
    if (pos >= offset) result.add(pos - offset);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
      <span>{label}</span>
      <span>({count})</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Git Picker Dialog
// ---------------------------------------------------------------------------

export function GitPickerDialog() {
  const { isOpen, openCount, close } = useGitPicker();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      {isOpen && <GitPickerDialogContent key={openCount} close={close} />}
    </Dialog>
  );
}

function GitPickerDialogContent({ close }: { close: () => void }) {
  const router = useRouter();
  const pathname = usePathname();

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<PickerMode>(() => {
    try {
      const stored = localStorage.getItem("dev-hub:git-picker-mode");
      if (stored === "status" || stored === "branch") return stored;
    } catch {}
    return "status";
  });
  const [compareBaseRef, setCompareBaseRef] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: gitStatus, isLoading: isStatusLoading } = useGitStatus(
    mode === "status" ? activeWorkspaceId : null,
    30_000,
  );

  const { data: branches } = useGitBranches(activeWorkspaceId);

  // Auto-detect default base branch (main/master)
  const defaultBaseRef = useMemo(() => {
    if (!branches) return null;
    const mainBranch = branches.find(
      (b) => b.name === "main" || b.name === "master",
    );
    return mainBranch?.name ?? null;
  }, [branches]);

  const effectiveBaseRef = compareBaseRef ?? defaultBaseRef;

  const { data: changedFiles, isLoading: isBranchLoading } = useGitChangedFiles(
    mode === "branch" ? activeWorkspaceId : null,
    effectiveBaseRef,
  );

  // Non-current branches for the base ref selector
  const comparableBranches = useMemo(
    () => (branches ?? []).filter((b) => !b.current),
    [branches],
  );

  const allFiles = useMemo<PickerFile[]>(() => {
    if (mode === "status") return gitStatus ? buildStatusFiles(gitStatus) : [];
    return changedFiles ? buildBranchFiles(changedFiles) : [];
  }, [mode, gitStatus, changedFiles]);

  const allPaths = useMemo(() => allFiles.map((f) => f.path), [allFiles]);

  const fuzzyResults = useMemo(
    () => fuzzySearch(query, allPaths, 200),
    [query, allPaths],
  );

  // Map fuzzy results back to PickerFile entries preserving section order
  const results = useMemo(() => {
    if (!query) {
      return allFiles.map((file) => ({
        file,
        match: {
          path: file.path,
          score: 0,
          positions: new Set<number>(),
        } as FuzzyMatch,
      }));
    }

    const pathToFile = new Map<string, PickerFile>();
    for (const file of allFiles) {
      pathToFile.set(file.path, file);
    }

    return fuzzyResults
      .map((match) => {
        const file = pathToFile.get(match.path);
        if (!file) return null;
        return { file, match };
      })
      .filter((r): r is { file: PickerFile; match: FuzzyMatch } => r !== null);
  }, [query, allFiles, fuzzyResults]);

  // Group results by section for rendering (only in status mode without a query)
  const sections = useMemo(() => {
    if (mode !== "status" || query) return null;

    const grouped = {
      staged: [] as Array<{
        file: PickerFile;
        match: FuzzyMatch;
        flatIndex: number;
      }>,
      changes: [] as Array<{
        file: PickerFile;
        match: FuzzyMatch;
        flatIndex: number;
      }>,
      conflicts: [] as Array<{
        file: PickerFile;
        match: FuzzyMatch;
        flatIndex: number;
      }>,
    };

    let flatIndex = 0;
    for (const result of results) {
      const section = result.file.section as "staged" | "changes" | "conflicts";
      if (grouped[section]) {
        grouped[section].push({ ...result, flatIndex });
      }
      flatIndex++;
    }

    return grouped;
  }, [mode, query, results]);

  const totalItems = results.length;
  const isLoading = mode === "status" ? isStatusLoading : isBranchLoading;

  // Focus input on mount (content remounts fresh each time the dialog opens)
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // Clamp selectedIndex when results shrink
  const clampedIndex =
    totalItems > 0 ? Math.min(selectedIndex, totalItems - 1) : 0;

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector(`[data-index="${clampedIndex}"]`);
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [clampedIndex]);

  const handleSelectFile = useCallback(
    (file: PickerFile, openInEditor: boolean) => {
      close();

      if (openInEditor) {
        router.push(`/files?open=${encodeURIComponent(file.path)}`);
        return;
      }

      // Navigate to git page with the file pre-selected
      localStorage.setItem("dev-hub:git-picker-selected-file", file.path);
      if (mode === "branch" && effectiveBaseRef) {
        localStorage.setItem("dev-hub:git-view-mode", "branch");
      } else {
        localStorage.setItem("dev-hub:git-view-mode", "working");
      }
      if (!pathname.startsWith("/git")) {
        router.push("/git");
      }
      window.dispatchEvent(
        new CustomEvent("devhub:git-select-file", {
          detail: { path: file.path, staged: file.section === "staged" },
        }),
      );
    },
    [close, router, pathname, mode, effectiveBaseRef],
  );

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next = prev === "status" ? "branch" : "status";
      try {
        localStorage.setItem("dev-hub:git-picker-mode", next);
      } catch {}
      return next;
    });
    setQuery("");
    setSelectedIndex(0);
  }, []);

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
          if (results[clampedIndex]) {
            handleSelectFile(
              results[clampedIndex].file,
              e.ctrlKey || e.metaKey,
            );
          }
          break;
        case "Escape":
          e.preventDefault();
          close();
          break;
        case "Tab":
          e.preventDefault();
          toggleMode();
          break;
      }
    },
    [totalItems, clampedIndex, results, handleSelectFile, close, toggleMode],
  );

  const renderFileRow = (
    file: PickerFile,
    match: FuzzyMatch,
    index: number,
  ) => {
    const isSelected = index === clampedIndex;
    const basename = file.path.split("/").pop() ?? file.path;
    const dirname = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/"))
      : "";

    return (
      <button
        key={`${file.section}-${file.path}`}
        data-index={index}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm",
          isSelected
            ? "bg-accent text-accent-foreground"
            : "hover:bg-accent/50",
        )}
        onClick={() => handleSelectFile(file, false)}
        onMouseEnter={() => setSelectedIndex(index)}
      >
        <span
          className={cn(
            "w-4 shrink-0 text-center font-mono text-xs font-bold",
            file.statusColor,
          )}
        >
          {file.statusChar}
        </span>
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate font-mono text-xs">
            <HighlightedText
              text={basename}
              positions={basenamePositions(file.path, match.positions)}
            />
          </span>
          {dirname && (
            <span className="truncate text-[11px] text-muted-foreground/60">
              {dirname}
            </span>
          )}
        </div>
      </button>
    );
  };

  return (
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0"
        showCloseButton={false}
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Git changed files</DialogTitle>
          <DialogDescription>
            Search and navigate to changed git files
          </DialogDescription>
        </DialogHeader>

        {/* Search input + mode toggle */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={
              mode === "status"
                ? "Search changed files..."
                : "Search branch diff..."
            }
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
          {isLoading && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
          <button
            type="button"
            onClick={toggleMode}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
              "border border-border bg-muted/50 text-muted-foreground hover:bg-muted",
            )}
            tabIndex={-1}
          >
            {mode === "status" ? (
              <>
                <FileText className="size-3" />
                <span>Status</span>
              </>
            ) : (
              <>
                <GitCompare className="size-3" />
                <span>Branch</span>
              </>
            )}
          </button>
        </div>

        {/* Branch selector (only in branch mode) */}
        {mode === "branch" && comparableBranches.length > 0 && (
          <div className="flex items-center gap-2 border-b px-3 py-1.5 bg-muted/30">
            <GitCompare className="size-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">vs</span>
            <select
              value={effectiveBaseRef ?? ""}
              onChange={(e) => setCompareBaseRef(e.target.value || null)}
              className="flex-1 truncate bg-transparent text-[11px] text-muted-foreground outline-none"
            >
              {comparableBranches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Results */}
        <ScrollArea className="h-[min(400px,60vh)] [&>[data-slot=scroll-area-viewport]]:!overflow-x-hidden [&>[data-slot=scroll-area-viewport]>div]:!block">
          <div ref={listRef} className="p-1">
            {!isLoading && totalItems === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {mode === "status"
                  ? "No uncommitted changes"
                  : "No changes vs base branch"}
              </p>
            )}

            {/* Status mode with sections (no search query) */}
            {sections && (
              <>
                {sections.staged.length > 0 && (
                  <>
                    <SectionHeader
                      label="Staged"
                      count={sections.staged.length}
                    />
                    {sections.staged.map((r) =>
                      renderFileRow(r.file, r.match, r.flatIndex),
                    )}
                  </>
                )}
                {sections.changes.length > 0 && (
                  <>
                    <SectionHeader
                      label="Changes"
                      count={sections.changes.length}
                    />
                    {sections.changes.map((r) =>
                      renderFileRow(r.file, r.match, r.flatIndex),
                    )}
                  </>
                )}
                {sections.conflicts.length > 0 && (
                  <>
                    <SectionHeader
                      label="Conflicts"
                      count={sections.conflicts.length}
                    />
                    {sections.conflicts.map((r) =>
                      renderFileRow(r.file, r.match, r.flatIndex),
                    )}
                  </>
                )}
              </>
            )}

            {/* Flat list (branch mode, or status mode with a search query) */}
            {!sections &&
              results.map((r, i) => renderFileRow(r.file, r.match, i))}
          </div>
        </ScrollArea>

        {/* Footer hints */}
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground/60">
          <span>↑↓ navigate</span>
          <span>↵ open diff</span>
          <span>^↵ open editor</span>
          <span>tab switch mode</span>
          <span>esc close</span>
        </div>
      </DialogContent>
  );
}
