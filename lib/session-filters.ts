export type SessionAgeFilter = "1d" | "1w" | "all";

interface SessionLoadState {
  readonly sessionsLoaded: boolean;
}

interface UnifiedFallbackCandidate {
  readonly id: string;
  readonly workspaceId: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

export function parseSessionAgeFilter(value: string | null): SessionAgeFilter {
  if (value === "1d" || value === "1w" || value === "all") return value;
  return "all";
}

export function getSessionAgeCutoff(
  filter: SessionAgeFilter,
  now: number = Date.now(),
): number | null {
  if (filter === "1d") return now - ONE_DAY_MS;
  if (filter === "1w") return now - ONE_WEEK_MS;
  return null;
}

interface SessionAgeFilterable {
  id: string;
  time: { updated: number };
}

export function filterSessionsByAge<T extends SessionAgeFilterable>(
  sessions: readonly T[],
  filter: SessionAgeFilter,
  pinnedSessionIds?: ReadonlySet<string>,
  now: number = Date.now(),
): T[] {
  const cutoff = getSessionAgeCutoff(filter, now);
  if (cutoff === null) return [...sessions];
  return sessions.filter((session) => {
    if (pinnedSessionIds?.has(session.id)) return true;
    return session.time.updated >= cutoff;
  });
}

export function isSessionListLoading(
  workspaceStates: Readonly<Record<string, SessionLoadState | undefined>>,
  activeWorkspaceId: string | null,
): boolean {
  if (!activeWorkspaceId) return false;
  return !workspaceStates[activeWorkspaceId]?.sessionsLoaded;
}

export function getUnifiedFallbackSession<T extends UnifiedFallbackCandidate>(
  isUnifiedMode: boolean,
  activeSessionId: string | null,
  sessions: readonly T[],
  urlSessionId: string | null,
): T | null {
  if (!isUnifiedMode || activeSessionId || urlSessionId) return null;
  if (sessions.length === 0) return null;
  return sessions[0];
}

interface RootSessionCandidate {
  readonly parentID?: string;
}

type SessionsById = Readonly<Record<string, RootSessionCandidate>>;

// Counting runs on every store write, and those stream in many times a
// second, so each workspace's count is cached on its sessions map.
const rootSessionCountBySessions = new WeakMap<SessionsById, number>();

export function countRootSessions(
  workspaceStates: Readonly<
    Record<string, { readonly sessions: SessionsById }>
  >,
): number {
  let total = 0;
  for (const { sessions } of Object.values(workspaceStates)) {
    let count = rootSessionCountBySessions.get(sessions);
    if (count === undefined) {
      count = 0;
      for (const session of Object.values(sessions)) {
        if (!session.parentID) count += 1;
      }
      rootSessionCountBySessions.set(sessions, count);
    }
    total += count;
  }
  return total;
}
