"use client";

import { Bot, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  SessionTaskProgressIndicator,
  type SessionTaskProgress,
} from "@/components/chat/session-task-progress";
import { SubAgentDialog } from "@/components/chat/sub-agent-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Session, SubAgentActivity } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";
import {
  isSessionOwnedByOtherWorkspace,
  useChatStore,
} from "@/stores/chat-store";
import { useSubAgentActivityStore } from "@/stores/sub-agent-activity-store";

// Chips are flex-1 with gap-1.5, so these widths only decide how many chips
// to show; flexbox stretches or squeezes the visible chips to fill the row.
const MIN_AGENT_CHIP_WIDTH = 192;
const AGENT_CHIP_GAP = 6;
const OVERFLOW_PICKER_TRIGGER_WIDTH = 88;
const MIN_VISIBLE_AGENT_CHIPS = 1;

export function getVisibleAgentCount(
  agentCount: number,
  agentListWidth: number | null,
): number {
  if (agentListWidth === null) return agentCount;
  const widthForAllChips =
    agentCount * MIN_AGENT_CHIP_WIDTH + (agentCount - 1) * AGENT_CHIP_GAP;
  if (widthForAllChips <= agentListWidth) return agentCount;
  const chipsBesideOverflowPicker = Math.floor(
    (agentListWidth - OVERFLOW_PICKER_TRIGGER_WIDTH) /
      (MIN_AGENT_CHIP_WIDTH + AGENT_CHIP_GAP),
  );
  return Math.max(MIN_VISIBLE_AGENT_CHIPS, chipsBesideOverflowPicker);
}

interface SubAgentActivityDisplay {
  readonly text: string | undefined;
  readonly tooltip: string | undefined;
}

function useSubAgentActivityDisplay(
  sessionId: string,
): SubAgentActivityDisplay {
  const activity: SubAgentActivity | undefined = useSubAgentActivityStore(
    (state) => state.activityBySession[sessionId],
  );
  if (!activity) return { text: undefined, tooltip: undefined };
  const currentTool = activity.currentTool?.trim();
  const lastLine = activity.lastLine?.trim();
  return {
    text: currentTool || lastLine || undefined,
    tooltip: lastLine ? `${activity.summary}\n${lastLine}` : activity.summary,
  };
}

interface RunningAgentLabelProps {
  readonly title: string;
  readonly activityText: string | undefined;
}

// A long title stops at 3/5 of the row so the activity text stays visible.
function RunningAgentLabel({ title, activityText }: RunningAgentLabelProps) {
  return (
    <>
      <span
        className={cn(
          "min-w-0 truncate text-xs font-medium",
          activityText ? "max-w-3/5" : "flex-1",
        )}
      >
        {title}
      </span>
      {activityText && (
        <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
          {activityText}
        </span>
      )}
    </>
  );
}

interface RunningAgentEntryProps {
  readonly sessionId: string;
  readonly title: string;
  readonly progress: SessionTaskProgress | undefined;
  readonly onSelect: () => void;
}

function RunningAgentChip({
  sessionId,
  title,
  progress,
  onSelect,
}: RunningAgentEntryProps) {
  const activity = useSubAgentActivityDisplay(sessionId);
  return (
    <button
      type="button"
      title={activity.tooltip}
      className="bg-background/70 hover:bg-background flex max-w-64 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-violet-500/20 px-2 py-1 text-left transition-colors"
      onClick={onSelect}
    >
      <Loader2 className="size-3 shrink-0 animate-spin text-violet-500 motion-reduce:animate-none" />
      <RunningAgentLabel title={title} activityText={activity.text} />
      {progress && (
        <SessionTaskProgressIndicator
          progress={progress}
          compact
          isSessionActive
        />
      )}
      <ChevronRight className="text-muted-foreground size-3 shrink-0" />
    </button>
  );
}

function RunningAgentMenuItem({
  sessionId,
  title,
  progress,
  onSelect,
}: RunningAgentEntryProps) {
  const activity = useSubAgentActivityDisplay(sessionId);
  return (
    <DropdownMenuItem title={activity.tooltip} onSelect={onSelect}>
      <Loader2 className="size-3 animate-spin text-violet-500 motion-reduce:animate-none" />
      <RunningAgentLabel title={title} activityText={activity.text} />
      {progress && (
        <SessionTaskProgressIndicator
          progress={progress}
          compact
          isSessionActive
        />
      )}
    </DropdownMenuItem>
  );
}

interface RunningSubAgentsBannerProps {
  readonly parentSessionId: string;
  readonly workspaceId: string;
}

export function RunningSubAgentsBanner({
  parentSessionId,
  workspaceId,
}: RunningSubAgentsBannerProps) {
  const workspace = useChatStore((state) => state.workspaceStates[workspaceId]);
  const fetchSessionTodos = useChatStore((state) => state.fetchSessionTodos);
  const [reconciledStatuses, setReconciledStatuses] = useState<
    Record<string, { readonly type: "idle" | "busy" | "retry" }>
  >({});
  const [loadedDescendants, setLoadedDescendants] = useState<Session[]>([]);
  useEffect(() => {
    if (
      isSessionOwnedByOtherWorkspace(
        useChatStore.getState().workspaceStates,
        parentSessionId,
        workspaceId,
      )
    ) {
      return;
    }
    const controller = new AbortController();
    void Promise.all([
      fetch(
        `/api/opencode/session/${parentSessionId}/children?workspaceId=${workspaceId}`,
        { signal: controller.signal },
      ).then((response) => (response.ok ? response.json() : [])),
      fetch(`/api/opencode/session/status?workspaceId=${workspaceId}`, {
        signal: controller.signal,
      }).then((response) => (response.ok ? response.json() : {})),
    ])
      .then(([sessions, statuses]) => {
        setLoadedDescendants(sessions as Session[]);
        setReconciledStatuses(statuses as typeof reconciledStatuses);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [parentSessionId, workspaceId]);
  const runningAgents = useMemo(() => {
    if (!workspace) return [];
    const sessions = {
      ...workspace.sessions,
      ...Object.fromEntries(
        loadedDescendants.map((session) => [session.id, session]),
      ),
    };
    const descendants = new Set<string>();
    const pending = [parentSessionId];
    while (pending.length > 0) {
      const parentId = pending.pop();
      if (!parentId) continue;
      for (const session of Object.values(sessions)) {
        if (session.parentID !== parentId || descendants.has(session.id))
          continue;
        descendants.add(session.id);
        pending.push(session.id);
      }
    }

    return [...descendants]
      .flatMap((sessionId) => {
        const session = sessions[sessionId];
        const status =
          reconciledStatuses[sessionId] ?? workspace.sessionStatuses[sessionId];
        if (!session || (status?.type !== "busy" && status?.type !== "retry")) {
          return [];
        }
        const todos = workspace.todos[session.id] ?? [];
        return [
          {
            id: session.id,
            title: session.title,
            updatedAt: session.time.updated,
            shouldHydrateTodos: !(session.id in workspace.todos),
            progress:
              todos.length === 0
                ? undefined
                : {
                    completed: todos.filter(
                      (todo) => todo.status === "completed",
                    ).length,
                    total: todos.length,
                    updatedAt:
                      workspace.todoUpdatedAt?.[session.id] ??
                      session.time.updated,
                  },
          },
        ];
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [loadedDescendants, parentSessionId, reconciledStatuses, workspace]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentListWidth, setAgentListWidth] = useState<number | null>(null);
  const observeAgentListWidth = useCallback(
    (agentList: HTMLDivElement | null) => {
      if (!agentList) return;
      setAgentListWidth(agentList.clientWidth);
      const resizeObserver = new ResizeObserver(() =>
        setAgentListWidth(agentList.clientWidth),
      );
      resizeObserver.observe(agentList);
      return () => resizeObserver.disconnect();
    },
    [],
  );

  useEffect(() => {
    for (const agent of runningAgents) {
      if (agent.shouldHydrateTodos) {
        void fetchSessionTodos(agent.id, workspaceId);
      }
    }
  }, [fetchSessionTodos, runningAgents, workspaceId]);

  const selectedAgent = runningAgents.find(
    (agent) => agent.id === selectedAgentId,
  );
  const visibleAgentCount = getVisibleAgentCount(
    runningAgents.length,
    agentListWidth,
  );
  const visibleAgents = runningAgents.slice(0, visibleAgentCount);
  const overflowAgents = runningAgents.slice(visibleAgentCount);

  if (runningAgents.length === 0) return null;

  return (
    <>
      <section
        aria-label="Running sub-agents"
        className="shrink-0 border-b border-violet-500/20 bg-violet-500/10 px-4 py-1.5"
      >
        <div className="flex h-7 w-full min-w-0 items-center gap-2 overflow-hidden">
          <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-300">
            <Bot className="size-3.5" />
            <span>{runningAgents.length} running</span>
          </div>
          <div
            ref={observeAgentListWidth}
            className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
          >
            {visibleAgents.map((agent) => (
              <RunningAgentChip
                key={agent.id}
                sessionId={agent.id}
                title={agent.title}
                progress={agent.progress}
                onSelect={() => setSelectedAgentId(agent.id)}
              />
            ))}
            {overflowAgents.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="bg-background/70 hover:bg-background data-[state=open]:bg-background text-muted-foreground hover:text-foreground data-[state=open]:text-foreground flex shrink-0 items-center gap-1 rounded-md border border-violet-500/20 px-2 py-1 text-xs font-medium tabular-nums transition-colors"
                  >
                    +{overflowAgents.length} more
                    <ChevronDown className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-72 max-w-(--radix-dropdown-menu-content-available-width)"
                >
                  {overflowAgents.map((agent) => (
                    <RunningAgentMenuItem
                      key={agent.id}
                      sessionId={agent.id}
                      title={agent.title}
                      progress={agent.progress}
                      onSelect={() => setSelectedAgentId(agent.id)}
                    />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </section>

      <SubAgentDialog
        childSessionId={selectedAgent?.id ?? null}
        workspaceId={workspaceId}
        description={selectedAgent?.title ?? "Sub-agent"}
        isActive={selectedAgent !== undefined}
        open={selectedAgent !== undefined}
        onOpenChange={(open) => {
          if (!open) setSelectedAgentId(null);
        }}
      />
    </>
  );
}
