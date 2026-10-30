import {
  createSessionLineageResolver,
  type SessionLineage,
  type SessionLineageResolver,
} from "@/lib/attention/session-lineage";
import type { SessionTreeSnapshot } from "@/lib/attention/session-tree";
import {
  MAX_TRACKED_ROOTS,
  TURN_ANNOUNCE_DEDUP_WINDOW_MS,
  TURN_SETTLE_DELAY_MS,
  createTurnCompletionTracker,
  type TurnCompletionTracker,
} from "@/lib/attention/turn-completion-tracker";
import type {
  PermissionRequest,
  Session,
  SessionStatus,
} from "@/lib/opencode/types";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

type FetchSession = (
  workspaceId: string,
  sessionId: string,
) => Promise<Session | null>;
type ReconcileWorkspaceStatuses = (workspaceId: string) => Promise<boolean>;
type OnTreeSettled = (workspaceId: string, lineage: SessionLineage) => void;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

interface TreeFixture {
  readonly sessions: readonly Session[];
  readonly statuses: Readonly<Record<string, SessionStatus>>;
  readonly permissions?: readonly PermissionRequest[];
}

const idle: SessionStatus = { type: "idle" };
const busy: SessionStatus = { type: "busy" };

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function makeSession(id: string, parentID?: string): Session {
  return {
    id,
    projectID: "proj-1",
    directory: "/workspace",
    title: `Session ${id}`,
    version: "1",
    parentID,
    time: { created: 1000, updated: 1000 },
  };
}

function makePermission(id: string, sessionID: string): PermissionRequest {
  return {
    id,
    sessionID,
    permission: "edit",
    patterns: [],
    metadata: {},
    always: [],
  };
}

function idleStatusesOf(
  sessions: readonly Session[],
): Record<string, SessionStatus> {
  return Object.fromEntries(sessions.map((session) => [session.id, idle]));
}

const root = makeSession("root");
const child = makeSession("child", "root");
const sibling = makeSession("sibling", "root");
const grandchild = makeSession("grandchild", "child");

const trees = new Map<string, SessionTreeSnapshot>();
const remoteSessions = new Map<string, Session>();
const deferredFetches = new Map<string, Deferred<Session | null>>();

let fetchSession: Mock<FetchSession>;
let reconcileWorkspaceStatuses: Mock<ReconcileWorkspaceStatuses>;
let onTreeSettled: Mock<OnTreeSettled>;
let lineage: SessionLineageResolver;
let tracker: TurnCompletionTracker;

function setTree(workspaceId: string, fixture: TreeFixture): void {
  trees.set(workspaceId, {
    sessions: Object.fromEntries(
      fixture.sessions.map((session) => [session.id, session]),
    ),
    statuses: fixture.statuses,
    permissions: fixture.permissions ?? [],
    questions: [],
  });
}

function setStatuses(
  workspaceId: string,
  statuses: Readonly<Record<string, SessionStatus>>,
): void {
  const tree = trees.get(workspaceId);
  if (!tree) return;
  trees.set(workspaceId, {
    ...tree,
    statuses: { ...tree.statuses, ...statuses },
  });
}

function serveSessions(
  workspaceId: string,
  sessions: readonly Session[],
): void {
  for (const session of sessions) {
    remoteSessions.set(`${workspaceId}:${session.id}`, session);
  }
}

function deferFetch(
  workspaceId: string,
  sessionId: string,
): Deferred<Session | null> {
  const deferred = createDeferred<Session | null>();
  deferredFetches.set(`${workspaceId}:${sessionId}`, deferred);
  return deferred;
}

function deferVerification(): Deferred<boolean> {
  const deferred = createDeferred<boolean>();
  reconcileWorkspaceStatuses.mockReturnValueOnce(deferred.promise);
  return deferred;
}

function announcedRoots(): string[] {
  return onTreeSettled.mock.calls.map(
    ([workspaceId, settledLineage]) =>
      `${workspaceId}:${settledLineage.rootSessionId}`,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  trees.clear();
  remoteSessions.clear();
  deferredFetches.clear();
  fetchSession = vi.fn<FetchSession>(async (workspaceId, sessionId) => {
    const key = `${workspaceId}:${sessionId}`;
    const deferred = deferredFetches.get(key);
    if (deferred) return deferred.promise;
    return remoteSessions.get(key) ?? null;
  });
  reconcileWorkspaceStatuses = vi.fn<ReconcileWorkspaceStatuses>(
    async () => true,
  );
  onTreeSettled = vi.fn<OnTreeSettled>();
  lineage = createSessionLineageResolver({
    fetchSession,
    maxHops: 5,
    capacity: 100,
  });
  tracker = createTurnCompletionTracker({
    settleDelayMs: TURN_SETTLE_DELAY_MS,
    readWorkspaceTree: (workspaceId) => trees.get(workspaceId) ?? null,
    lineage,
    reconcileWorkspaceStatuses,
    onTreeSettled,
    now: () => Date.now(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("turn completion tracker constants", () => {
  it("settles after 2500 ms, dedups for 5000 ms and tracks at most 500 roots", () => {
    expect({
      settleDelayMs: TURN_SETTLE_DELAY_MS,
      dedupWindowMs: TURN_ANNOUNCE_DEDUP_WINDOW_MS,
      maxTrackedRoots: MAX_TRACKED_ROOTS,
    }).toEqual({
      settleDelayMs: 2500,
      dedupWindowMs: 5000,
      maxTrackedRoots: 500,
    });
  });
});

describe("createTurnCompletionTracker settle timing", () => {
  it("(a) announces an idle opencode root without children synchronously", () => {
    setTree("ws-a", { sessions: [root], statuses: { root: idle } });

    tracker.handleSessionSettled("ws-a", "root");

    expect(onTreeSettled).toHaveBeenCalledExactlyOnceWith("ws-a", {
      rootSessionId: "root",
      rootSession: root,
      isResolved: true,
    });
    expect(reconcileWorkspaceStatuses).not.toHaveBeenCalled();
  });

  it("(b) holds a child settle while the root is busy, then announces when the root goes idle", async () => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: busy, child: idle },
    });
    tracker.handleSessionSettled("ws-a", "child");
    await vi.advanceTimersByTimeAsync(2500);
    expect(onTreeSettled).not.toHaveBeenCalled();

    setStatuses("ws-a", { root: idle });
    tracker.handleSessionSettled("ws-a", "root");

    expect(onTreeSettled).toHaveBeenCalledTimes(1);
  });

  it("(c) announces exactly once 2500 ms after a child settles under an idle root", async () => {
    setTree("ws-a", {
      sessions: [root, child, sibling],
      statuses: { root: idle, child: idle, sibling: idle },
    });

    tracker.handleSessionSettled("ws-a", "child");
    await vi.advanceTimersByTimeAsync(2499);
    expect(onTreeSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTreeSettled).toHaveBeenCalledExactlyOnceWith("ws-a", {
      rootSessionId: "root",
      rootSession: root,
      isResolved: true,
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onTreeSettled).toHaveBeenCalledTimes(1);
  });

  it("(d) cancels a pending child settle when the root turns busy within 2500 ms", async () => {
    // The tree stays idle, so only the cancelled timer can prevent the call.
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: idle },
    });
    tracker.handleSessionSettled("ws-a", "child");
    await vi.advanceTimersByTimeAsync(1000);

    tracker.handleSessionBusy("ws-a", "root");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("(e) delays an omo root's own settle by 2500 ms", async () => {
    const omoRoot = makeSession("omo_root");
    setTree("ws-a", { sessions: [omoRoot], statuses: { omo_root: idle } });

    tracker.handleSessionSettled("ws-a", "omo_root");
    await vi.advanceTimersByTimeAsync(2499);
    expect(onTreeSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(onTreeSettled).toHaveBeenCalledExactlyOnceWith("ws-a", {
      rootSessionId: "omo_root",
      rootSession: omoRoot,
      isResolved: true,
    });
  });

  it("restarts the settle delay when another session of the same tree settles", async () => {
    setTree("ws-a", {
      sessions: [root, child, sibling],
      statuses: { root: idle, child: idle, sibling: idle },
    });
    tracker.handleSessionSettled("ws-a", "child");
    await vi.advanceTimersByTimeAsync(1000);

    tracker.handleSessionSettled("ws-a", "sibling");
    await vi.advanceTimersByTimeAsync(1500);
    expect(onTreeSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(onTreeSettled).toHaveBeenCalledTimes(1);
  });

  it("cancels the root's pending settle when the settled child turns busy again", async () => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: idle },
    });
    tracker.handleSessionSettled("ws-a", "child");

    tracker.handleSessionBusy("ws-a", "child");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("ignores settle and busy signals for a workspace without a tree", async () => {
    tracker.handleSessionSettled("ws-x", "root");
    tracker.handleSessionBusy("ws-x", "root");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchSession).not.toHaveBeenCalled();
    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("drops a pending settle whose workspace tree is gone when the delay ends", async () => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: idle },
    });
    tracker.handleSessionSettled("ws-a", "child");

    trees.delete("ws-a");
    await vi.advanceTimersByTimeAsync(2500);

    expect(onTreeSettled).not.toHaveBeenCalled();
  });
});

describe("createTurnCompletionTracker server verification", () => {
  it("(f) asks the server once about a busy-looking child and announces after it marks the child idle", async () => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: busy },
    });
    const verification = deferVerification();
    tracker.handleSessionSettled("ws-a", "root");
    expect(reconcileWorkspaceStatuses).toHaveBeenCalledExactlyOnceWith("ws-a");
    expect(onTreeSettled).not.toHaveBeenCalled();

    setStatuses("ws-a", { child: idle });
    verification.resolve(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(onTreeSettled).toHaveBeenCalledTimes(1);
  });

  it("(f) stays quiet when the server cannot be asked about a busy-looking child", async () => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: busy },
    });
    const verification = deferVerification();
    tracker.handleSessionSettled("ws-a", "root");

    verification.resolve(false);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(reconcileWorkspaceStatuses).toHaveBeenCalledTimes(1);
    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("(f) shares one in-flight server check between simultaneous evaluations", async () => {
    setTree("ws-a", {
      sessions: [
        makeSession("root-a"),
        makeSession("child-a", "root-a"),
        makeSession("root-b"),
        makeSession("child-b", "root-b"),
      ],
      statuses: {
        "root-a": idle,
        "child-a": busy,
        "root-b": idle,
        "child-b": busy,
      },
    });
    const verification = deferVerification();
    tracker.handleSessionSettled("ws-a", "root-a");
    tracker.handleSessionSettled("ws-a", "root-b");

    setStatuses("ws-a", { "child-a": idle, "child-b": idle });
    verification.resolve(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(reconcileWorkspaceStatuses).toHaveBeenCalledTimes(1);
    expect(announcedRoots()).toEqual(["ws-a:root-a", "ws-a:root-b"]);
  });

  it("runs a separate server check for each workspace", () => {
    const busyChildTree: TreeFixture = {
      sessions: [root, child],
      statuses: { root: idle, child: busy },
    };
    setTree("ws-a", busyChildTree);
    setTree("ws-b", busyChildTree);

    tracker.handleSessionSettled("ws-a", "root");
    tracker.handleSessionSettled("ws-b", "root");

    expect(reconcileWorkspaceStatuses.mock.calls).toEqual([["ws-a"], ["ws-b"]]);
  });

  it("asks the server again once the previous check has answered", async () => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: busy },
    });
    tracker.handleSessionSettled("ws-a", "root");
    await vi.advanceTimersByTimeAsync(0);

    tracker.handleSessionSettled("ws-a", "root");

    expect(reconcileWorkspaceStatuses).toHaveBeenCalledTimes(2);
  });

  it("stays quiet after a rejected server check and asks again on the next evaluation", async () => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: busy },
    });
    reconcileWorkspaceStatuses.mockRejectedValueOnce(
      new Error("status endpoint offline"),
    );
    tracker.handleSessionSettled("ws-a", "root");
    await vi.advanceTimersByTimeAsync(0);

    tracker.handleSessionSettled("ws-a", "root");
    await vi.advanceTimersByTimeAsync(0);

    expect(reconcileWorkspaceStatuses).toHaveBeenCalledTimes(2);
    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("never asks the server while the root itself is busy", async () => {
    setTree("ws-a", {
      sessions: [root, child, sibling],
      statuses: { root: busy, child: busy, sibling: idle },
    });

    tracker.handleSessionSettled("ws-a", "sibling");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(reconcileWorkspaceStatuses).not.toHaveBeenCalled();
    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("(i) neither announces nor asks the server while a grandchild waits for permission", async () => {
    // A session waiting for permission still reports busy.
    setTree("ws-a", {
      sessions: [root, child, grandchild],
      statuses: { root: idle, child: idle, grandchild: busy },
      permissions: [makePermission("perm-1", "grandchild")],
    });

    tracker.handleSessionSettled("ws-a", "child");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(reconcileWorkspaceStatuses).not.toHaveBeenCalled();
    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("counts lineage-fetched sessions as descendants of the root", async () => {
    serveSessions("ws-a", [
      makeSession("fetched-child", "root"),
      makeSession("orphan", "root"),
    ]);
    setTree("ws-a", {
      sessions: [root],
      statuses: { root: idle, "fetched-child": busy, orphan: idle },
    });
    await lineage.resolve("ws-a", "fetched-child", {});

    tracker.handleSessionSettled("ws-a", "orphan");
    await vi.advanceTimersByTimeAsync(2500);

    expect(reconcileWorkspaceStatuses).toHaveBeenCalledExactlyOnceWith("ws-a");
    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("lets the live tree's copy of a session override the lineage cache", async () => {
    serveSessions("ws-a", [makeSession("moved", "root")]);
    await lineage.resolve("ws-a", "moved", { root });
    setTree("ws-a", {
      sessions: [
        root,
        makeSession("other-root"),
        makeSession("moved", "other-root"),
      ],
      statuses: { root: idle, "other-root": idle, moved: busy },
    });

    tracker.handleSessionSettled("ws-a", "root");

    expect(reconcileWorkspaceStatuses).not.toHaveBeenCalled();
    expect(announcedRoots()).toEqual(["ws-a:root"]);
  });
});

describe("createTurnCompletionTracker root without a status entry", () => {
  const firstChild = makeSession("c1", "root");
  const secondChild = makeSession("c2", "root");

  function settleFirstChildUnderUnknownRoot(): Deferred<boolean> {
    setTree("ws-a", {
      sessions: [root, firstChild, secondChild],
      statuses: { c1: idle },
    });
    const verification = deferVerification();
    tracker.handleSessionSettled("ws-a", "c1");
    return verification;
  }

  it("(j) asks the server about a lineage-fetched root and announces it after a no-change answer", async () => {
    const fetchedRoot = makeSession("root");
    serveSessions("ws-a", [makeSession("child", "root"), fetchedRoot]);
    setTree("ws-a", { sessions: [], statuses: { child: idle } });
    const verification = deferVerification();
    tracker.handleSessionSettled("ws-a", "child");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2499);
    expect(reconcileWorkspaceStatuses).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcileWorkspaceStatuses).toHaveBeenCalledExactlyOnceWith("ws-a");
    expect(onTreeSettled).not.toHaveBeenCalled();

    verification.resolve(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(onTreeSettled).toHaveBeenCalledExactlyOnceWith("ws-a", {
      rootSessionId: "root",
      rootSession: fetchedRoot,
      isResolved: true,
    });
  });

  it("(n) asks the server after 2500 ms and stays quiet when it marks the root and C2 busy", async () => {
    const verification = settleFirstChildUnderUnknownRoot();
    await vi.advanceTimersByTimeAsync(2499);
    expect(reconcileWorkspaceStatuses).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reconcileWorkspaceStatuses).toHaveBeenCalledExactlyOnceWith("ws-a");

    setStatuses("ws-a", { root: busy, c2: busy });
    verification.resolve(true);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("(o) announces once when the server check leaves everything idle", async () => {
    const verification = settleFirstChildUnderUnknownRoot();
    await vi.advanceTimersByTimeAsync(2500);
    expect(reconcileWorkspaceStatuses).toHaveBeenCalledTimes(1);

    setStatuses("ws-a", { root: idle, c2: idle });
    verification.resolve(true);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(announcedRoots()).toEqual(["ws-a:root"]);
  });

  it("(p) fails open with one announcement when the server cannot be asked", async () => {
    const verification = settleFirstChildUnderUnknownRoot();
    await vi.advanceTimersByTimeAsync(2500);
    expect(reconcileWorkspaceStatuses).toHaveBeenCalledTimes(1);

    verification.resolve(false);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(announcedRoots()).toEqual(["ws-a:root"]);
  });
});

describe("createTurnCompletionTracker unidentified trees", () => {
  it("(k) never announces when the settled session cannot be fetched", async () => {
    setTree("ws-a", { sessions: [], statuses: { child: idle } });

    tracker.handleSessionSettled("ws-a", "child");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchSession).toHaveBeenCalledWith("ws-a", "child");
    expect(reconcileWorkspaceStatuses).not.toHaveBeenCalled();
    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("never announces when the settled session's parent cannot be fetched", async () => {
    serveSessions("ws-a", [makeSession("child", "root")]);
    setTree("ws-a", { sessions: [], statuses: { child: idle } });

    tracker.handleSessionSettled("ws-a", "child");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(reconcileWorkspaceStatuses).not.toHaveBeenCalled();
    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("never announces a known chain deeper than the lineage hop budget", async () => {
    const chain = Array.from({ length: 7 }, (_, level) =>
      makeSession(`s${level}`, level === 6 ? undefined : `s${level + 1}`),
    );
    setTree("ws-a", { sessions: chain, statuses: idleStatusesOf(chain) });

    tracker.handleSessionSettled("ws-a", "s0");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onTreeSettled).not.toHaveBeenCalled();
  });
});

describe("createTurnCompletionTracker announce dedup", () => {
  beforeEach(() => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: idle },
    });
  });

  it("(g) announces a root once when it settles twice within 5000 ms", async () => {
    tracker.handleSessionSettled("ws-a", "root");
    await vi.advanceTimersByTimeAsync(4999);

    tracker.handleSessionSettled("ws-a", "root");

    expect(onTreeSettled).toHaveBeenCalledTimes(1);
  });

  it("(g) announces the same root again 5001 ms after its last announcement", async () => {
    tracker.handleSessionSettled("ws-a", "root");
    await vi.advanceTimersByTimeAsync(5001);

    tracker.handleSessionSettled("ws-a", "root");

    expect(onTreeSettled).toHaveBeenCalledTimes(2);
  });

  it("treats the 5000 ms dedup window as exclusive of its end", async () => {
    tracker.handleSessionSettled("ws-a", "root");
    await vi.advanceTimersByTimeAsync(5000);

    tracker.handleSessionSettled("ws-a", "root");

    expect(onTreeSettled).toHaveBeenCalledTimes(2);
  });

  it("(h) lets a root announce again after it went busy in between", async () => {
    tracker.handleSessionSettled("ws-a", "root");
    tracker.handleSessionBusy("ws-a", "root");
    await vi.advanceTimersByTimeAsync(1000);

    tracker.handleSessionSettled("ws-a", "root");

    expect(onTreeSettled).toHaveBeenCalledTimes(2);
  });

  it("keeps the root's dedup when only a child went busy in between", async () => {
    tracker.handleSessionSettled("ws-a", "root");
    tracker.handleSessionBusy("ws-a", "child");
    await vi.advanceTimersByTimeAsync(1000);

    tracker.handleSessionSettled("ws-a", "root");

    expect(onTreeSettled).toHaveBeenCalledTimes(1);
  });
});

describe("createTurnCompletionTracker tracking caps", () => {
  function makeRoots(prefix: string): Session[] {
    return Array.from({ length: MAX_TRACKED_ROOTS + 1 }, (_, index) =>
      makeSession(`${prefix}${index}`),
    );
  }

  it("keeps at most 500 pending settles by cancelling the oldest", async () => {
    const omoRoots = makeRoots("omo_root_");
    setTree("ws-a", { sessions: omoRoots, statuses: idleStatusesOf(omoRoots) });

    for (const omoRoot of omoRoots) {
      tracker.handleSessionSettled("ws-a", omoRoot.id);
    }
    await vi.advanceTimersByTimeAsync(2500);

    expect(onTreeSettled).toHaveBeenCalledTimes(MAX_TRACKED_ROOTS);
    expect(announcedRoots()).not.toContain("ws-a:omo_root_0");
  });

  it("remembers at most 500 announced roots, forgetting the oldest first", () => {
    const roots = makeRoots("root-");
    setTree("ws-a", { sessions: roots, statuses: idleStatusesOf(roots) });
    for (const announcedRoot of roots) {
      tracker.handleSessionSettled("ws-a", announcedRoot.id);
    }

    tracker.handleSessionSettled("ws-a", `root-${MAX_TRACKED_ROOTS}`);
    tracker.handleSessionSettled("ws-a", "root-0");

    expect(onTreeSettled).toHaveBeenCalledTimes(MAX_TRACKED_ROOTS + 2);
    expect(announcedRoots().at(-1)).toBe("ws-a:root-0");
  });

  it("treats a re-announced root as the newest record when evicting", async () => {
    const roots = makeRoots("root-");
    setTree("ws-a", { sessions: roots, statuses: idleStatusesOf(roots) });
    tracker.handleSessionSettled("ws-a", "root-0");
    await vi.advanceTimersByTimeAsync(5001);
    for (const announcedRoot of roots.slice(1, MAX_TRACKED_ROOTS)) {
      tracker.handleSessionSettled("ws-a", announcedRoot.id);
    }
    tracker.handleSessionSettled("ws-a", "root-0");
    tracker.handleSessionSettled("ws-a", `root-${MAX_TRACKED_ROOTS}`);

    tracker.handleSessionSettled("ws-a", "root-0");

    expect(
      announcedRoots().filter((rootKey) => rootKey === "ws-a:root-0"),
    ).toHaveLength(2);
  });
});

describe("createTurnCompletionTracker forgetSession", () => {
  beforeEach(() => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: idle },
    });
  });

  it("cancels the pending settle of the forgotten root", async () => {
    tracker.handleSessionSettled("ws-a", "child");

    tracker.forgetSession("ws-a", "root");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("drops the forgotten root's announce record", () => {
    tracker.handleSessionSettled("ws-a", "root");

    tracker.forgetSession("ws-a", "root");
    tracker.handleSessionSettled("ws-a", "root");

    expect(onTreeSettled).toHaveBeenCalledTimes(2);
  });
});

describe("createTurnCompletionTracker forgetWorkspace", () => {
  it("(l) cancels ws-a timers and lineage continuations while a pending ws-b settle still announces once", async () => {
    setTree("ws-a", {
      sessions: [makeSession("root-a"), makeSession("child-a", "root-a")],
      statuses: { "root-a": idle, "child-a": idle, "orphan-a": idle },
    });
    setTree("ws-b", {
      sessions: [makeSession("root-b"), makeSession("child-b", "root-b")],
      statuses: { "root-b": idle, "child-b": idle },
    });
    const orphanFetch = deferFetch("ws-a", "orphan-a");
    tracker.handleSessionSettled("ws-a", "child-a");
    tracker.handleSessionSettled("ws-a", "orphan-a");
    tracker.handleSessionSettled("ws-b", "child-b");

    tracker.forgetWorkspace("ws-a");
    orphanFetch.resolve(makeSession("orphan-a", "root-a"));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(announcedRoots()).toEqual(["ws-b:root-b"]);
  });

  it("keeps ws-b lineage and server-check continuations running after forgetting ws-a", async () => {
    setTree("ws-b", {
      sessions: [
        makeSession("root-b"),
        makeSession("busy-b", "root-b"),
        makeSession("root-b2"),
      ],
      statuses: {
        "root-b": idle,
        "busy-b": busy,
        "root-b2": idle,
        "orphan-b": idle,
      },
    });
    const verification = deferVerification();
    const orphanFetch = deferFetch("ws-b", "orphan-b");
    tracker.handleSessionSettled("ws-b", "root-b");
    tracker.handleSessionSettled("ws-b", "orphan-b");

    tracker.forgetWorkspace("ws-a");
    setStatuses("ws-b", { "busy-b": idle });
    verification.resolve(true);
    orphanFetch.resolve(makeSession("orphan-b", "root-b2"));
    await vi.advanceTimersByTimeAsync(2500);

    expect(announcedRoots()).toEqual(["ws-b:root-b", "ws-b:root-b2"]);
  });

  it("ignores the answer of a ws-a server check that was in flight when ws-a was forgotten", async () => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: busy },
    });
    const verification = deferVerification();
    tracker.handleSessionSettled("ws-a", "root");

    tracker.forgetWorkspace("ws-a");
    setStatuses("ws-a", { child: idle });
    verification.resolve(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("starts a fresh ws-a server check right after forgetting ws-a", () => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: busy },
    });
    deferVerification();
    tracker.handleSessionSettled("ws-a", "root");

    tracker.forgetWorkspace("ws-a");
    tracker.handleSessionSettled("ws-a", "root");

    expect(reconcileWorkspaceStatuses).toHaveBeenCalledTimes(2);
  });

  it("keeps sharing the fresh ws-a server check after the forgotten one answers", async () => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: busy },
    });
    const staleVerification = deferVerification();
    deferVerification();
    tracker.handleSessionSettled("ws-a", "root");
    tracker.forgetWorkspace("ws-a");
    tracker.handleSessionSettled("ws-a", "root");

    staleVerification.resolve(false);
    await vi.advanceTimersByTimeAsync(0);
    tracker.handleSessionSettled("ws-a", "root");

    expect(reconcileWorkspaceStatuses).toHaveBeenCalledTimes(2);
  });

  it("forgets ws-a announce records but keeps ws-b's", () => {
    setTree("ws-a", {
      sessions: [makeSession("root-a")],
      statuses: { "root-a": idle },
    });
    setTree("ws-b", {
      sessions: [makeSession("root-b")],
      statuses: { "root-b": idle },
    });
    tracker.handleSessionSettled("ws-a", "root-a");
    tracker.handleSessionSettled("ws-b", "root-b");

    tracker.forgetWorkspace("ws-a");
    tracker.handleSessionSettled("ws-a", "root-a");
    tracker.handleSessionSettled("ws-b", "root-b");

    expect(announcedRoots()).toEqual([
      "ws-a:root-a",
      "ws-b:root-b",
      "ws-a:root-a",
    ]);
  });
});

describe("createTurnCompletionTracker reset", () => {
  it("(m) cancels timers and drops lineage and server-check continuations in every workspace", async () => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: idle, orphan: idle },
    });
    setTree("ws-b", {
      sessions: [makeSession("root-b"), makeSession("busy-b", "root-b")],
      statuses: { "root-b": idle, "busy-b": busy },
    });
    const orphanFetch = deferFetch("ws-a", "orphan");
    const verification = deferVerification();
    tracker.handleSessionSettled("ws-a", "child");
    tracker.handleSessionSettled("ws-a", "orphan");
    tracker.handleSessionSettled("ws-b", "root-b");

    tracker.reset();
    orphanFetch.resolve(makeSession("orphan", "root"));
    setStatuses("ws-b", { "busy-b": idle });
    verification.resolve(true);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onTreeSettled).not.toHaveBeenCalled();
  });

  it("clears announce records so a root can announce again right away", () => {
    setTree("ws-a", { sessions: [root], statuses: { root: idle } });
    tracker.handleSessionSettled("ws-a", "root");

    tracker.reset();
    tracker.handleSessionSettled("ws-a", "root");

    expect(onTreeSettled).toHaveBeenCalledTimes(2);
  });

  it("forgets in-flight server checks so the next evaluation asks again", () => {
    setTree("ws-a", {
      sessions: [root, child],
      statuses: { root: idle, child: busy },
    });
    deferVerification();
    tracker.handleSessionSettled("ws-a", "root");

    tracker.reset();
    tracker.handleSessionSettled("ws-a", "root");

    expect(reconcileWorkspaceStatuses).toHaveBeenCalledTimes(2);
  });
});
