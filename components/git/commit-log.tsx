"use client";

import { useState } from "react";
import {
  GitCommitHorizontal,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
  GitBranch,
  ListTree,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { DiffViewer } from "@/components/git/diff-viewer";
import { useGitCommitDiff } from "@/hooks/use-git";
import { cn } from "@/lib/utils";
import type { GitLogEntry } from "@/types";

interface CommitLogProps {
  entries: GitLogEntry[];
  workspaceId: string;
  isLoading: boolean;
  branchOnly: boolean;
  onToggleBranchOnly: () => void;
}

export function CommitLog({
  entries,
  workspaceId,
  isLoading,
  branchOnly,
  onToggleBranchOnly,
}: CommitLogProps) {
  const [expandedHash, setExpandedHash] = useState<string | null>(null);

  const header = (
    <div className="flex shrink-0 items-center justify-between border-b px-2 py-1">
      <span className="text-muted-foreground text-[11px]">
        {branchOnly ? "Branch commits" : "All commits"}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={branchOnly ? "secondary" : "ghost"}
            size="icon-xs"
            onClick={onToggleBranchOnly}
          >
            {branchOnly ? (
              <GitBranch className="size-3.5" />
            ) : (
              <ListTree className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {branchOnly
            ? "Showing branch commits only — click for full history"
            : "Showing full history — click for branch commits only"}
        </TooltipContent>
      </Tooltip>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
          Loading commit history...
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
          {branchOnly ? "No branch-specific commits" : "No commits yet"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-px p-2">
          {entries.map((entry) => (
            <CommitEntry
              key={entry.hash}
              entry={entry}
              workspaceId={workspaceId}
              isExpanded={expandedHash === entry.hash}
              onToggle={() =>
                setExpandedHash(expandedHash === entry.hash ? null : entry.hash)
              }
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function CommitEntry({
  entry,
  workspaceId,
  isExpanded,
  onToggle,
}: {
  entry: GitLogEntry;
  workspaceId: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { data: diff, isLoading: isDiffLoading } = useGitCommitDiff(
    isExpanded ? workspaceId : null,
    isExpanded ? entry.hash : null,
  );

  const relativeDate = formatRelativeDate(entry.date);

  return (
    <div className="rounded-sm">
      <div
        className={cn(
          "hover:bg-accent/50 flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-xs",
          isExpanded && "bg-accent/30",
        )}
        onClick={onToggle}
      >
        <span className="mt-0.5 shrink-0">
          {isExpanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </span>
        <GitCommitHorizontal className="text-muted-foreground mt-0.5 size-3 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-primary/70 font-mono">
              {entry.abbrevHash}
            </span>
            <span className="flex-1 truncate">{entry.message}</span>
          </div>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-3">
            <span className="flex items-center gap-1">
              <User className="size-2.5" />
              {entry.author}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-2.5" />
              {relativeDate}
            </span>
            {entry.refs && (
              <span className="text-primary/60 truncate">{entry.refs}</span>
            )}
          </div>
        </div>
      </div>
      {isExpanded && (
        <div className="border-border/50 ml-6 max-h-80 overflow-hidden border-l-2 pl-2">
          <DiffViewer
            diff={diff ?? ""}
            isLoading={isDiffLoading}
            workspaceId={workspaceId}
          />
        </div>
      )}
    </div>
  );
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
