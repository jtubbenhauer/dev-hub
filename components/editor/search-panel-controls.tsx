import type React from "react";
import type { ContentSearchOutcome } from "@devhub/shared";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface PanelIconButtonProps {
  label: string;
  isPressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

export function PanelIconButton({
  label,
  isPressed,
  onClick,
  children,
}: PanelIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-pressed={isPressed}
          className={cn(
            "text-muted-foreground",
            isPressed && "bg-accent text-accent-foreground",
          )}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface StatusContent {
  lines: string[];
  isError: boolean;
}

function buildStatusContent(
  outcome: ContentSearchOutcome | null,
  isSearching: boolean,
): StatusContent {
  if (isSearching) return { lines: ["Searching…"], isError: false };
  if (outcome === null) return { lines: [], isError: false };
  switch (outcome.kind) {
    case "ok": {
      const lines: string[] = [];
      // The limit notice wins over "No results found.": a cut-off search with
      // zero verified matches is inconclusive, not empty.
      if (outcome.isLimitHit) {
        lines.push(
          outcome.matchCount === 0
            ? "No results among the first matches. Narrow your search to see more."
            : `Showing the first ${outcome.matchCount} results. Narrow your search to see more.`,
        );
      } else if (outcome.matchCount === 0) {
        lines.push("No results found.");
      } else {
        const resultsWord = outcome.matchCount === 1 ? "result" : "results";
        const filesWord = outcome.fileCount === 1 ? "file" : "files";
        lines.push(
          `${outcome.matchCount} ${resultsWord} in ${outcome.fileCount} ${filesWord}`,
        );
      }
      if (outcome.isTimedOut) {
        lines.push(
          "Search timed out after 15 seconds. Showing partial results.",
        );
      }
      if (outcome.engine === "git-grep") {
        lines.push("Using git grep (install ripgrep for faster search)");
      }
      return { lines, isError: false };
    }
    case "invalid-pattern":
    case "unavailable":
    case "failed":
      return { lines: [outcome.message], isError: true };
  }
}

function hasNewline(text: string): boolean {
  return text.includes("\n");
}

interface SearchStatusProps {
  outcome: ContentSearchOutcome | null;
  isSearching: boolean;
}

export function SearchStatus({ outcome, isSearching }: SearchStatusProps) {
  const status = buildStatusContent(outcome, isSearching);
  return (
    <div
      role="status"
      className={cn(
        "px-3 text-xs",
        status.isError ? "text-destructive" : "text-muted-foreground",
        status.lines.length > 0 && "py-1",
      )}
    >
      {status.lines.map((line) => {
        // Computed OUTSIDE cn(): prettier-plugin-tailwindcss rewrites every
        // string literal inside cn() as a class list, mangling "\n" to " ".
        const isMultilineError = status.isError && hasNewline(line);
        return (
          <p
            key={line}
            className={cn(
              // Multi-line engine errors carry a caret line; keep it aligned.
              status.isError && "break-words whitespace-pre-wrap",
              isMultilineError && "font-mono",
            )}
          >
            {line}
          </p>
        );
      })}
    </div>
  );
}
