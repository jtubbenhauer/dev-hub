import type { Session } from "@/lib/opencode/types";

export interface SessionLineage {
  readonly rootSessionId: string;
  readonly rootSession: Session | null;
  readonly isResolved: boolean;
}

export interface SessionLineageResolver {
  resolveSync(
    workspaceId: string,
    sessionId: string,
    knownSessions: Readonly<Record<string, Session>>,
  ): SessionLineage | null;
  resolve(
    workspaceId: string,
    sessionId: string,
    knownSessions: Readonly<Record<string, Session>>,
  ): Promise<SessionLineage>;
  getCachedSessions(workspaceId: string): Readonly<Record<string, Session>>;
  forgetSession(workspaceId: string, sessionId: string): void;
  forgetWorkspace(workspaceId: string): void;
  reset(): void;
}

interface SessionLineageResolverDeps {
  readonly fetchSession: (
    workspaceId: string,
    sessionId: string,
  ) => Promise<Session | null>;
  readonly maxHops: number;
  readonly capacity: number;
}

function toCacheKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId}:${sessionId}`;
}

function unresolvedLineage(rootSessionId: string): SessionLineage {
  return { rootSessionId, rootSession: null, isResolved: false };
}

export function createSessionLineageResolver(
  deps: SessionLineageResolverDeps,
): SessionLineageResolver {
  const cache = new Map<string, Session>();
  const inFlight = new Map<string, Promise<Session | null>>();
  // Cancellation tokens: reset bumps epoch, forgetWorkspace bumps generation.
  let epoch = 0;
  const workspaceGenerations = new Map<string, number>();

  function lookup(
    workspaceId: string,
    sessionId: string,
    knownSessions: Readonly<Record<string, Session>>,
  ): Session | undefined {
    return (
      knownSessions[sessionId] ?? cache.get(toCacheKey(workspaceId, sessionId))
    );
  }

  function isCurrent(
    workspaceId: string,
    startEpoch: number,
    startGeneration: number,
  ): boolean {
    return (
      epoch === startEpoch &&
      (workspaceGenerations.get(workspaceId) ?? 0) === startGeneration
    );
  }

  function storeInCache(key: string, session: Session): void {
    cache.delete(key);
    cache.set(key, session);
    while (cache.size > deps.capacity) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) return;
      cache.delete(oldestKey);
    }
  }

  function fetchOnce(
    workspaceId: string,
    sessionId: string,
  ): Promise<Session | null> {
    const key = toCacheKey(workspaceId, sessionId);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = deps.fetchSession(workspaceId, sessionId).catch(() => null);
    inFlight.set(key, promise);
    void promise.finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
    return promise;
  }

  function resolveSync(
    workspaceId: string,
    sessionId: string,
    knownSessions: Readonly<Record<string, Session>>,
  ): SessionLineage | null {
    const visitedSessionIds = new Set([sessionId]);
    let current = sessionId;
    for (let hop = 0; hop < deps.maxHops; hop += 1) {
      const session = lookup(workspaceId, current, knownSessions);
      if (!session) return null;
      if (!session.parentID) {
        return {
          rootSessionId: session.id,
          rootSession: session,
          isResolved: true,
        };
      }
      if (visitedSessionIds.has(session.parentID)) {
        return {
          rootSessionId: current,
          rootSession: session,
          isResolved: true,
        };
      }
      visitedSessionIds.add(session.parentID);
      current = session.parentID;
    }
    return {
      rootSessionId: current,
      rootSession: lookup(workspaceId, current, knownSessions) ?? null,
      isResolved: false,
    };
  }

  async function resolve(
    workspaceId: string,
    sessionId: string,
    knownSessions: Readonly<Record<string, Session>>,
  ): Promise<SessionLineage> {
    const startEpoch = epoch;
    const startGeneration = workspaceGenerations.get(workspaceId) ?? 0;
    const visitedSessionIds = new Set([sessionId]);
    let current = sessionId;
    for (let hop = 0; hop < deps.maxHops; hop += 1) {
      let session = lookup(workspaceId, current, knownSessions);
      if (!session) {
        const fetchedSession = await fetchOnce(workspaceId, current);
        if (!isCurrent(workspaceId, startEpoch, startGeneration)) {
          return unresolvedLineage(current);
        }
        if (!fetchedSession) return unresolvedLineage(current);
        storeInCache(toCacheKey(workspaceId, current), fetchedSession);
        session = fetchedSession;
      }
      if (!session.parentID) {
        return {
          rootSessionId: session.id,
          rootSession: session,
          isResolved: true,
        };
      }
      if (visitedSessionIds.has(session.parentID)) {
        return {
          rootSessionId: current,
          rootSession: session,
          isResolved: true,
        };
      }
      visitedSessionIds.add(session.parentID);
      current = session.parentID;
    }
    return {
      rootSessionId: current,
      rootSession: lookup(workspaceId, current, knownSessions) ?? null,
      isResolved: false,
    };
  }

  function getCachedSessions(
    workspaceId: string,
  ): Readonly<Record<string, Session>> {
    const prefix = `${workspaceId}:`;
    const cachedSessions: Record<string, Session> = {};
    for (const [key, session] of cache) {
      if (key.startsWith(prefix)) {
        cachedSessions[key.slice(prefix.length)] = session;
      }
    }
    return cachedSessions;
  }

  function forgetSession(workspaceId: string, sessionId: string): void {
    cache.delete(toCacheKey(workspaceId, sessionId));
  }

  function forgetWorkspace(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    for (const key of [...cache.keys()]) {
      if (key.startsWith(prefix)) cache.delete(key);
    }
    workspaceGenerations.set(
      workspaceId,
      (workspaceGenerations.get(workspaceId) ?? 0) + 1,
    );
  }

  function reset(): void {
    cache.clear();
    inFlight.clear();
    workspaceGenerations.clear();
    epoch += 1;
  }

  return {
    resolveSync,
    resolve,
    getCachedSessions,
    forgetSession,
    forgetWorkspace,
    reset,
  };
}
