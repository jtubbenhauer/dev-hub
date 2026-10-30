import type {
  SessionLineage,
  SessionLineageResolver,
} from "@/lib/attention/session-lineage";
import {
  evaluateSessionTreeSettle,
  type SessionTreeSnapshot,
} from "@/lib/attention/session-tree";
import { engineForSessionId } from "@/lib/engine/types";

export const TURN_SETTLE_DELAY_MS = 2500;
export const TURN_ANNOUNCE_DEDUP_WINDOW_MS = 5000;
export const MAX_TRACKED_ROOTS = 500;

export interface TurnCompletionTrackerDeps {
  readonly settleDelayMs: number;
  readonly readWorkspaceTree: (
    workspaceId: string,
  ) => SessionTreeSnapshot | null;
  readonly lineage: SessionLineageResolver;
  readonly reconcileWorkspaceStatuses: (
    workspaceId: string,
  ) => Promise<boolean>;
  readonly onTreeSettled: (
    workspaceId: string,
    lineage: SessionLineage,
  ) => void;
  readonly now: () => number;
}

export interface TurnCompletionTracker {
  handleSessionSettled(workspaceId: string, sessionId: string): void;
  handleSessionBusy(workspaceId: string, sessionId: string): void;
  forgetSession(workspaceId: string, sessionId: string): void;
  forgetWorkspace(workspaceId: string): void;
  reset(): void;
}

interface CancellationToken {
  readonly epoch: number;
  readonly generation: number;
}

function toRootKey(workspaceId: string, rootSessionId: string): string {
  return `${workspaceId}:${rootSessionId}`;
}

export function createTurnCompletionTracker(
  deps: TurnCompletionTrackerDeps,
): TurnCompletionTracker {
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastAnnouncedAt = new Map<string, number>();
  const verificationsInFlight = new Map<string, Promise<boolean>>();
  // Cancellation tokens: reset bumps epoch, forgetWorkspace bumps generation.
  let epoch = 0;
  const workspaceGenerations = new Map<string, number>();

  function captureToken(workspaceId: string): CancellationToken {
    return { epoch, generation: workspaceGenerations.get(workspaceId) ?? 0 };
  }

  function isTokenCurrent(
    workspaceId: string,
    token: CancellationToken,
  ): boolean {
    return (
      token.epoch === epoch &&
      token.generation === (workspaceGenerations.get(workspaceId) ?? 0)
    );
  }

  function clearPendingTimer(key: string): void {
    const timer = pendingTimers.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    pendingTimers.delete(key);
  }

  function announce(workspaceId: string, lineage: SessionLineage): void {
    const key = toRootKey(workspaceId, lineage.rootSessionId);
    const now = deps.now();
    const previous = lastAnnouncedAt.get(key);
    if (
      previous !== undefined &&
      now - previous < TURN_ANNOUNCE_DEDUP_WINDOW_MS
    ) {
      return;
    }
    lastAnnouncedAt.delete(key);
    lastAnnouncedAt.set(key, now);
    if (lastAnnouncedAt.size > MAX_TRACKED_ROOTS) {
      const oldestKey = lastAnnouncedAt.keys().next().value;
      if (oldestKey !== undefined) lastAnnouncedAt.delete(oldestKey);
    }
    deps.onTreeSettled(workspaceId, lineage);
  }

  function startOrReuseVerification(workspaceId: string): Promise<boolean> {
    const inFlight = verificationsInFlight.get(workspaceId);
    if (inFlight) return inFlight;
    const promise = deps.reconcileWorkspaceStatuses(workspaceId);
    verificationsInFlight.set(workspaceId, promise);
    void promise
      .finally(() => {
        if (verificationsInFlight.get(workspaceId) === promise) {
          verificationsInFlight.delete(workspaceId);
        }
      })
      .catch(() => {});
    return promise;
  }

  function evaluate(
    workspaceId: string,
    lineage: SessionLineage,
    isVerificationAllowed: boolean,
  ): void {
    const token = captureToken(workspaceId);
    const tree = deps.readWorkspaceTree(workspaceId);
    if (!tree) return;
    const sessions = {
      ...deps.lineage.getCachedSessions(workspaceId),
      ...tree.sessions,
    };
    const result = evaluateSessionTreeSettle(
      { ...tree, sessions },
      lineage.rootSessionId,
    );
    // Unknown after a page reload or for a lineage-fetched root.
    const isRootStatusUnknown =
      tree.statuses[lineage.rootSessionId] === undefined;
    const needsVerification =
      isVerificationAllowed &&
      result.isRootIdle &&
      !result.hasPendingPrompt &&
      (result.busyDescendantIds.length > 0 || isRootStatusUnknown);
    if (needsVerification) {
      void startOrReuseVerification(workspaceId)
        .then((isApplied) => {
          if (!isTokenCurrent(workspaceId, token)) return;
          // Unanswered checks fail open only for the unknown-root doubt.
          if (isApplied || isRootStatusUnknown) {
            evaluate(workspaceId, lineage, false);
          }
        })
        .catch(() => {});
      return;
    }
    if (result.isSettled) announce(workspaceId, lineage);
  }

  function scheduleSettle(
    workspaceId: string,
    sessionId: string,
    lineage: SessionLineage,
  ): void {
    if (!lineage.isResolved) return;
    const rootSessionId = lineage.rootSessionId;
    const key = toRootKey(workspaceId, rootSessionId);
    clearPendingTimer(key);
    // A parent may resume right after a child (or an omo root) reports idle.
    const shouldDelay =
      rootSessionId !== sessionId ||
      engineForSessionId(rootSessionId) === "omo";
    if (!shouldDelay) {
      evaluate(workspaceId, lineage, true);
      return;
    }
    if (pendingTimers.size >= MAX_TRACKED_ROOTS) {
      const oldestKey = pendingTimers.keys().next().value;
      if (oldestKey !== undefined) clearPendingTimer(oldestKey);
    }
    const timer = setTimeout(() => {
      pendingTimers.delete(key);
      evaluate(workspaceId, lineage, true);
    }, deps.settleDelayMs);
    pendingTimers.set(key, timer);
  }

  function handleSessionSettled(workspaceId: string, sessionId: string): void {
    const tree = deps.readWorkspaceTree(workspaceId);
    if (!tree) return;
    const knownLineage = deps.lineage.resolveSync(
      workspaceId,
      sessionId,
      tree.sessions,
    );
    if (knownLineage) {
      scheduleSettle(workspaceId, sessionId, knownLineage);
      return;
    }
    const token = captureToken(workspaceId);
    void deps.lineage
      .resolve(workspaceId, sessionId, tree.sessions)
      .then((resolvedLineage) => {
        if (isTokenCurrent(workspaceId, token)) {
          scheduleSettle(workspaceId, sessionId, resolvedLineage);
        }
      })
      .catch(() => {});
  }

  function handleSessionBusy(workspaceId: string, sessionId: string): void {
    const tree = deps.readWorkspaceTree(workspaceId);
    if (!tree) return;
    const rootSessionId =
      deps.lineage.resolveSync(workspaceId, sessionId, tree.sessions)
        ?.rootSessionId ?? sessionId;
    const key = toRootKey(workspaceId, rootSessionId);
    clearPendingTimer(key);
    // A new root turn may announce again.
    if (rootSessionId === sessionId) lastAnnouncedAt.delete(key);
  }

  function forgetSession(workspaceId: string, sessionId: string): void {
    const key = toRootKey(workspaceId, sessionId);
    clearPendingTimer(key);
    lastAnnouncedAt.delete(key);
  }

  function forgetWorkspace(workspaceId: string): void {
    const prefix = `${workspaceId}:`;
    for (const key of [...pendingTimers.keys()]) {
      if (key.startsWith(prefix)) clearPendingTimer(key);
    }
    for (const key of [...lastAnnouncedAt.keys()]) {
      if (key.startsWith(prefix)) lastAnnouncedAt.delete(key);
    }
    verificationsInFlight.delete(workspaceId);
    workspaceGenerations.set(
      workspaceId,
      (workspaceGenerations.get(workspaceId) ?? 0) + 1,
    );
  }

  function reset(): void {
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
    lastAnnouncedAt.clear();
    verificationsInFlight.clear();
    workspaceGenerations.clear();
    epoch += 1;
  }

  return {
    handleSessionSettled,
    handleSessionBusy,
    forgetSession,
    forgetWorkspace,
    reset,
  };
}
