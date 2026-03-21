"use client";

import Link from "next/link";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import type { WorkspaceActivity } from "@/stores/chat-store";
import { useShallow } from "zustand/react/shallow";
import { useGitStatus } from "@/hooks/use-git";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GitBranch,
  ArrowUp,
  ArrowDown,
  FileWarning,
  MessageSquare,
  FolderOpen,
  GitCommitHorizontal,
  Clock,
  FolderGit2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Workspace } from "@/types";

export function WorkspaceOverview() {
  const { workspaces } = useWorkspaceStore();

  if (workspaces.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <FolderGit2 className="text-muted-foreground h-12 w-12" />
          <p className="text-muted-foreground">No workspaces registered yet.</p>
          <Link
            href="/workspaces"
            className="text-primary text-sm hover:underline"
          >
            Add your first workspace
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {workspaces.map((workspace) => (
        <WorkspaceCard key={workspace.id} workspace={workspace} />
      ))}
    </div>
  );
}

function useWorkspaceActivityInfo(workspaceId: string): {
  activity: WorkspaceActivity;
  activeSessionCount: number;
} {
  return useChatStore(
    useShallow((state) => {
      const ws = state.workspaceStates[workspaceId];
      if (!ws) return { activity: "idle" as const, activeSessionCount: 0 };

      if (ws.permissions.length > 0 || ws.questions.length > 0) {
        return { activity: "waiting" as const, activeSessionCount: 0 };
      }

      const activeSessionCount = Object.values(ws.sessionStatuses).filter(
        (s) => s.type !== "idle",
      ).length;

      return {
        activity: (activeSessionCount > 0
          ? "active"
          : "idle") as WorkspaceActivity,
        activeSessionCount,
      };
    }),
  );
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const { setActiveWorkspaceId } = useWorkspaceStore();
  const { data: gitStatus, isLoading } = useGitStatus(workspace.id);
  const { activity, activeSessionCount } = useWorkspaceActivityInfo(
    workspace.id,
  );

  const totalChanges = gitStatus
    ? gitStatus.staged.length +
      gitStatus.unstaged.length +
      gitStatus.untracked.length
    : 0;

  const relativeDate = gitStatus?.lastCommit?.date
    ? formatRelativeDate(gitStatus.lastCommit.date)
    : null;

  return (
    <Card className="hover:border-primary/50 overflow-hidden transition-colors">
      <CardHeader className="px-3 pt-3 pb-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          {workspace.color && (
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: workspace.color }}
            />
          )}
          <CardTitle className="min-w-0 truncate text-sm">
            {workspace.name}
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant="secondary" className="py-0 text-xs">
              {workspace.type}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-3 pb-3">
        {isLoading ? (
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-44" />
          </div>
        ) : gitStatus?.isRepo ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <div className="text-foreground flex min-w-0 items-center gap-1">
                <GitBranch className="text-muted-foreground size-3 shrink-0" />
                <span className="max-w-28 truncate font-mono">
                  {gitStatus.branch}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {gitStatus.ahead > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-green-500">
                        <ArrowUp className="size-3" />
                        {gitStatus.ahead}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {gitStatus.ahead} commit{gitStatus.ahead > 1 ? "s" : ""}{" "}
                      ahead
                    </TooltipContent>
                  </Tooltip>
                )}
                {gitStatus.behind > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-orange-500">
                        <ArrowDown className="size-3" />
                        {gitStatus.behind}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {gitStatus.behind} commit{gitStatus.behind > 1 ? "s" : ""}{" "}
                      behind
                    </TooltipContent>
                  </Tooltip>
                )}
                {totalChanges > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-0.5 text-yellow-500">
                        <FileWarning className="size-3" />
                        {totalChanges}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {gitStatus.staged.length} staged,{" "}
                      {gitStatus.unstaged.length} modified,{" "}
                      {gitStatus.untracked.length} untracked
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>

            {gitStatus.lastCommit && (
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <GitCommitHorizontal className="size-3 shrink-0" />
                <span className="flex-1 truncate">
                  {gitStatus.lastCommit.message}
                </span>
                {relativeDate && (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <Clock className="size-3" />
                    {relativeDate}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : null}

        {activity !== "idle" && (
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs",
              activity === "active" && "text-emerald-600 dark:text-emerald-400",
              activity === "waiting" && "text-amber-600 dark:text-amber-400",
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                activity === "active" && "animate-pulse bg-emerald-500",
                activity === "waiting" && "bg-amber-500",
              )}
            />
            {activity === "active" &&
              (activeSessionCount === 1
                ? "1 session active"
                : `${activeSessionCount} sessions active`)}
            {activity === "waiting" && "Waiting for input"}
          </div>
        )}

        <div className="flex items-center gap-3 pt-0.5">
          <Link
            href="/chat"
            onClick={() => setActiveWorkspaceId(workspace.id)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
          >
            <MessageSquare className="size-3" />
            Chat
          </Link>
          <Link
            href="/git"
            onClick={() => setActiveWorkspaceId(workspace.id)}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
          >
            <FolderOpen className="size-3" />
            Git
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
