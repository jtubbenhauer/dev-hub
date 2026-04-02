"use client";

import { useState, useCallback } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useChatStore } from "@/stores/chat-store";
import type { WorkspaceActivity } from "@/stores/chat-store";
import { useGitStatus } from "@/hooks/use-git";
import { useGitHubPrsCreatedByMe } from "@/hooks/use-github";
import { QuickActions } from "@/components/lens/quick-actions";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  FileWarning,
  Radio,
  GitPullRequest,
  ExternalLink,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Workspace, GitHubPullRequest } from "@/types";

interface LensSidebarProps {
  onAction: (prompt: string) => void;
  isStreaming: boolean;
}

export function LensSidebar({ onAction, isStreaming }: LensSidebarProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-3 py-2">
        <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          Command Center
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <WorkspacesSection workspaces={workspaces} onAction={onAction} />
        <ActiveSessionsSection onAction={onAction} />
        <MyPrsSection onAction={onAction} />
      </div>

      <div className="border-t px-3 py-3">
        <QuickActions
          onAction={onAction}
          disabled={isStreaming}
          layout="stack"
        />
      </div>
    </div>
  );
}

// ─── Section header with collapsible toggle ─────────────────────────────────

function SectionHeader({
  title,
  icon: Icon,
  isOpen,
  onToggle,
  count,
}: {
  title: string;
  icon: React.ElementType;
  isOpen: boolean;
  onToggle: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onToggle}
      className="hover:bg-accent/50 flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors"
    >
      {isOpen ? (
        <ChevronDown className="text-muted-foreground size-3.5" />
      ) : (
        <ChevronRight className="text-muted-foreground size-3.5" />
      )}
      <Icon className="text-muted-foreground size-3.5" />
      <span className="text-muted-foreground flex-1 text-xs font-medium">
        {title}
      </span>
      {count !== undefined && count > 0 && (
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {count}
        </Badge>
      )}
    </button>
  );
}

// ─── Workspaces section ─────────────────────────────────────────────────────

function WorkspacesSection({
  workspaces,
  onAction,
}: {
  workspaces: Workspace[];
  onAction: (prompt: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="border-b">
      <SectionHeader
        title="Workspaces"
        icon={Layers}
        isOpen={isOpen}
        onToggle={() => setIsOpen(!isOpen)}
        count={workspaces.length}
      />
      {isOpen && (
        <div className="pb-1">
          {workspaces.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Module-level cache for useWorkspaceActivityInfo.
// Returns the same object reference when the derived values haven't changed,
// preventing useSyncExternalStore from triggering spurious re-renders.
const _activityCache = new Map<
  string,
  { activity: WorkspaceActivity; activeSessionCount: number }
>();

const IDLE_ACTIVITY_INFO = {
  activity: "idle" as const,
  activeSessionCount: 0,
};

function useWorkspaceActivityInfo(workspaceId: string): {
  activity: WorkspaceActivity;
  activeSessionCount: number;
} {
  return useChatStore((state) => {
    const workspaceState = state.workspaceStates[workspaceId];
    if (!workspaceState) {
      _activityCache.delete(workspaceId);
      return IDLE_ACTIVITY_INFO;
    }

    let activity: WorkspaceActivity = "idle";
    let activeSessionCount = 0;

    if (
      workspaceState.permissions.length > 0 ||
      workspaceState.questions.length > 0
    ) {
      activity = "waiting";
    } else {
      for (const status of Object.values(workspaceState.sessionStatuses)) {
        if ((status as { type: string }).type !== "idle") activeSessionCount++;
      }
      if (activeSessionCount > 0) activity = "active";
    }

    const cached = _activityCache.get(workspaceId);
    if (
      cached &&
      cached.activity === activity &&
      cached.activeSessionCount === activeSessionCount
    ) {
      return cached;
    }

    const result = { activity, activeSessionCount };
    _activityCache.set(workspaceId, result);
    return result;
  });
}

function WorkspaceRow({
  workspace,
  onAction,
}: {
  workspace: Workspace;
  onAction: (prompt: string) => void;
}) {
  const { data: gitStatus } = useGitStatus(workspace.id, 30_000);
  const { activity } = useWorkspaceActivityInfo(workspace.id);

  const totalChanges = gitStatus
    ? gitStatus.staged.length +
      gitStatus.unstaged.length +
      gitStatus.untracked.length
    : 0;

  const handleClick = useCallback(() => {
    onAction(
      `Give me a status update on the "${workspace.name}" workspace. Include git status, active sessions, and any recent activity.`,
    );
  }, [onAction, workspace.name]);

  return (
    <button
      onClick={handleClick}
      className="hover:bg-accent/50 flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors"
    >
      {workspace.color ? (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: workspace.color }}
        />
      ) : (
        <span className="bg-muted-foreground/30 size-2 shrink-0 rounded-full" />
      )}

      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {workspace.name}
      </span>

      <div className="flex shrink-0 items-center gap-1.5">
        {gitStatus?.branch && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground flex items-center gap-0.5 text-[10px]">
                <GitBranch className="size-3" />
                <span className="max-w-16 truncate font-mono">
                  {gitStatus.branch}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">{gitStatus.branch}</TooltipContent>
          </Tooltip>
        )}

        {totalChanges > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-0.5 text-[10px] text-yellow-500">
                <FileWarning className="size-3" />
                {totalChanges}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">
              {gitStatus!.staged.length} staged, {gitStatus!.unstaged.length}{" "}
              modified, {gitStatus!.untracked.length} untracked
            </TooltipContent>
          </Tooltip>
        )}

        {activity !== "idle" && (
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              activity === "active" && "animate-pulse bg-emerald-500",
              activity === "waiting" && "bg-amber-500",
            )}
          />
        )}
      </div>
    </button>
  );
}

// ─── Active sessions section ────────────────────────────────────────────────

interface ActiveSession {
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  statusType: string;
}

// Module-level cache for useActiveSessions.
// Returns the same array reference when the derived values haven't changed,
// preventing useSyncExternalStore from triggering spurious re-renders.
const EMPTY_ACTIVE_SESSIONS: ActiveSession[] = [];
let _activeSessionsCache: ActiveSession[] = EMPTY_ACTIVE_SESSIONS;
let _activeSessionsCacheKey = "";

function useActiveSessions(): ActiveSession[] {
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  return useChatStore((state) => {
    const activeSessions: ActiveSession[] = [];
    for (const workspace of workspaces) {
      const workspaceState = state.workspaceStates[workspace.id];
      if (!workspaceState) continue;

      for (const [sessionId, sessionStatus] of Object.entries(
        workspaceState.sessionStatuses,
      )) {
        if ((sessionStatus as { type: string }).type !== "idle") {
          activeSessions.push({
            sessionId,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            statusType: (sessionStatus as { type: string }).type,
          });
        }
      }
    }

    if (activeSessions.length === 0) return EMPTY_ACTIVE_SESSIONS;

    // Build a comparison key from the primitive values to detect changes
    let key = "";
    for (const s of activeSessions) {
      key += `${s.sessionId}:${s.statusType},`;
    }

    if (key === _activeSessionsCacheKey) return _activeSessionsCache;

    _activeSessionsCacheKey = key;
    _activeSessionsCache = activeSessions;
    return activeSessions;
  });
}

function ActiveSessionsSection({
  onAction,
}: {
  onAction: (prompt: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const activeSessions = useActiveSessions();

  if (activeSessions.length === 0) return null;

  return (
    <div className="border-b">
      <SectionHeader
        title="Active Sessions"
        icon={Radio}
        isOpen={isOpen}
        onToggle={() => setIsOpen(!isOpen)}
        count={activeSessions.length}
      />
      {isOpen && (
        <div className="pb-1">
          {activeSessions.map((session) => (
            <button
              key={session.sessionId}
              onClick={() =>
                onAction(
                  `What is the session doing in "${session.workspaceName}" right now? Session ID: ${session.sessionId}`,
                )
              }
              className="hover:bg-accent/50 flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors"
            >
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />
              <span className="min-w-0 flex-1 truncate text-xs">
                {session.workspaceName}
              </span>
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {session.statusType}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── My PRs section ─────────────────────────────────────────────────────────

function MyPrsSection({ onAction }: { onAction: (prompt: string) => void }) {
  const [isOpen, setIsOpen] = useState(true);
  const { data: pullRequests } = useGitHubPrsCreatedByMe();

  if (!pullRequests || pullRequests.length === 0) return null;

  return (
    <div className="border-b">
      <SectionHeader
        title="My PRs"
        icon={GitPullRequest}
        isOpen={isOpen}
        onToggle={() => setIsOpen(!isOpen)}
        count={pullRequests.length}
      />
      {isOpen && (
        <div className="pb-1">
          {pullRequests.map((pr) => (
            <PullRequestRow key={pr.node_id} pr={pr} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

function PullRequestRow({
  pr,
  onAction,
}: {
  pr: GitHubPullRequest;
  onAction: (prompt: string) => void;
}) {
  const repoName = pr.base.repo.name;

  const handleClick = useCallback(() => {
    onAction(
      `Tell me about PR #${pr.number} in ${pr.base.repo.full_name}: "${pr.title}". What's its status?`,
    );
  }, [onAction, pr.number, pr.base.repo.full_name, pr.title]);

  const handleExternalClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      window.open(pr.html_url, "_blank", "noopener,noreferrer");
    },
    [pr.html_url],
  );

  return (
    <button
      onClick={handleClick}
      className="hover:bg-accent/50 group flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors"
    >
      <GitPullRequest
        className={cn(
          "size-3.5 shrink-0",
          pr.draft
            ? "text-muted-foreground"
            : "text-emerald-600 dark:text-emerald-400",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium">
          {repoName}#{pr.number}
        </span>
        <span className="text-muted-foreground truncate text-[10px]">
          {pr.title}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {pr.draft && (
          <Badge variant="secondary" className="px-1 py-0 text-[10px]">
            draft
          </Badge>
        )}
        <button
          onClick={handleExternalClick}
          className="text-muted-foreground hover:text-foreground opacity-0 transition-opacity group-hover:opacity-100"
        >
          <ExternalLink className="size-3" />
        </button>
      </div>
    </button>
  );
}
