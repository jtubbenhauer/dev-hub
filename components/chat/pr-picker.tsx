"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setHighlightedIndex(0);
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((prev) => Math.min(prev + 1, prs.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (prs[highlightedIndex]) onSelect(prs[highlightedIndex].number);
          break;
        case "Escape":
          e.preventDefault();
          onDismiss();
          break;
      }
    },
    [prs, highlightedIndex, onSelect, onDismiss],
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
    <div className="bg-popover absolute z-50 max-h-64 w-80 overflow-y-auto rounded-lg border shadow-md">
      {isLoading && (
        <p className="text-muted-foreground px-3 py-2 text-xs">Loading...</p>
      )}
      {!isLoading && prs.length === 0 && (
        <p className="text-muted-foreground px-3 py-2 text-xs">No PRs found</p>
      )}
      {!isLoading && prs.length > 0 && (
        <div ref={listRef}>
          {prs.map((pr, index) => (
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
  );
}
