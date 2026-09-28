export interface RetentionSession {
  readonly id: string;
  readonly parentId: string | null;
  readonly timeUpdated: number;
  readonly directory: string;
  readonly title: string;
}

export interface SessionRetentionPlan {
  readonly keepSessionIds: string[];
  readonly deleteSessionIds: string[];
  readonly deleteRootIds: string[];
}

interface PlanSessionRetentionInput {
  readonly sessions: readonly RetentionSession[];
  readonly cutoff: number;
}

export function calculateRetentionCutoff(now: Date, months: number): number {
  const targetMonthStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - months,
      1,
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
  const lastTargetDay = new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  targetMonthStart.setUTCDate(Math.min(now.getUTCDate(), lastTargetDay));
  return targetMonthStart.getTime();
}

export function planSessionRetention({
  sessions,
  cutoff,
}: PlanSessionRetentionInput): SessionRetentionPlan {
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  if (sessionsById.size !== sessions.length) {
    throw new Error("Session graph contains duplicate IDs");
  }
  for (const session of sessions) {
    const visited = new Set([session.id]);
    let parentId = session.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        throw new Error(`Session graph contains a cycle at ${parentId}`);
      }
      visited.add(parentId);
      parentId = sessionsById.get(parentId)?.parentId ?? null;
    }
  }
  const keepSessionIds: string[] = [];
  const keepSessionIdSet = new Set<string>();

  const keep = (sessionId: string): void => {
    if (keepSessionIdSet.has(sessionId)) return;
    keepSessionIdSet.add(sessionId);
    keepSessionIds.push(sessionId);
  };

  for (const session of sessions) {
    if (session.timeUpdated < cutoff) continue;
    keep(session.id);
    const visited = new Set([session.id]);
    let parentId = session.parentId;
    while (parentId) {
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const parent = sessionsById.get(parentId);
      if (!parent) break;
      keep(parent.id);
      parentId = parent.parentId;
    }
  }

  const deleteSessionIds = sessions
    .filter((session) => !keepSessionIdSet.has(session.id))
    .map((session) => session.id);
  const deleteSessionIdSet = new Set(deleteSessionIds);
  const deleteRootIds = sessions
    .filter((session) => {
      if (!deleteSessionIdSet.has(session.id)) return false;
      if (!session.parentId) return true;
      return !deleteSessionIdSet.has(session.parentId);
    })
    .map((session) => session.id);

  const reachableDeleteIds = new Set<string>();
  const childrenByParent = new Map<string, string[]>();
  for (const session of sessions) {
    if (!session.parentId || !deleteSessionIdSet.has(session.id)) continue;
    const children = childrenByParent.get(session.parentId) ?? [];
    children.push(session.id);
    childrenByParent.set(session.parentId, children);
  }
  const pending = [...deleteRootIds];
  while (pending.length > 0) {
    const sessionId = pending.pop();
    if (!sessionId || reachableDeleteIds.has(sessionId)) continue;
    reachableDeleteIds.add(sessionId);
    pending.push(...(childrenByParent.get(sessionId) ?? []));
  }
  if (reachableDeleteIds.size !== deleteSessionIds.length) {
    throw new Error("Deletion plan does not cover every old session");
  }

  return { keepSessionIds, deleteSessionIds, deleteRootIds };
}
