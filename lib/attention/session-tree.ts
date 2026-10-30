import { getDescendantActivity } from "@/lib/chat/descendant-activity";
import type {
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
} from "@/lib/opencode/types";

const MAX_ROOT_WALK_HOPS = 50;

export function findRootSessionId(
  sessions: Readonly<Record<string, Session>>,
  sessionId: string,
): string {
  const visitedSessionIds = new Set([sessionId]);
  let current = sessionId;
  for (let hop = 0; hop < MAX_ROOT_WALK_HOPS; hop += 1) {
    const parentID = sessions[current]?.parentID;
    if (!parentID) return current;
    if (visitedSessionIds.has(parentID)) return current;
    visitedSessionIds.add(parentID);
    current = parentID;
  }
  return current;
}

export interface SessionTreeSnapshot {
  readonly sessions: Readonly<Record<string, Session>>;
  readonly statuses: Readonly<Record<string, SessionStatus>>;
  readonly permissions: readonly PermissionRequest[];
  readonly questions: readonly QuestionRequest[];
}

export interface SessionTreeSettleResult {
  readonly isSettled: boolean;
  readonly isRootIdle: boolean;
  readonly hasPendingPrompt: boolean;
  readonly busyDescendantIds: readonly string[];
}

export function evaluateSessionTreeSettle(
  tree: SessionTreeSnapshot,
  rootSessionId: string,
): SessionTreeSettleResult {
  const isRootIdle = (tree.statuses[rootSessionId]?.type ?? "idle") === "idle";
  const activity = getDescendantActivity({
    parentSessionId: rootSessionId,
    sessions: tree.sessions,
    statuses: tree.statuses,
    permissions: tree.permissions,
    questions: tree.questions,
    now: 0,
    recentWindowMs: 0,
  });
  const hasPendingPrompt =
    tree.permissions.some(
      (permission) => permission.sessionID === rootSessionId,
    ) ||
    tree.questions.some((question) => question.sessionID === rootSessionId) ||
    activity.waitingCount > 0;
  // activeSessionIds also holds waiting descendants; keep only status-busy ones.
  const busyDescendantIds = activity.activeSessionIds.filter(
    (sessionId) => (tree.statuses[sessionId]?.type ?? "idle") !== "idle",
  );
  const isSettled =
    isRootIdle && !hasPendingPrompt && activity.activeCount === 0;
  return { isSettled, isRootIdle, hasPendingPrompt, busyDescendantIds };
}
