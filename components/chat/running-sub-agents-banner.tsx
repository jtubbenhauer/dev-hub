"use client";

import { Bot, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { SessionTaskProgressIndicator } from "@/components/chat/session-task-progress";
import { SubAgentDialog } from "@/components/chat/sub-agent-dialog";
import type { Session } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";

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
  const visibleAgents = runningAgents.slice(0, 2);
  const overflowCount = runningAgents.length - visibleAgents.length;

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
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {visibleAgents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className="bg-background/70 hover:bg-background flex max-w-64 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-violet-500/20 px-2 py-1 text-left transition-colors"
                onClick={() => setSelectedAgentId(agent.id)}
              >
                <Loader2 className="size-3 shrink-0 animate-spin text-violet-500 motion-reduce:animate-none" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {agent.title}
                </span>
                {agent.progress && (
                  <SessionTaskProgressIndicator
                    progress={agent.progress}
                    compact
                    isSessionActive
                  />
                )}
                <ChevronRight className="text-muted-foreground size-3 shrink-0" />
              </button>
            ))}
            {overflowCount > 0 && (
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                +{overflowCount} more
              </span>
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
