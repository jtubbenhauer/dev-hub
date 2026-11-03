import { getDescendantActivity } from "@/lib/chat/descendant-activity";
import type {
  MessageWithParts,
  SessionStatus,
  Todo,
} from "@/lib/opencode/types";
import type { StreamingStatus, WorkspaceState } from "@/stores/chat-store";

// Stable empty references to avoid infinite re-render loops with Zustand selectors.
// chat-store re-exports these, so its getters and these selectors share them.
export const EMPTY_MESSAGES: MessageWithParts[] = [];
export const EMPTY_TODOS: Todo[] = [];

export interface SessionRef {
  readonly workspaceId: string;
  readonly sessionId: string;
}

// Ref-counted on-screen chat sessions, keyed by visibleSessionKey().
export type VisibleSessionKeys = Readonly<Record<string, number>>;

export interface SessionScopedChatState {
  readonly workspaceStates: Readonly<Record<string, WorkspaceState>>;
  readonly optimisticStreamingSessionId: string | null;
  readonly streamingError: string | null;
  readonly activeWorkspaceId: string | null;
  readonly activeSessionId: string | null;
  readonly visibleSessionKeys: VisibleSessionKeys;
  readonly sseWorkspaceIds: readonly string[];
}

export interface StreamingStatusOptions {
  readonly isActiveSession: boolean;
  readonly now: number;
}

export type SessionSelector<Selected> = (
  state: Pick<SessionScopedChatState, "workspaceStates">,
) => Selected;

export interface MessageCacheEvictionPlan<Entry extends SessionRef> {
  readonly kept: Entry[];
  readonly evicted: Entry[];
}

type StreamingStatusSource = Pick<
  SessionScopedChatState,
  "workspaceStates" | "optimisticStreamingSessionId" | "streamingError"
>;

type OnScreenSource = Pick<
  SessionScopedChatState,
  "activeWorkspaceId" | "activeSessionId" | "visibleSessionKeys"
>;

type RefetchSource = OnScreenSource &
  Pick<SessionScopedChatState, "sseWorkspaceIds">;

type SessionStreamingStatusSource = StreamingStatusSource &
  Pick<SessionScopedChatState, "activeWorkspaceId" | "activeSessionId">;

export function computeStreamingStatus(
  state: StreamingStatusSource,
  workspaceId: string,
  sessionId: string,
  options: StreamingStatusOptions,
): StreamingStatus {
  const { workspaceStates, optimisticStreamingSessionId, streamingError } =
    state;

  // Error state takes priority — cleared explicitly when user dismisses or SSE reconnects.
  // It belongs to the focused session; other sessions keep their own status.
  if (streamingError && options.isActiveSession) return "error";

  const ws = workspaceStates[workspaceId];
  if (!ws) return "idle";

  // Pending question or permission for this session → waiting for user input
  if (ws.questions.some((q) => q.sessionID === sessionId)) return "waiting";
  if (ws.permissions.some((p) => p.sessionID === sessionId)) return "waiting";

  // SSE-confirmed non-idle session status → streaming
  const sessionStatus = ws.sessionStatuses[sessionId];
  if (sessionStatus && sessionStatus.type !== "idle") return "streaming";

  // Optimistic: sendMessage fired but first SSE hasn't arrived yet
  if (optimisticStreamingSessionId === sessionId) return "streaming";

  const descendantActivity = getDescendantActivity({
    parentSessionId: sessionId,
    sessions: ws.sessions,
    statuses: ws.sessionStatuses,
    permissions: ws.permissions,
    questions: ws.questions,
    now: options.now,
    recentWindowMs: 30_000,
  });
  if (
    descendantActivity.activeCount > 0 ||
    descendantActivity.waitingCount > 0
  ) {
    return "streaming";
  }

  return "idle";
}

export function selectSessionMessages(
  workspaceId: string | null,
  sessionId: string | null,
): SessionSelector<MessageWithParts[]> {
  return (state) => {
    if (!workspaceId || !sessionId) return EMPTY_MESSAGES;
    return (
      state.workspaceStates[workspaceId]?.messages[sessionId] ?? EMPTY_MESSAGES
    );
  };
}

export function selectSessionTodos(
  workspaceId: string | null,
  sessionId: string | null,
): SessionSelector<Todo[]> {
  return (state) => {
    if (!workspaceId || !sessionId) return EMPTY_TODOS;
    return state.workspaceStates[workspaceId]?.todos[sessionId] ?? EMPTY_TODOS;
  };
}

export function selectSessionStatus(
  workspaceId: string | null,
  sessionId: string | null,
): SessionSelector<SessionStatus | null> {
  return (state) => {
    if (!workspaceId || !sessionId) return null;
    return (
      state.workspaceStates[workspaceId]?.sessionStatuses[sessionId] ?? null
    );
  };
}

// The streaming error belongs to the active chat, which may be a new chat
// without a session yet; every other session reports its own status.
export function selectSessionStreamingStatus(
  workspaceId: string | null,
  sessionId: string | null,
): (state: SessionStreamingStatusSource) => StreamingStatus {
  return (state) => {
    const isActiveSession =
      state.activeWorkspaceId === workspaceId &&
      state.activeSessionId === sessionId;
    if (!workspaceId || !sessionId) {
      return isActiveSession && state.streamingError ? "error" : "idle";
    }
    return computeStreamingStatus(state, workspaceId, sessionId, {
      isActiveSession,
      now: Date.now(),
    });
  };
}

export function visibleSessionKey(
  workspaceId: string,
  sessionId: string,
): string {
  return `${workspaceId}:${sessionId}`;
}

export function visibleSessionIdsInWorkspace(
  visibleSessionKeys: VisibleSessionKeys,
  workspaceId: string,
): string[] {
  const workspacePrefix = `${workspaceId}:`;
  return Object.keys(visibleSessionKeys)
    .filter((key) => key.startsWith(workspacePrefix))
    .map((key) => key.slice(workspacePrefix.length));
}

export function addVisibleSession(
  visibleSessionKeys: VisibleSessionKeys,
  workspaceId: string,
  sessionId: string,
): Record<string, number> {
  const key = visibleSessionKey(workspaceId, sessionId);
  return { ...visibleSessionKeys, [key]: (visibleSessionKeys[key] ?? 0) + 1 };
}

export function removeVisibleSession(
  visibleSessionKeys: VisibleSessionKeys,
  workspaceId: string,
  sessionId: string,
): Record<string, number> {
  const key = visibleSessionKey(workspaceId, sessionId);
  const count = visibleSessionKeys[key] ?? 0;
  if (count > 1) return { ...visibleSessionKeys, [key]: count - 1 };
  const { [key]: _released, ...remaining } = visibleSessionKeys;
  return remaining;
}

export function listOnScreenSessionIds(
  state: OnScreenSource,
  workspaceId: string,
): string[] {
  const visibleSessionIds = visibleSessionIdsInWorkspace(
    state.visibleSessionKeys,
    workspaceId,
  );
  const { activeWorkspaceId, activeSessionId } = state;
  if (activeWorkspaceId !== workspaceId || activeSessionId === null) {
    return visibleSessionIds;
  }
  return [
    activeSessionId,
    ...visibleSessionIds.filter((sessionId) => sessionId !== activeSessionId),
  ];
}

// Visible sessions other than the active one, in workspaces the event stream covers.
export function listVisibleSessionsToRefetch(
  state: RefetchSource,
): SessionRef[] {
  const { activeWorkspaceId, activeSessionId } = state;
  return state.sseWorkspaceIds.flatMap((workspaceId) =>
    visibleSessionIdsInWorkspace(state.visibleSessionKeys, workspaceId)
      .filter(
        (sessionId) =>
          workspaceId !== activeWorkspaceId || sessionId !== activeSessionId,
      )
      .map((sessionId) => ({ workspaceId, sessionId })),
  );
}

// Evicts the oldest hidden entries until the list fits; visible entries are
// never evicted and may keep the list above maxCachedSessions.
export function planMessageCacheEviction<Entry extends SessionRef>(
  accessOrder: readonly Entry[],
  visibleSessionKeys: VisibleSessionKeys,
  maxCachedSessions: number,
): MessageCacheEvictionPlan<Entry> {
  const evictedIndexes = new Set<number>();
  let excessCount = accessOrder.length - maxCachedSessions;
  // Index 0 is the session that was just touched, so it always stays.
  for (
    let index = accessOrder.length - 1;
    index > 0 && excessCount > 0;
    index -= 1
  ) {
    const { workspaceId, sessionId } = accessOrder[index];
    const visibleCount =
      visibleSessionKeys[visibleSessionKey(workspaceId, sessionId)] ?? 0;
    if (visibleCount > 0) continue;
    evictedIndexes.add(index);
    excessCount -= 1;
  }
  return {
    kept: accessOrder.filter((_, index) => !evictedIndexes.has(index)),
    evicted: accessOrder.filter((_, index) => evictedIndexes.has(index)),
  };
}
