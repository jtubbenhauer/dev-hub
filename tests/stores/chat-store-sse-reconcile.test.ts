import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestionRequest, Session } from "@/lib/opencode/types";
import {
  _resetModuleCaches,
  useChatStore,
  type WorkspaceState,
} from "@/stores/chat-store";

vi.mock("sonner", () => ({ toast: vi.fn() }));

interface MockEventSourceInstance {
  readonly url: string;
  readyState: number;
  close(): void;
  simulateOpen(): void;
}

type MockEventSourceConstructor = new (url: string) => MockEventSourceInstance;

const originalEventSource = globalThis.EventSource;
const BaseEventSource =
  originalEventSource as unknown as MockEventSourceConstructor;
const createdSources: MockEventSourceInstance[] = [];

class RecordingEventSource extends BaseEventSource {
  constructor(url: string) {
    super(url);
    createdSources.push(this);
  }
}

function currentSource(): MockEventSourceInstance {
  const source = useChatStore.getState().globalEventSource;
  if (!source) throw new Error("Expected an open global EventSource");
  return source as unknown as MockEventSourceInstance;
}

const WS_OMO = "ws-omo";
const WS_OC = "ws-oc";

function session(id: string, title = id): Session {
  return {
    id,
    projectID: "project",
    directory: "/workspace",
    title,
    version: "omo",
    time: { created: 1, updated: 1 },
  };
}

function question(id: string, sessionID: string): QuestionRequest {
  return {
    id,
    sessionID,
    questions: [
      {
        header: "h",
        question: "q",
        options: [],
        multiple: false,
        custom: true,
      },
    ],
  };
}

function workspace(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    sessions: {},
    sessionsLoaded: true,
    messages: {},
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: {},
    todoUpdatedAt: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set(),
    sessionNotes: {},
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pathnameOf(url: string): string {
  return new URL(url, "http://localhost").pathname;
}

interface DeferredIdentitiesEntry {
  resolve: (body: unknown) => void;
}

function deferredJson(): {
  promise: Promise<Response>;
  resolve: (body: unknown) => void;
} {
  let resolveFn!: (value: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolveFn = res;
  });
  return {
    promise,
    resolve: (body: unknown) => resolveFn(jsonResponse(body)),
  };
}

let identitiesQueue: Array<Promise<Response>>;
let fetchMock: ReturnType<typeof vi.fn>;

function queueIdentitiesResponse(): DeferredIdentitiesEntry {
  const d = deferredJson();
  identitiesQueue.push(d.promise);
  return { resolve: d.resolve };
}

function setupFetchMock(): void {
  identitiesQueue = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();
    const pathname = pathnameOf(url);

    if (pathname === "/api/opencode/session/identities") {
      const next = identitiesQueue.shift();
      if (next) return next;
      return jsonResponse({ roots: [], children: [], replaced: [] });
    }
    if (pathname === `/api/workspaces/${WS_OMO}`) {
      return jsonResponse({ id: WS_OMO, engine: "omo" });
    }
    if (pathname === `/api/workspaces/${WS_OC}`) {
      return jsonResponse({ id: WS_OC, engine: "opencode" });
    }
    if (pathname === "/api/opencode/session" && url.includes(WS_OMO)) {
      return jsonResponse(session("omo_created"));
    }
    return jsonResponse([]);
  });
  vi.stubGlobal("fetch", fetchMock);
}

function resetStore(): void {
  _resetModuleCaches();
  useChatStore.getState().disconnectGlobalSSE();
  useChatStore.setState({
    workspaceStates: {},
    activeWorkspaceId: null,
    activeSessionId: null,
    sessionMutationGen: {},
    sseReconnectAttempts: 0,
    engineRev: 0,
    sseGeneration: 0,
  });
}

beforeEach(() => {
  createdSources.length = 0;
  globalThis.EventSource =
    RecordingEventSource as unknown as typeof EventSource;
  setupFetchMock();
  resetStore();
});

afterEach(() => {
  vi.useRealTimers();
  useChatStore.getState().disconnectGlobalSSE();
  _resetModuleCaches();
  vi.unstubAllGlobals();
  globalThis.EventSource = originalEventSource;
});

describe("SSE onopen wiring for omo workspaces (D23)", () => {
  it("calls only GET session/identities for an omo workspace, coalesced 2s after onopen", async () => {
    vi.useFakeTimers();
    useChatStore.setState({
      workspaceStates: { [WS_OMO]: workspace() },
    });
    useChatStore.getState().connectGlobalSSE([WS_OMO]);
    currentSource().simulateOpen();

    await vi.advanceTimersByTimeAsync(2000);

    const calledPaths = fetchMock.mock.calls.map((call: unknown[]) =>
      pathnameOf(String(call[0])),
    );
    expect(calledPaths).toContain("/api/opencode/session/identities");
    expect(calledPaths).not.toContain("/api/sessions/cache");
    expect(calledPaths.some((p: string) => /^\/session\//.test(p))).toBe(false);
  });

  it("never calls the identities endpoint for an opencode workspace", async () => {
    vi.useFakeTimers();
    useChatStore.setState({
      workspaceStates: { [WS_OC]: workspace() },
    });
    useChatStore.getState().connectGlobalSSE([WS_OC]);
    currentSource().simulateOpen();

    await vi.advanceTimersByTimeAsync(3000);

    const calledPaths = fetchMock.mock.calls.map((call: unknown[]) =>
      pathnameOf(String(call[0])),
    );
    expect(calledPaths).not.toContain("/api/opencode/session/identities");
  });
});

describe("reconcileOmoSessionIdentities (D23)", () => {
  it("applies a successor: session.created{new} then no old state, without a GET /session/omo_new request", async () => {
    const info = session("omo_new", "Renamed");
    useChatStore.setState({
      workspaceStates: {
        [WS_OMO]: workspace({
          sessions: { omo_old: session("omo_old") },
          messages: { omo_old: [] },
        }),
      },
    });
    const entry = queueIdentitiesResponse();
    const reconcile = useChatStore
      .getState()
      .reconcileOmoSessionIdentities(WS_OMO);
    entry.resolve({
      roots: [],
      children: [],
      replaced: [{ old: "omo_old", new: "omo_new", info }],
    });
    await reconcile;

    const ws = useChatStore.getState().workspaceStates[WS_OMO];
    expect(ws.sessions.omo_old).toBeUndefined();
    expect(ws.sessions.omo_new).toEqual(info);
    const calledPaths = fetchMock.mock.calls.map((call: unknown[]) =>
      pathnameOf(String(call[0])),
    );
    expect(calledPaths).not.toContain("/api/opencode/session/omo_new");
  });

  it("snapshot rule: a session created after the request was issued survives a gen-mismatch discard and the trailing re-run", async () => {
    useChatStore.setState({
      workspaceStates: { [WS_OMO]: workspace() },
    });

    const firstEntry = queueIdentitiesResponse();
    const reconcile = useChatStore
      .getState()
      .reconcileOmoSessionIdentities(WS_OMO);

    // A local mutation races the in-flight identities fetch.
    await useChatStore.getState().createSession(WS_OMO);
    expect(useChatStore.getState().sessionMutationGen[WS_OMO]).toBe(1);

    const secondEntry = queueIdentitiesResponse();
    // First response omits the newly created session — if the gen guard did
    // not fire, this would incorrectly delete it.
    firstEntry.resolve({ roots: [], children: [], replaced: [] });
    await vi.waitFor(() => expect(identitiesQueue).toHaveLength(0));
    secondEntry.resolve({
      roots: ["omo_created"],
      children: [],
      replaced: [],
    });
    await reconcile;

    expect(
      useChatStore.getState().workspaceStates[WS_OMO].sessions.omo_created,
    ).toBeDefined();
  });

  it("discards a stale response when a local deleteSession changed the gen, and does not recreate the deleted session", async () => {
    const staleInfo = session("omo_new", "stale");
    useChatStore.setState({
      workspaceStates: {
        [WS_OMO]: workspace({
          sessions: { omo_new: session("omo_new") },
          messages: { omo_new: [] },
        }),
      },
    });

    const first = queueIdentitiesResponse();
    const reconcile = useChatStore
      .getState()
      .reconcileOmoSessionIdentities(WS_OMO);

    await useChatStore.getState().deleteSession("omo_new", WS_OMO);
    expect(useChatStore.getState().sessionMutationGen[WS_OMO]).toBeGreaterThan(
      0,
    );

    const second = queueIdentitiesResponse();
    first.resolve({
      roots: [],
      children: [],
      replaced: [{ old: "omo_old", new: "omo_new", info: staleInfo }],
    });
    await vi.waitFor(() => expect(identitiesQueue).toHaveLength(0));
    second.resolve({ roots: [], children: [], replaced: [] });
    await reconcile;

    expect(
      useChatStore.getState().workspaceStates[WS_OMO].sessions.omo_new,
    ).toBeUndefined();
    const identitiesCalls = fetchMock.mock.calls.filter(
      (call: unknown[]) =>
        pathnameOf(String(call[0])) === "/api/opencode/session/identities",
    );
    expect(identitiesCalls).toHaveLength(2);
  });

  it("does not delete a child present in children (but absent from roots) and keeps its pending question", async () => {
    useChatStore.setState({
      workspaceStates: {
        [WS_OMO]: workspace({
          sessions: {
            omo_root: session("omo_root"),
            omo_child: session("omo_child"),
          },
          messages: { omo_root: [], omo_child: [] },
          questions: [question("dh_q_child", "omo_child")],
        }),
      },
    });

    const entry = queueIdentitiesResponse();
    const reconcile = useChatStore
      .getState()
      .reconcileOmoSessionIdentities(WS_OMO);
    entry.resolve({
      roots: ["omo_root"],
      children: ["omo_child"],
      replaced: [],
    });
    await reconcile;

    const ws = useChatStore.getState().workspaceStates[WS_OMO];
    expect(ws.sessions.omo_child).toBeDefined();
    expect(ws.questions.some((q) => q.sessionID === "omo_child")).toBe(true);
  });

  it("a second call while a reconcile is in flight results in exactly one trailing re-run", async () => {
    useChatStore.setState({
      workspaceStates: { [WS_OMO]: workspace() },
    });

    const first = queueIdentitiesResponse();
    const firstCall = useChatStore
      .getState()
      .reconcileOmoSessionIdentities(WS_OMO);
    const secondCall = useChatStore
      .getState()
      .reconcileOmoSessionIdentities(WS_OMO);

    const second = queueIdentitiesResponse();
    first.resolve({ roots: [], children: [], replaced: [] });
    await vi.waitFor(() => expect(identitiesQueue).toHaveLength(0));
    second.resolve({ roots: [], children: [], replaced: [] });

    await Promise.all([firstCall, secondCall]);

    const identitiesCalls = fetchMock.mock.calls.filter(
      (call: unknown[]) =>
        pathnameOf(String(call[0])) === "/api/opencode/session/identities",
    );
    expect(identitiesCalls).toHaveLength(2);
  });
});
