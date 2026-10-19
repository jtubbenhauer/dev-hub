import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { SessionSubAgentCount } from "@/components/chat/session-sub-agent-count";
import type { SessionTaskProgress } from "@/components/chat/session-task-progress";
import {
  buildChildSessionIndex,
  getDescendantActivity,
} from "@/lib/chat/descendant-activity";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";

interface SessionListActivityScope {
  readonly isUnifiedMode: boolean;
  readonly activeWorkspaceId: string | null;
}

type SummarizedSlice =
  | "sessions"
  | "sessionStatuses"
  | "todos"
  | "todoUpdatedAt"
  | "questions"
  | "permissions";

type SliceByWorkspace<Slice extends SummarizedSlice> = Readonly<
  Record<string, WorkspaceState[Slice]>
>;

interface SummarizedWorkspaces {
  readonly sessions: SliceByWorkspace<"sessions">;
  readonly sessionStatuses: SliceByWorkspace<"sessionStatuses">;
  readonly todos: SliceByWorkspace<"todos">;
  readonly todoUpdatedAt: SliceByWorkspace<"todoUpdatedAt">;
  readonly questions: SliceByWorkspace<"questions">;
  readonly permissions: SliceByWorkspace<"permissions">;
}

type WorkspaceTaskProgressInputs = Readonly<
  Pick<WorkspaceState, "sessions" | "todos" | "todoUpdatedAt">
>;

type WorkspaceSessionActivityInputs = Readonly<
  Pick<
    WorkspaceState,
    "sessions" | "sessionStatuses" | "todos" | "questions" | "permissions"
  >
>;

export interface SubAgentTodoHydration {
  readonly sessionId: string;
  readonly workspaceId: string;
}

export interface SessionListActivity {
  readonly taskProgressBySessionId: Readonly<
    Record<string, SessionTaskProgress>
  >;
  readonly taskActiveSessionIds: ReadonlySet<string>;
  readonly subAgentCountBySessionId: Readonly<
    Record<string, SessionSubAgentCount>
  >;
  readonly subAgentTodoHydration: readonly SubAgentTodoHydration[];
}

interface WorkspaceSessionActivity {
  readonly taskActiveSessionIds: readonly string[];
  readonly subAgentCountBySessionId: SessionListActivity["subAgentCountBySessionId"];
  readonly subAgentTodoHydration: readonly SubAgentTodoHydration[];
}

interface CachedTaskProgress {
  readonly inputs: WorkspaceTaskProgressInputs;
  readonly progress: SessionListActivity["taskProgressBySessionId"];
}

interface CachedSessionActivity {
  readonly inputs: WorkspaceSessionActivityInputs;
  readonly activity: WorkspaceSessionActivity;
}

// Cached per workspace, so an update in one workspace re-walks only that one.
// The previous summary also supplies the badge objects to reuse, so memoized
// rows whose badges did not change skip re-rendering. Workspaces that leave
// the scope are dropped, which keeps both maps bounded.
const taskProgressByWorkspaceId = new Map<string, CachedTaskProgress>();
const sessionActivityByWorkspaceId = new Map<string, CachedSessionActivity>();

// A slice keeps its identity until that slice changes, so useShallow ignores
// the message writes that stream into the store many times a second.
function useSliceByWorkspace<Slice extends SummarizedSlice>(
  scope: SessionListActivityScope,
  slice: Slice,
): SliceByWorkspace<Slice> {
  const { isUnifiedMode, activeWorkspaceId } = scope;
  return useChatStore(
    useShallow((state) => {
      const slices: Record<string, WorkspaceState[Slice]> = {};
      for (const [workspaceId, workspace] of Object.entries(
        state.workspaceStates,
      )) {
        if (isUnifiedMode || workspaceId === activeWorkspaceId) {
          slices[workspaceId] = workspace[slice];
        }
      }
      return slices;
    }),
  );
}

function isSameTaskProgress(
  previous: SessionTaskProgress,
  next: SessionTaskProgress,
): boolean {
  return (
    previous.completed === next.completed &&
    previous.total === next.total &&
    previous.updatedAt === next.updatedAt
  );
}

function isSameSubAgentCount(
  previous: SessionSubAgentCount,
  next: SessionSubAgentCount,
): boolean {
  return (
    previous.active === next.active &&
    previous.waiting === next.waiting &&
    previous.progress?.completed === next.progress?.completed &&
    previous.progress?.total === next.progress?.total
  );
}

function summarizeWorkspaceTaskProgress(
  workspaceId: string,
  inputs: WorkspaceTaskProgressInputs,
): SessionListActivity["taskProgressBySessionId"] {
  const cached = taskProgressByWorkspaceId.get(workspaceId);
  if (
    cached &&
    cached.inputs.sessions === inputs.sessions &&
    cached.inputs.todos === inputs.todos &&
    cached.inputs.todoUpdatedAt === inputs.todoUpdatedAt
  ) {
    return cached.progress;
  }

  const progress: Record<string, SessionTaskProgress> = {};
  for (const [sessionId, todos] of Object.entries(inputs.todos)) {
    if (todos.length === 0) continue;
    const next: SessionTaskProgress = {
      completed: todos.filter((todo) => todo.status === "completed").length,
      total: todos.length,
      updatedAt:
        inputs.todoUpdatedAt?.[sessionId] ??
        inputs.sessions[sessionId]?.time.updated,
    };
    const previous = cached?.progress[sessionId];
    progress[sessionId] =
      previous && isSameTaskProgress(previous, next) ? previous : next;
  }
  taskProgressByWorkspaceId.set(workspaceId, { inputs, progress });
  return progress;
}

function summarizeWorkspaceSessionActivity(
  workspaceId: string,
  inputs: WorkspaceSessionActivityInputs,
): WorkspaceSessionActivity {
  const cached = sessionActivityByWorkspaceId.get(workspaceId);
  if (
    cached &&
    cached.inputs.sessions === inputs.sessions &&
    cached.inputs.sessionStatuses === inputs.sessionStatuses &&
    cached.inputs.todos === inputs.todos &&
    cached.inputs.questions === inputs.questions &&
    cached.inputs.permissions === inputs.permissions
  ) {
    return cached.activity;
  }

  const taskActiveSessionIds: string[] = [];
  const subAgentCountBySessionId: Record<string, SessionSubAgentCount> = {};
  const subAgentTodoHydration: SubAgentTodoHydration[] = [];
  const now = Date.now();
  const childSessionIndex = buildChildSessionIndex(inputs.sessions);

  for (const session of Object.values(inputs.sessions)) {
    if (session.parentID) continue;
    const status = inputs.sessionStatuses[session.id];
    const hasDirectActivity =
      status?.type === "busy" ||
      status?.type === "retry" ||
      inputs.questions.some((question) => question.sessionID === session.id);
    const descendantActivity = getDescendantActivity({
      parentSessionId: session.id,
      sessions: inputs.sessions,
      statuses: inputs.sessionStatuses,
      permissions: inputs.permissions,
      questions: inputs.questions,
      now,
      recentWindowMs: 0,
      childSessionIndex,
    });
    const hasDescendantActivity =
      descendantActivity.activeCount > 0 || descendantActivity.waitingCount > 0;
    if (hasDescendantActivity) {
      let completed = 0;
      let total = 0;
      for (const descendantId of descendantActivity.activeSessionIds) {
        const descendantTodos = inputs.todos[descendantId];
        if (!descendantTodos) {
          subAgentTodoHydration.push({
            sessionId: descendantId,
            workspaceId,
          });
          continue;
        }
        total += descendantTodos.length;
        completed += descendantTodos.filter(
          (todo) => todo.status === "completed",
        ).length;
      }
      const next: SessionSubAgentCount = {
        active: descendantActivity.activeCount,
        waiting: descendantActivity.waitingCount,
        ...(total > 0 ? { progress: { completed, total } } : {}),
      };
      const previous = cached?.activity.subAgentCountBySessionId[session.id];
      subAgentCountBySessionId[session.id] =
        previous && isSameSubAgentCount(previous, next) ? previous : next;
    }
    if (hasDirectActivity || hasDescendantActivity) {
      taskActiveSessionIds.push(session.id);
    }
  }

  const activity = {
    taskActiveSessionIds,
    subAgentCountBySessionId,
    subAgentTodoHydration,
  };
  sessionActivityByWorkspaceId.set(workspaceId, { inputs, activity });
  return activity;
}

function summarizeTaskProgress(
  workspaces: Pick<
    SummarizedWorkspaces,
    "sessions" | "todos" | "todoUpdatedAt"
  >,
): Record<string, SessionTaskProgress> {
  for (const workspaceId of taskProgressByWorkspaceId.keys()) {
    if (!(workspaceId in workspaces.todos)) {
      taskProgressByWorkspaceId.delete(workspaceId);
    }
  }
  const progress: Record<string, SessionTaskProgress> = {};
  for (const [workspaceId, todos] of Object.entries(workspaces.todos)) {
    Object.assign(
      progress,
      summarizeWorkspaceTaskProgress(workspaceId, {
        sessions: workspaces.sessions[workspaceId],
        todos,
        todoUpdatedAt: workspaces.todoUpdatedAt[workspaceId],
      }),
    );
  }
  return progress;
}

function summarizeSessionActivity(
  workspaces: Omit<SummarizedWorkspaces, "todoUpdatedAt">,
): Omit<SessionListActivity, "taskProgressBySessionId"> {
  for (const workspaceId of sessionActivityByWorkspaceId.keys()) {
    if (!(workspaceId in workspaces.sessions)) {
      sessionActivityByWorkspaceId.delete(workspaceId);
    }
  }
  const taskActiveSessionIds = new Set<string>();
  const subAgentCountBySessionId: Record<string, SessionSubAgentCount> = {};
  const subAgentTodoHydration: SubAgentTodoHydration[] = [];
  for (const [workspaceId, sessions] of Object.entries(workspaces.sessions)) {
    const activity = summarizeWorkspaceSessionActivity(workspaceId, {
      sessions,
      sessionStatuses: workspaces.sessionStatuses[workspaceId],
      todos: workspaces.todos[workspaceId],
      questions: workspaces.questions[workspaceId],
      permissions: workspaces.permissions[workspaceId],
    });
    for (const sessionId of activity.taskActiveSessionIds) {
      taskActiveSessionIds.add(sessionId);
    }
    Object.assign(subAgentCountBySessionId, activity.subAgentCountBySessionId);
    subAgentTodoHydration.push(...activity.subAgentTodoHydration);
  }

  return {
    taskActiveSessionIds,
    subAgentCountBySessionId,
    subAgentTodoHydration,
  };
}

export function useSessionListActivity(
  scope: SessionListActivityScope,
): SessionListActivity {
  const sessions = useSliceByWorkspace(scope, "sessions");
  const sessionStatuses = useSliceByWorkspace(scope, "sessionStatuses");
  const todos = useSliceByWorkspace(scope, "todos");
  const todoUpdatedAt = useSliceByWorkspace(scope, "todoUpdatedAt");
  const questions = useSliceByWorkspace(scope, "questions");
  const permissions = useSliceByWorkspace(scope, "permissions");

  const taskProgressBySessionId = useMemo(
    () => summarizeTaskProgress({ sessions, todos, todoUpdatedAt }),
    [sessions, todos, todoUpdatedAt],
  );
  const sessionActivity = useMemo(
    () =>
      summarizeSessionActivity({
        sessions,
        sessionStatuses,
        todos,
        questions,
        permissions,
      }),
    [sessions, sessionStatuses, todos, questions, permissions],
  );

  return { taskProgressBySessionId, ...sessionActivity };
}
