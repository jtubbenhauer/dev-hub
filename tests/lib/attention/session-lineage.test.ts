import {
  createSessionLineageResolver,
  type SessionLineageResolver,
} from "@/lib/attention/session-lineage";
import type { Session } from "@/lib/opencode/types";
import { describe, expect, it, vi } from "vitest";

type FetchSession = (
  workspaceId: string,
  sessionId: string,
) => Promise<Session | null>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

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

function makeChain(length: number): Record<string, Session> {
  const sessions: Record<string, Session> = {};
  for (let level = 0; level < length; level += 1) {
    sessions[`s${level}`] = makeSession(
      `s${level}`,
      level === length - 1 ? undefined : `s${level + 1}`,
    );
  }
  return sessions;
}

function fetchFrom(
  sessionsById: Readonly<Record<string, Session>>,
): ReturnType<typeof vi.fn<FetchSession>> {
  return vi.fn<FetchSession>(async (_workspaceId, sessionId) => {
    return sessionsById[sessionId] ?? null;
  });
}

function createResolver(
  fetchSession: FetchSession,
  overrides: { maxHops?: number; capacity?: number } = {},
): SessionLineageResolver {
  return createSessionLineageResolver({
    fetchSession,
    maxHops: overrides.maxHops ?? 5,
    capacity: overrides.capacity ?? 100,
  });
}

const parentSession = makeSession("parent");
const childSession = makeSession("child", "parent");

describe("createSessionLineageResolver resolveSync", () => {
  it("returns the root of an all-known chain without fetching", () => {
    const fetchSession = vi.fn<FetchSession>();
    const resolver = createResolver(fetchSession);
    const known = {
      parent: parentSession,
      child: childSession,
      grandchild: makeSession("grandchild", "child"),
    };

    const lineage = resolver.resolveSync("ws-a", "grandchild", known);

    expect(lineage).toEqual({
      rootSessionId: "parent",
      rootSession: parentSession,
      isResolved: true,
    });
    expect(fetchSession).not.toHaveBeenCalled();
  });

  it("returns null when a session in the chain is unknown", () => {
    const resolver = createResolver(vi.fn<FetchSession>());

    expect(resolver.resolveSync("ws-a", "child", {})).toBeNull();
  });

  it("treats an empty parentID as the root", () => {
    const blank = makeSession("blank", "");
    const resolver = createResolver(vi.fn<FetchSession>());

    expect(resolver.resolveSync("ws-a", "blank", { blank })).toEqual({
      rootSessionId: "blank",
      rootSession: blank,
      isResolved: true,
    });
  });

  it("terminates on a known parent cycle", () => {
    const sessionA = makeSession("a", "b");
    const sessionB = makeSession("b", "a");
    const resolver = createResolver(vi.fn<FetchSession>());

    expect(
      resolver.resolveSync("ws-a", "a", { a: sessionA, b: sessionB }),
    ).toEqual({ rootSessionId: "b", rootSession: sessionB, isResolved: true });
  });

  it("never claims a mid-level session is the root when hops run out", () => {
    const known = makeChain(7);
    const resolver = createResolver(vi.fn<FetchSession>(), { maxHops: 5 });

    const lineage = resolver.resolveSync("ws-a", "s0", known);

    expect(lineage?.isResolved).toBe(false);
    expect(lineage?.rootSessionId).not.toBe("s6");
  });
});

describe("createSessionLineageResolver resolve", () => {
  it("fetches an unknown child and then its parent", async () => {
    const fetchSession = fetchFrom({
      child: childSession,
      parent: parentSession,
    });
    const resolver = createResolver(fetchSession);

    const lineage = await resolver.resolve("ws-a", "child", {});

    expect(lineage).toEqual({
      rootSessionId: "parent",
      rootSession: parentSession,
      isResolved: true,
    });
    expect(fetchSession.mock.calls).toEqual([
      ["ws-a", "child"],
      ["ws-a", "parent"],
    ]);
  });

  it("serves a repeated resolve from the cache without refetching", async () => {
    const fetchSession = fetchFrom({
      child: childSession,
      parent: parentSession,
    });
    const resolver = createResolver(fetchSession);
    await resolver.resolve("ws-a", "child", {});

    const lineage = await resolver.resolve("ws-a", "child", {});

    expect(lineage.rootSessionId).toBe("parent");
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("lets resolveSync use sessions cached by an earlier resolve", async () => {
    const resolver = createResolver(
      fetchFrom({ child: childSession, parent: parentSession }),
    );
    await resolver.resolve("ws-a", "child", {});

    expect(resolver.resolveSync("ws-a", "child", {})?.rootSessionId).toBe(
      "parent",
    );
  });

  it("shares one fetch per id between concurrent resolves", async () => {
    const fetchSession = fetchFrom({
      child: childSession,
      parent: parentSession,
    });
    const resolver = createResolver(fetchSession);

    const [first, second] = await Promise.all([
      resolver.resolve("ws-a", "child", {}),
      resolver.resolve("ws-a", "child", {}),
    ]);

    expect(first.rootSessionId).toBe("parent");
    expect(second.rootSessionId).toBe("parent");
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("returns an unresolved lineage naming the missing id when fetch returns null", async () => {
    const resolver = createResolver(fetchFrom({ child: childSession }));

    const lineage = await resolver.resolve("ws-a", "child", {});

    expect(lineage).toEqual({
      rootSessionId: "parent",
      rootSession: null,
      isResolved: false,
    });
  });

  it("treats a rejected fetch like a null fetch", async () => {
    const fetchSession = vi
      .fn<FetchSession>()
      .mockRejectedValue(new Error("network down"));
    const resolver = createResolver(fetchSession);

    const lineage = await resolver.resolve("ws-a", "child", {});

    expect(lineage).toEqual({
      rootSessionId: "child",
      rootSession: null,
      isResolved: false,
    });
  });

  it("stops after maxHops fetches on a deep unknown chain", async () => {
    const fetchSession = fetchFrom(makeChain(4));
    const resolver = createResolver(fetchSession, { maxHops: 2 });

    const lineage = await resolver.resolve("ws-a", "s0", {});

    expect(lineage.isResolved).toBe(false);
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("abandons an in-flight resolve when reset is called", async () => {
    const childFetch = createDeferred<Session | null>();
    const fetchSession = vi
      .fn<FetchSession>()
      .mockReturnValueOnce(childFetch.promise);
    const resolver = createResolver(fetchSession);
    const pending = resolver.resolve("ws-a", "child", {});

    resolver.reset();
    childFetch.resolve(childSession);
    const lineage = await pending;

    expect(lineage).toEqual({
      rootSessionId: "child",
      rootSession: null,
      isResolved: false,
    });
    expect(fetchSession).toHaveBeenCalledTimes(1);
    expect(resolver.getCachedSessions("ws-a")).toEqual({});
  });

  it("keeps a newer in-flight fetch when a stale fetch settles after reset", async () => {
    const staleFetch = createDeferred<Session | null>();
    const freshFetch = createDeferred<Session | null>();
    const fetchSession = vi
      .fn<FetchSession>()
      .mockReturnValueOnce(staleFetch.promise)
      .mockReturnValueOnce(freshFetch.promise);
    const resolver = createResolver(fetchSession);
    const stale = resolver.resolve("ws-a", "solo", {});
    resolver.reset();
    const fresh = resolver.resolve("ws-a", "solo", {});
    staleFetch.resolve(null);
    await stale;

    const joined = resolver.resolve("ws-a", "solo", {});
    freshFetch.resolve(makeSession("solo"));

    expect((await joined).isResolved).toBe(true);
    expect((await fresh).isResolved).toBe(true);
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it("abandons an in-flight resolve when its workspace is forgotten", async () => {
    const childFetch = createDeferred<Session | null>();
    const fetchSession = vi
      .fn<FetchSession>()
      .mockReturnValueOnce(childFetch.promise);
    const resolver = createResolver(fetchSession);
    const pending = resolver.resolve("ws-a", "child", {});

    resolver.forgetWorkspace("ws-a");
    childFetch.resolve(childSession);

    expect((await pending).isResolved).toBe(false);
    expect(fetchSession).toHaveBeenCalledTimes(1);
    expect(resolver.getCachedSessions("ws-a")).toEqual({});
  });

  it("does not affect another workspace's in-flight resolve when forgetting a workspace", async () => {
    const childFetch = createDeferred<Session | null>();
    const fetchSession = vi
      .fn<FetchSession>()
      .mockReturnValueOnce(childFetch.promise)
      .mockResolvedValueOnce(parentSession);
    const resolver = createResolver(fetchSession);
    const pending = resolver.resolve("ws-b", "child", {});

    resolver.forgetWorkspace("ws-a");
    childFetch.resolve(childSession);

    expect(await pending).toEqual({
      rootSessionId: "parent",
      rootSession: parentSession,
      isResolved: true,
    });
  });
});

describe("createSessionLineageResolver cache management", () => {
  it("evicts the oldest cached session beyond capacity", async () => {
    const resolver = createResolver(fetchFrom(makeChain(3)), { capacity: 2 });

    await resolver.resolve("ws-a", "s0", {});

    expect(Object.keys(resolver.getCachedSessions("ws-a")).sort()).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("forgetWorkspace clears only that workspace", async () => {
    const resolver = createResolver(
      fetchFrom({ child: childSession, parent: parentSession }),
    );
    await resolver.resolve("ws-a", "child", {});
    await resolver.resolve("ws-b", "child", {});

    resolver.forgetWorkspace("ws-a");

    expect(resolver.getCachedSessions("ws-a")).toEqual({});
    expect(resolver.getCachedSessions("ws-b")).toEqual({
      child: childSession,
      parent: parentSession,
    });
  });

  it("forgetSession removes one cached session so it is fetched again", async () => {
    const fetchSession = fetchFrom({
      child: childSession,
      parent: parentSession,
    });
    const resolver = createResolver(fetchSession);
    await resolver.resolve("ws-a", "child", {});

    resolver.forgetSession("ws-a", "parent");
    await resolver.resolve("ws-a", "child", {});

    expect(fetchSession.mock.calls).toEqual([
      ["ws-a", "child"],
      ["ws-a", "parent"],
      ["ws-a", "parent"],
    ]);
  });

  it("prefers known sessions over cached ones", async () => {
    const resolver = createResolver(
      fetchFrom({ child: childSession, parent: parentSession }),
    );
    await resolver.resolve("ws-a", "child", {});
    const reparented = makeSession("child", "other-root");
    const otherRoot = makeSession("other-root");

    const lineage = resolver.resolveSync("ws-a", "child", {
      child: reparented,
      "other-root": otherRoot,
    });

    expect(lineage?.rootSessionId).toBe("other-root");
  });
});
