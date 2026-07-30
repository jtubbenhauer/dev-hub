import type {
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
} from "@/lib/opencode/types";

export interface DescendantActivity {
  readonly activeCount: number;
  readonly waitingCount: number;
  readonly recentCount: number;
}

interface DescendantActivityOptions {
  readonly parentSessionId: string;
  readonly sessions: Readonly<Record<string, Session>>;
  readonly statuses: Readonly<Record<string, SessionStatus>>;
  readonly permissions: readonly PermissionRequest[];
  readonly questions: readonly QuestionRequest[];
  readonly now: number;
  readonly recentWindowMs: number;
}

export function getDescendantActivity(
  options: DescendantActivityOptions,
): DescendantActivity {
  const childrenByParent = new Map<string, string[]>();
  for (const session of Object.values(options.sessions)) {
    if (!session.parentID) continue;
    const children = childrenByParent.get(session.parentID) ?? [];
    children.push(session.id);
    childrenByParent.set(session.parentID, children);
  }

  const waitingSessionIds = new Set([
    ...options.permissions.map((permission) => permission.sessionID),
    ...options.questions.map((question) => question.sessionID),
  ]);
  const visited = new Set([options.parentSessionId]);
  const pending = [...(childrenByParent.get(options.parentSessionId) ?? [])];
  let activeCount = 0;
  let waitingCount = 0;
  let recentCount = 0;

  while (pending.length > 0) {
    const sessionId = pending.pop();
    if (!sessionId || visited.has(sessionId)) continue;
    visited.add(sessionId);
    pending.push(...(childrenByParent.get(sessionId) ?? []));

    if (waitingSessionIds.has(sessionId)) {
      waitingCount += 1;
      continue;
    }
    const status = options.statuses[sessionId];
    if (status && status.type !== "idle") {
      activeCount += 1;
      continue;
    }
    const session = options.sessions[sessionId];
    if (
      session &&
      session.time.updated >= options.now - options.recentWindowMs
    ) {
      recentCount += 1;
    }
  }

  return { activeCount, waitingCount, recentCount };
}

export function formatDescendantActivity(
  activity: DescendantActivity,
): string | null {
  if (activity.waitingCount > 0) {
    return `${activity.waitingCount} ${activity.waitingCount === 1 ? "subagent" : "subagents"} waiting for input`;
  }
  if (activity.activeCount > 0) {
    return `${activity.activeCount} ${activity.activeCount === 1 ? "subagent" : "subagents"} working`;
  }
  if (activity.recentCount > 0) {
    return `${activity.recentCount} ${activity.recentCount === 1 ? "subagent" : "subagents"} recently active`;
  }
  return null;
}
