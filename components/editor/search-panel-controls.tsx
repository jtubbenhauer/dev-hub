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
      if (outcome.matchCount === 0) {
        lines.push("No results found.");
      } else if (outcome.isLimitHit) {
        lines.push(
          `Showing the first ${outcome.matchCount} results. Narrow your search to see more.`,
        );
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
      {status.lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
