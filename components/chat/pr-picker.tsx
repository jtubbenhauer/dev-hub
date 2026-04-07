"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGitHubRepoPrs } from "@/hooks/use-github-repo-prs";

interface RepoPr {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merged_at: string | null;
  user: { login: string; avatar_url: string };
  head: { ref: string };
}

interface PrPickerProps {
  query: string;
  owner: string;
  repo: string;
  onSelect: (prNumber: number) => void;
  onDismiss: () => void;
}

function statusDotClass(pr: RepoPr): string {
  if (pr.draft) return "bg-gray-400";
  if (pr.merged_at !== null) return "bg-purple-500";
  if (pr.state === "closed") return "bg-red-500";
  return "bg-green-500";
}

function fuzzyMatch(value: string, query: string): boolean {
  if (!query) return true;
  const lower = value.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function PrPicker({
  query,
  owner,
  repo,
  onSelect,
  onDismiss,
}: PrPickerProps) {
  const { data: prs = [], isLoading } = useGitHubRepoPrs(owner, repo, {
    search: query,
  });
  const [localSearch, setLocalSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!localSearch) return prs;
    return prs.filter(
      (pr) =>
        fuzzyMatch(pr.title, localSearch) ||
        String(pr.number).startsWith(localSearch) ||
        fuzzyMatch(pr.user.login, localSearch),
    );
  }, [prs, localSearch]);

  const [prevQuery, setPrevQuery] = useState(query);
  const [prevLocalSearch, setPrevLocalSearch] = useState(localSearch);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setHighlightedIndex(0);
  }
  if (prevLocalSearch !== localSearch) {
    setPrevLocalSearch(localSearch);
    setHighlightedIndex(0);
  }

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((prev) =>
            Math.min(prev + 1, filtered.length - 1),
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[highlightedIndex])
            onSelect(filtered[highlightedIndex].number);
          break;
        case "Escape":
          e.preventDefault();
          onDismiss();
          break;
      }
    },
    [filtered, highlightedIndex, onSelect, onDismiss],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const item = listRef.current?.children[highlightedIndex] as
      | HTMLElement
      | undefined;
    if (item && typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  return (
    <div className="bg-popover absolute bottom-full mb-1 max-h-80 w-full overflow-hidden rounded-lg border shadow-md">
      <div className="border-b px-3 py-1.5">
        <div className="flex items-center gap-2">
          <Search className="text-muted-foreground size-3 shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search PRs by title, number, or author..."
            className="placeholder:text-muted-foreground w-full bg-transparent text-xs outline-none"
            data-pr-search
          />
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {isLoading && (
          <p className="text-muted-foreground px-3 py-2 text-xs">Loading...</p>
        )}
        {!isLoading && filtered.length === 0 && (
          <p className="text-muted-foreground px-3 py-2 text-xs">
            No PRs found
          </p>
        )}
        {!isLoading && filtered.length > 0 && (
          <div ref={listRef}>
            {filtered.map((pr, index) => (
              <button
                key={pr.number}
                data-pr-item
                className={cn(
                  "hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                  index === highlightedIndex && "bg-accent",
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => onSelect(pr.number)}
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    statusDotClass(pr),
                  )}
                />
                <span className="text-muted-foreground shrink-0 font-mono">
                  #{pr.number}
                </span>
                <span className="truncate">{pr.title}</span>
                <span className="text-muted-foreground shrink-0">
                  {pr.user.login}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
