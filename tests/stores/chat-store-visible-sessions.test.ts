import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  selectSessionMessages,
  selectSessionTodos,
} from "@/lib/chat/session-scoped-selectors";
import type {
  MessageWithParts,
  Session,
  SessionStatus,
} from "@/lib/opencode/types";
import { WORKBENCH_PATH } from "@/lib/workbench/workbench-href";
import { useAttentionStore } from "@/stores/attention-store";
import {
  _resetModuleCaches,
  EMPTY_MESSAGES,
  EMPTY_TODOS,
  resetTurnCompletionTracker,
  useChatStore,
  type WorkspaceState,
} from "@/stores/chat-store";

vi.mock("@/lib/sounds", () => ({ playSoundForEvent: vi.fn() }));
vi.mock("@/lib/notifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications")>()),
  showBrowserNotification: vi.fn(),
}));
vi.mock("@/lib/git/git-status-refresh", () => ({
  requestGitStatusRefresh: vi.fn(),
}));

const WS = "ws-1";
const OTHER_WS = "ws-2";
const BUSY: SessionStatus = { type: "busy" };
const OTHER_SESSION_IDS = Array.from(
  { length: 16 },
  (_, index) => `sess-${index}`,
);
const realFetchMessages = useChatStore.getState().fetchMessages;
const fetchMock = vi.fn(async () => Response.json([]));

function makeSession(id: string, parentID?: string): Session {
  return {
    id,
    parentID,
    projectID: "proj-1",
    directory: "/workspace",
    title: `Session ${id}`,
    version: "1",
    time: { created: 1000, updated: 1000 },
  };
}

function userMessage(sessionID: string): MessageWithParts {
  return {
    info: {
      id: `msg-${sessionID}`,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
    },
    parts: [],
  };
}

function workspaceState(overrides: Partial<WorkspaceState>): WorkspaceState {
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

function seedWorkspace(
  sessions: readonly Session[],
  sessionStatuses: Record<string, SessionStatus> = {},
): void {
  useChatStore.setState({
    workspaceStates: {
      [WS]: workspaceState({
        sessions: Object.fromEntries(
          sessions.map((session) => [session.id, session]),
        ),
        messages: Object.fromEntries(
          sessions.map((session) => [session.id, [userMessage(session.id)]]),
        ),
        sessionStatuses,
      }),
    },
  });
}

function cachedMessages(sessionId: string): MessageWithParts[] | undefined {
  return useChatStore.getState().workspaceStates[WS]?.messages[sessionId];
}

function activateOtherSessions(): void {
  for (const sessionId of OTHER_SESSION_IDS) {
    useChatStore.getState().setActiveSession(sessionId);
  }
}

function openEventStream(): void {
  const source = useChatStore.getState().globalEventSource;
  if (!source) throw new Error("Expected the store to open an event stream");
  source.onopen?.call(source, new Event("open"));
}

function markEventStreamOpen(): void {
  const source = useChatStore.getState().globalEventSource;
  if (!source) throw new Error("Expected the store to open an event stream");
  Object.defineProperty(source, "readyState", { value: EventSource.OPEN });
}

function spyOnFetchMessages() {
  return vi.spyOn(useChatStore.getState(), "fetchMessages").mockResolvedValue();
}

beforeEach(() => {
  _resetModuleCaches();
  resetTurnCompletionTracker();
  useChatStore.getState().disconnectGlobalSSE();
  useChatStore.getState().clearStreamingPoll();
  useChatStore.setState({
    workspaceStates: {},
    messageAccessOrder: [],
    visibleSessionKeys: {},
    activeWorkspaceId: null,
    activeSessionId: null,
    streamingError: null,
    optimisticStreamingSessionId: null,
    sseWorkspaceIds: [],
    sseReconnectAttempts: 0,
    engineRev: 0,
    sseGeneration: 0,
    fetchMessages: realFetchMessages,
  });
  useAttentionStore.setState({ unseenFinishedKeys: [] });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  useChatStore.getState().disconnectGlobalSSE();
  _resetModuleCaches();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("visible session registry", () => {
  it("keeps a session visible while one of two registrations remains", () => {
    // Given
    const store = useChatStore.getState();
    store.registerVisibleSession(WS, "sess-a");
    store.registerVisibleSession(WS, "sess-a");

    // When
    store.unregisterVisibleSession(WS, "sess-a");

    // Then
    expect(useChatStore.getState().visibleSessionKeys).toEqual({
      "ws-1:sess-a": 1,
    });
  });

  it("forgets a session once every registration is released", () => {
    // Given
    const store = useChatStore.getState();
    store.registerVisibleSession(WS, "sess-a");
    store.registerVisibleSession(WS, "sess-a");
    store.unregisterVisibleSession(WS, "sess-a");

    // When
    store.unregisterVisibleSession(WS, "sess-a");

    // Then
    expect(useChatStore.getState().visibleSessionKeys).toEqual({});
  });

  it("moves a newly visible session to the front of the message cache order", () => {
    // Given
    useChatStore.setState({
      messageAccessOrder: [{ sessionId: "sess-b", workspaceId: WS }],
    });

    // When
    useChatStore.getState().registerVisibleSession(WS, "sess-a");

    // Then
    expect(useChatStore.getState().messageAccessOrder).toEqual([
      { sessionId: "sess-a", workspaceId: WS },
      { sessionId: "sess-b", workspaceId: WS },
    ]);
  });

  it("never persists the visible sessions", () => {
    // Given
    useChatStore.getState().registerVisibleSession(WS, "sess-a");

    // When
    const persisted = useChatStore.persist
      .getOptions()
      .partialize?.(useChatStore.getState());

    // Then
    expect(persisted).not.toHaveProperty("visibleSessionKeys");
  });

  it("exports the stable empty lists the session selectors fall back to", () => {
    // When
    const state = useChatStore.getState();

    // Then
    expect(selectSessionMessages(WS, "sess-missing")(state)).toBe(
      EMPTY_MESSAGES,
    );
    expect(selectSessionTodos(WS, "sess-missing")(state)).toBe(EMPTY_TODOS);
  });
});

describe("message cache eviction with visible sessions", () => {
  beforeEach(() => {
    seedWorkspace(
      ["sess-visible", ...OTHER_SESSION_IDS].map((id) => makeSession(id)),
    );
    useChatStore.setState({ activeWorkspaceId: WS });
  });

  it("keeps a visible session's messages after 16 other sessions are activated", () => {
    // Given
    useChatStore.getState().registerVisibleSession(WS, "sess-visible");

    // When
    activateOtherSessions();

    // Then
    expect(cachedMessages("sess-visible")).toEqual([
      userMessage("sess-visible"),
    ]);
  });

  it("evicts the oldest hidden session instead of the visible one", () => {
    // Given
    useChatStore.getState().registerVisibleSession(WS, "sess-visible");

    // When
    activateOtherSessions();

    // Then
    expect(cachedMessages("sess-0")).toBeUndefined();
    expect(useChatStore.getState().messageAccessOrder).toHaveLength(15);
  });

  it("evicts a session's messages after 16 other sessions are activated once it is no longer visible", () => {
    // Given
    useChatStore.getState().registerVisibleSession(WS, "sess-visible");
    useChatStore.getState().unregisterVisibleSession(WS, "sess-visible");

    // When
    activateOtherSessions();

    // Then
    expect(cachedMessages("sess-visible")).toBeUndefined();
  });
});

describe("reconnect refetch of visible sessions", () => {
  it("refetches a visible session that is not active when the event stream opens", () => {
    // Given
    useChatStore.setState({
      activeWorkspaceId: WS,
      activeSessionId: "sess-active",
    });
    useChatStore.getState().registerVisibleSession(WS, "sess-visible");
    const fetchMessages = spyOnFetchMessages();
    useChatStore.getState().connectGlobalSSE([WS]);

    // When
    openEventStream();

    // Then
    expect(fetchMessages).toHaveBeenCalledWith("sess-visible", WS, {
      force: true,
    });
  });

  it("skips a visible session whose workspace is not on the event stream", () => {
    // Given
    useChatStore.getState().registerVisibleSession(OTHER_WS, "sess-elsewhere");
    const fetchMessages = spyOnFetchMessages();
    useChatStore.getState().connectGlobalSSE([WS]);

    // When
    openEventStream();

    // Then
    expect(fetchMessages).not.toHaveBeenCalled();
  });

  it("refetches the active session only once when it is also visible", () => {
    // Given
    useChatStore.setState({
      activeWorkspaceId: WS,
      activeSessionId: "sess-active",
    });
    useChatStore.getState().registerVisibleSession(WS, "sess-active");
    const fetchMessages = spyOnFetchMessages();
    useChatStore.getState().connectGlobalSSE([WS]);

    // When
    openEventStream();

    // Then
    expect(fetchMessages).toHaveBeenCalledTimes(1);
  });

  it("refetches a visible session that is not active when the page becomes visible with the stream still open", () => {
    // Given
    useChatStore.setState({
      activeWorkspaceId: WS,
      activeSessionId: "sess-active",
    });
    useChatStore.getState().registerVisibleSession(WS, "sess-visible");
    useChatStore.getState().connectGlobalSSE([WS]);
    markEventStreamOpen();
    const fetchMessages = spyOnFetchMessages();

    // When
    useChatStore.getState().handleVisibilityRestored();

    // Then
    expect(fetchMessages).toHaveBeenCalledWith("sess-visible", WS, {
      force: true,
    });
  });
});

describe("finished turns of sessions shown on the workbench", () => {
  const rootSession = makeSession("sess-root");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    window.history.replaceState({}, "", WORKBENCH_PATH);
    useChatStore.setState({ sseWorkspaceIds: [WS] });
  });

  function finishRootTurn(): void {
    useChatStore
      .getState()
      .handleEvent(
        { type: "session.idle", properties: { sessionID: "sess-root" } },
        WS,
      );
  }

  function unseenKeys(): readonly string[] {
    return useAttentionStore.getState().unseenFinishedKeys;
  }

  it("keeps a finished root seen when it is visible but not active", () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": BUSY });
    useChatStore.getState().registerVisibleSession(WS, "sess-root");

    // When
    finishRootTurn();

    // Then
    expect(unseenKeys()).toEqual([]);
  });

  it("keeps a finished root seen when one of its subagents is visible", () => {
    // Given
    seedWorkspace([rootSession, makeSession("sess-child", "sess-root")], {
      "sess-root": BUSY,
    });
    useChatStore.getState().registerVisibleSession(WS, "sess-child");

    // When
    finishRootTurn();

    // Then
    expect(unseenKeys()).toEqual([]);
  });

  it("keeps a finished root seen when it is the active session", () => {
    // Given
    seedWorkspace([rootSession], { "sess-root": BUSY });
    useChatStore.setState({
      activeWorkspaceId: WS,
      activeSessionId: "sess-root",
    });

    // When
    finishRootTurn();

    // Then
    expect(unseenKeys()).toEqual([]);
  });

  it("marks a finished root unseen when only an unrelated session is visible", () => {
    // Given
    seedWorkspace([rootSession, makeSession("sess-other")], {
      "sess-root": BUSY,
    });
    useChatStore.getState().registerVisibleSession(WS, "sess-other");

    // When
    finishRootTurn();

    // Then
    expect(unseenKeys()).toEqual(["ws-1:sess-root"]);
  });
});

describe("getStreamingStatus", () => {
  it("still reports error without an active session while streamingError is set", () => {
    // Given
    useChatStore.setState({ streamingError: "LLM quota exceeded" });

    // When
    const status = useChatStore.getState().getStreamingStatus();

    // Then
    expect(status).toBe("error");
  });
});
