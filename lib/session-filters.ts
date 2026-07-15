export type SessionAgeFilter = "1d" | "1w" | "all";

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
