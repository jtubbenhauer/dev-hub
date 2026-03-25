/**
 * Tests for the chat store's multi-workspace and multi-session behaviour.
 *
 * Approach:
 *  - Each test resets the store to a clean slate via `resetStore()`.
 *  - `fetch` is mocked globally; individual tests stub it as needed.
 *  - SSE is driven through the MockEventSource defined in tests/setup.ts.
 *  - The module-level memoisation caches in the store are reset between tests
 *    by re-importing the store factory — achieved via `vi.resetModules()` in
 *    the beforeEach of suites that need a completely fresh module.
 *  - Where the store is imported directly, we call `useChatStore.setState`
 *    to reset to a known baseline instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid Session fixture. */
function makeSession(
  id: string,
  opts: { updated?: number; parentID?: string } = {},
) {
  return {
    id,
    projectID: "proj-1",
    directory: "/workspace",
    title: `Session ${id}`,
    version: "1",
    parentID: opts.parentID,
    time: { created: 1000, updated: opts.updated ?? 1000 },
  };
}

/** Minimal valid user Message fixture. */
function makeUserMessage(id: string, sessionID: string) {
  return {
    id,
    sessionID,
    role: "user" as const,
    time: { created: Date.now() },
    agent: "",
    model: { providerID: "", modelID: "" },
  };
}

/** Minimal valid assistant Message fixture. */
function makeAssistantMessage(id: string, sessionID: string) {
  return {
    id,
    sessionID,
    role: "assistant" as const,
    time: { created: Date.now() },
    parentID: "",
    modelID: "",
    providerID: "",
    mode: "",
    path: { cwd: "", root: "" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

/** Convenience alias — returns the appropriate fixture based on role. */
function makeMessage(
  id: string,
  sessionID: string,
  role: "user" | "assistant" = "user",
) {
  if (role === "assistant") return makeAssistantMessage(id, sessionID);
  return makeUserMessage(id, sessionID);
}

/** Minimal valid Part fixture. */
function makePart(id: string, sessionID: string, messageID: string) {
  return {
    id,
    sessionID,
    messageID,
    type: "text" as const,
    text: "hello",
  };
}

/** Minimal valid Permission fixture. */
function makePermission(id: string, sessionID: string) {
  return {
    id,
    sessionID,
    permission: "bash",
    patterns: [],
    metadata: {},
    always: [],
  };
}

/** Minimal valid QuestionRequest fixture. */
function makeQuestion(id: string, sessionID: string) {
  return {
    id,
    sessionID,
    questions: [
      {
        question: "Continue?",
        header: "Confirm",
        options: [{ label: "Yes", description: "" }],
        multiple: false,
        custom: false,
      },
    ],
  };
}

/** Fire a synthetic SSE event through the store's handleEvent. */
function _emitEvent(
  handleEvent: (
    event: Record<string, unknown>,
    sourceWorkspaceId: string,
  ) => void,
  type: string,
  properties: Record<string, unknown>,
  sourceWorkspaceId: string,
) {
  handleEvent({ type, properties }, sourceWorkspaceId);
}

// ---------------------------------------------------------------------------
// Store import — done lazily so vi.resetModules() works per suite
// ---------------------------------------------------------------------------

// We import the store once for suites that don't need module isolation.
// Suites that need full module re-initialisation use dynamic import inside
// a beforeEach after calling vi.resetModules().

import { useChatStore } from "../../stores/chat-store";

/** Reset the store to a pristine state between tests. */
function resetStore() {
  useChatStore.setState({
    workspaceStates: {},
    activeWorkspaceId: null,
    activeSessionId: null,
    streamingError: null,
    streamingPollInterval: null,
    optimisticStreamingSessionId: null,
  });
}

// ---------------------------------------------------------------------------
// 1. Workspace state isolation
// ---------------------------------------------------------------------------

describe("workspace state isolation", () => {
  beforeEach(resetStore);

  it("each workspace has its own independent sessions map", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-a") } },
      "ws-a",
    );
    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-b") } },
      "ws-b",
    );

    const wsA = useChatStore.getState().workspaceStates["ws-a"];
    const wsB = useChatStore.getState().workspaceStates["ws-b"];

    expect(wsA.sessions["sess-a"]).toBeDefined();
    expect(wsA.sessions["sess-b"]).toBeUndefined();
    expect(wsB.sessions["sess-b"]).toBeDefined();
    expect(wsB.sessions["sess-a"]).toBeUndefined();
  });

  it("session statuses are scoped per workspace", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-a") } },
      "ws-a",
    );
    store.handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "sess-a", status: { type: "busy" } },
      },
      "ws-a",
    );
    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-b") } },
      "ws-b",
    );
    store.handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "sess-b", status: { type: "idle" } },
      },
      "ws-b",
    );

    const { workspaceStates } = useChatStore.getState();
    expect(workspaceStates["ws-a"].sessionStatuses["sess-a"]).toEqual({
      type: "busy",
    });
    expect(workspaceStates["ws-b"].sessionStatuses["sess-b"]).toEqual({
      type: "idle",
    });
    // No cross-contamination
    expect(workspaceStates["ws-a"].sessionStatuses["sess-b"]).toBeUndefined();
    expect(workspaceStates["ws-b"].sessionStatuses["sess-a"]).toBeUndefined();
  });

  it("permissions are scoped per workspace and not shared", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-a") } },
      "ws-a",
    );
    store.handleEvent(
      {
        type: "permission.asked",
        properties: makePermission("perm-1", "sess-a"),
      },
      "ws-a",
    );

    const { workspaceStates } = useChatStore.getState();
    expect(workspaceStates["ws-a"].permissions).toHaveLength(1);
    expect(workspaceStates["ws-b"]?.permissions ?? []).toHaveLength(0);
  });

  it("questions are scoped per workspace and deduplicated on SSE replay", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-a") } },
      "ws-a",
    );
    const q = makeQuestion("q-1", "sess-a");
    store.handleEvent({ type: "question.asked", properties: q }, "ws-a");
    // Replay (SSE reconnect)
    store.handleEvent({ type: "question.asked", properties: q }, "ws-a");

    const { workspaceStates } = useChatStore.getState();
    expect(workspaceStates["ws-a"].questions).toHaveLength(1);
  });

  it("messages are scoped per workspace — background workspace messages do not appear in active workspace selectors", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-a") } },
      "ws-a",
    );
    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-b") } },
      "ws-b",
    );
    store.handleEvent(
      {
        type: "message.updated",
        properties: { info: makeMessage("msg-a", "sess-a") },
      },
      "ws-a",
    );

    useChatStore.setState({
      activeWorkspaceId: "ws-b",
      activeSessionId: "sess-b",
    });

    const messages = useChatStore.getState().getActiveSessionMessages();
    expect(messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Workspace switching
// ---------------------------------------------------------------------------

describe("workspace switching", () => {
  beforeEach(resetStore);

  it("switching workspace resets activeSessionId to null", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });
    useChatStore.getState().setActiveWorkspaceId("ws-b");
    expect(useChatStore.getState().activeSessionId).toBeNull();
  });

  it("switching workspace clears a streaming error from the previous workspace", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      streamingError: "something went wrong",
    });
    useChatStore.getState().setActiveWorkspaceId("ws-b");
    expect(useChatStore.getState().streamingError).toBeNull();
  });

  it("switching to the same workspace is a no-op", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      streamingError: null,
    });
    useChatStore.getState().setActiveWorkspaceId("ws-a");
    // activeSessionId must not have been reset
    expect(useChatStore.getState().activeSessionId).toBe("sess-a");
  });

  it("getStreamingStatus returns idle immediately after switching workspace (no active session)", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      optimisticStreamingSessionId: "sess-a",
    });

    useChatStore.getState().setActiveWorkspaceId("ws-b");

    // No active session on ws-b yet → must be idle
    expect(useChatStore.getState().getStreamingStatus()).toBe("idle");
  });

  it("getStreamingStatus reflects the correct workspace after switching back", () => {
    // ws-a session is busy (SSE confirmed)
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      streamingError: null,
      streamingPollInterval: null,
      optimisticStreamingSessionId: null,
    });

    expect(useChatStore.getState().getStreamingStatus()).toBe("streaming");

    // Switch away then back
    useChatStore.getState().setActiveWorkspaceId("ws-b");
    useChatStore.setState({
      activeSessionId: "sess-a",
      activeWorkspaceId: "ws-a",
    });

    expect(useChatStore.getState().getStreamingStatus()).toBe("streaming");
  });
});

// ---------------------------------------------------------------------------
// 3. getStreamingStatus selector
// ---------------------------------------------------------------------------

describe("getStreamingStatus selector", () => {
  beforeEach(resetStore);

  it("returns idle when no workspace is active", () => {
    expect(useChatStore.getState().getStreamingStatus()).toBe("idle");
  });

  it("returns idle when active workspace has no active session", () => {
    useChatStore.setState({ activeWorkspaceId: "ws-a", activeSessionId: null });
    expect(useChatStore.getState().getStreamingStatus()).toBe("idle");
  });

  it("returns streaming when session status is busy (SSE-confirmed)", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });
    expect(useChatStore.getState().getStreamingStatus()).toBe("streaming");
  });

  it("returns streaming when session status is retry", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {
            "sess-a": {
              type: "retry",
              attempt: 1,
              message: "Retrying…",
              next: Date.now() + 5000,
            },
          },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });
    expect(useChatStore.getState().getStreamingStatus()).toBe("streaming");
  });

  it("returns idle when SSE confirms session is idle", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "idle" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      optimisticStreamingSessionId: null,
    });
    expect(useChatStore.getState().getStreamingStatus()).toBe("idle");
  });

  it("returns streaming optimistically before first SSE event arrives", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      optimisticStreamingSessionId: "sess-a",
    });
    expect(useChatStore.getState().getStreamingStatus()).toBe("streaming");
  });

  it("returns waiting when there is a pending permission for the active session", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [makePermission("perm-1", "sess-a")],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });
    expect(useChatStore.getState().getStreamingStatus()).toBe("waiting");
  });

  it("returns waiting when there is a pending question for the active session", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [makeQuestion("q-1", "sess-a")],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });
    expect(useChatStore.getState().getStreamingStatus()).toBe("waiting");
  });

  it("returns error when streamingError is set, even if session is busy", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      streamingError: "LLM quota exceeded",
    });
    expect(useChatStore.getState().getStreamingStatus()).toBe("error");
  });

  it("optimistic flag for a different session does not show as streaming for the active session", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      // This is for a *different* session
      optimisticStreamingSessionId: "sess-other",
    });
    expect(useChatStore.getState().getStreamingStatus()).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// 4. SSE event handling — session lifecycle
// ---------------------------------------------------------------------------

describe("SSE event handling — session lifecycle", () => {
  beforeEach(resetStore);

  it("session.created adds the session to the correct workspace", () => {
    const store = useChatStore.getState();
    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-1") } },
      "ws-a",
    );
    expect(
      useChatStore.getState().workspaceStates["ws-a"].sessions["sess-1"],
    ).toBeDefined();
  });

  it("session.updated merges fields without replacing the whole sessions map", () => {
    const store = useChatStore.getState();
    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-1") } },
      "ws-a",
    );
    store.handleEvent(
      {
        type: "session.updated",
        properties: {
          info: { ...makeSession("sess-1"), title: "Updated title" },
        },
      },
      "ws-a",
    );
    expect(
      useChatStore.getState().workspaceStates["ws-a"].sessions["sess-1"].title,
    ).toBe("Updated title");
  });

  it("session.deleted removes the session from the workspace", () => {
    const store = useChatStore.getState();
    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-1") } },
      "ws-a",
    );
    store.handleEvent(
      { type: "session.deleted", properties: { info: makeSession("sess-1") } },
      "ws-a",
    );
    expect(
      useChatStore.getState().workspaceStates["ws-a"].sessions["sess-1"],
    ).toBeUndefined();
  });

  it("session.status (busy) transitions streaming status to streaming", () => {
    const store = useChatStore.getState();
    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-1") } },
      "ws-a",
    );
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-1",
    });

    store.handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "sess-1", status: { type: "busy" } },
      },
      "ws-a",
    );

    expect(useChatStore.getState().getStreamingStatus()).toBe("streaming");
  });

  it("session.status (idle) transitions streaming status back to idle", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-1": makeSession("sess-1") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-1": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-1",
      optimisticStreamingSessionId: "sess-1",
    });

    useChatStore.getState().handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "sess-1", status: { type: "idle" } },
      },
      "ws-a",
    );

    expect(useChatStore.getState().getStreamingStatus()).toBe("idle");
    expect(useChatStore.getState().optimisticStreamingSessionId).toBeNull();
  });

  it("session.idle transitions streaming status to idle and clears optimistic flag", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-1": makeSession("sess-1") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-1": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-1",
      optimisticStreamingSessionId: "sess-1",
    });

    useChatStore
      .getState()
      .handleEvent(
        { type: "session.idle", properties: { sessionID: "sess-1" } },
        "ws-a",
      );

    expect(useChatStore.getState().getStreamingStatus()).toBe("idle");
    expect(useChatStore.getState().optimisticStreamingSessionId).toBeNull();
  });

  it("session.error for the active session sets streamingError and clears optimistic flag", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-1": makeSession("sess-1") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-1",
      optimisticStreamingSessionId: "sess-1",
    });

    useChatStore.getState().handleEvent(
      {
        type: "session.error",
        properties: {
          sessionID: "sess-1",
          error: { data: { message: "context window exceeded" } },
        },
      },
      "ws-a",
    );

    expect(useChatStore.getState().streamingError).toBe(
      "context window exceeded",
    );
    expect(useChatStore.getState().optimisticStreamingSessionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Cross-workspace SSE routing — the stale streaming state scenario
// ---------------------------------------------------------------------------

describe("cross-workspace SSE routing", () => {
  beforeEach(resetStore);

  it("session.idle from a background workspace updates its sessionStatuses regardless of active workspace", () => {
    // Set up: ws-a has a streaming session, ws-b is active
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
        "ws-b": {
          sessions: { "sess-b": makeSession("sess-b") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-b",
      activeSessionId: "sess-b",
      optimisticStreamingSessionId: null,
    });

    // SSE idle event arrives for ws-a while user is on ws-b
    useChatStore
      .getState()
      .handleEvent(
        { type: "session.idle", properties: { sessionID: "sess-a" } },
        "ws-a",
      );

    // ws-a's sessionStatus must be idle
    expect(
      useChatStore.getState().workspaceStates["ws-a"].sessionStatuses["sess-a"],
    ).toEqual({ type: "idle" });
  });

  it("session.status (idle) from a background workspace updates sessionStatuses in that workspace", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-b",
      activeSessionId: "sess-b",
    });

    useChatStore.getState().handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "sess-a", status: { type: "idle" } },
      },
      "ws-a",
    );

    expect(
      useChatStore.getState().workspaceStates["ws-a"].sessionStatuses["sess-a"],
    ).toEqual({ type: "idle" });
  });

  // REGRESSION: this is the exact reported bug scenario.
  // When user switches back to ws-a after ws-a's session went idle while they
  // were on ws-b, the streaming status must be idle — not streaming.
  it("REGRESSION: switching back to a workspace whose session went idle while backgrounded shows idle status", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
        "ws-b": {
          sessions: {},
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-b",
      activeSessionId: null,
      optimisticStreamingSessionId: "sess-a", // was set before the switch
    });

    // SSE idle event arrives while user is on ws-b
    useChatStore
      .getState()
      .handleEvent(
        { type: "session.idle", properties: { sessionID: "sess-a" } },
        "ws-a",
      );

    // User switches back to ws-a and the most-recent session is auto-selected
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    expect(useChatStore.getState().getStreamingStatus()).toBe("idle");
  });

  it("optimisticStreamingSessionId is cleared when the session goes idle, even if it belongs to a background workspace", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-b",
      activeSessionId: null,
      optimisticStreamingSessionId: "sess-a",
    });

    useChatStore
      .getState()
      .handleEvent(
        { type: "session.idle", properties: { sessionID: "sess-a" } },
        "ws-a",
      );

    expect(useChatStore.getState().optimisticStreamingSessionId).toBeNull();
  });

  it("background workspace session.status (idle) clears optimisticStreamingSessionId when it matches", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-b",
      activeSessionId: null,
      optimisticStreamingSessionId: "sess-a",
    });

    useChatStore.getState().handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "sess-a", status: { type: "idle" } },
      },
      "ws-a",
    );

    expect(useChatStore.getState().optimisticStreamingSessionId).toBeNull();
  });

  it("getWorkspaceActivity reflects busy state for background workspace", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-b",
      activeSessionId: null,
    });

    expect(useChatStore.getState().getWorkspaceActivity("ws-a")).toBe("active");
  });

  it("getWorkspaceActivity reflects waiting state when workspace has pending permissions", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [makePermission("perm-1", "sess-a")],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-b",
      activeSessionId: null,
    });

    expect(useChatStore.getState().getWorkspaceActivity("ws-a")).toBe(
      "waiting",
    );
  });

  it("getActiveQuestionSessionIds returns session IDs with pending questions", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: {
            "sess-a": makeSession("sess-a"),
            "sess-b": makeSession("sess-b"),
          },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [{ id: "q-1", sessionID: "sess-a" } as never],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    const ids = useChatStore.getState().getActiveQuestionSessionIds();
    expect(ids.has("sess-a")).toBe(true);
    expect(ids.has("sess-b")).toBe(false);
  });

  it("getUnifiedQuestionSessionIds merges question session IDs across workspaces", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [{ id: "q-1", sessionID: "sess-a" } as never],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
        "ws-b": {
          sessions: { "sess-b": makeSession("sess-b") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [{ id: "q-2", sessionID: "sess-b" } as never],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: null,
    });

    const ids = useChatStore.getState().getUnifiedQuestionSessionIds();
    expect(ids.has("sess-a")).toBe(true);
    expect(ids.has("sess-b")).toBe(true);
    expect(ids.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 6. Message routing and optimistic updates
// ---------------------------------------------------------------------------

describe("message routing", () => {
  beforeEach(resetStore);

  it("message.updated routes to the workspace that owns the session", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-a") } },
      "ws-a",
    );
    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-b") } },
      "ws-b",
    );

    // Send event from ws-b's SSE connection but it belongs to sess-a (ws-a owns it)
    store.handleEvent(
      {
        type: "message.updated",
        properties: { info: makeMessage("msg-1", "sess-a") },
      },
      "ws-b", // wrong source workspace
    );

    const { workspaceStates } = useChatStore.getState();
    // Should land in ws-a, not ws-b
    expect(workspaceStates["ws-a"].messages["sess-a"]).toHaveLength(1);
    expect(workspaceStates["ws-b"].messages["sess-b"] ?? []).toHaveLength(0);
  });

  it("message.updated appends new messages and upserts existing ones", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-a") } },
      "ws-a",
    );
    store.handleEvent(
      {
        type: "message.updated",
        properties: { info: makeMessage("msg-1", "sess-a") },
      },
      "ws-a",
    );
    // Upsert — same ID with different data
    store.handleEvent(
      {
        type: "message.updated",
        properties: {
          info: { ...makeMessage("msg-1", "sess-a"), agent: "updated-agent" },
        },
      },
      "ws-a",
    );

    const messages =
      useChatStore.getState().workspaceStates["ws-a"].messages["sess-a"];
    expect(messages).toHaveLength(1);
    const info = messages[0].info as { agent: string };
    expect(info.agent).toBe("updated-agent");
  });

  it("message.removed deletes the correct message from the correct session", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-a") } },
      "ws-a",
    );
    store.handleEvent(
      {
        type: "message.updated",
        properties: { info: makeMessage("msg-1", "sess-a") },
      },
      "ws-a",
    );
    store.handleEvent(
      {
        type: "message.updated",
        properties: { info: makeMessage("msg-2", "sess-a") },
      },
      "ws-a",
    );
    store.handleEvent(
      {
        type: "message.removed",
        properties: { sessionID: "sess-a", messageID: "msg-1" },
      },
      "ws-a",
    );

    const messages =
      useChatStore.getState().workspaceStates["ws-a"].messages["sess-a"];
    expect(messages).toHaveLength(1);
    expect(messages[0].info.id).toBe("msg-2");
  });

  it("optimistic user message is replaced when the real message.updated arrives", () => {
    // Simulate what sendMessage does: inject an optimistic message
    const optimisticId = "optimistic-123";
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {
            "sess-a": [
              {
                info: makeUserMessage(optimisticId, "sess-a"),
                parts: [makePart("p-opt", "sess-a", optimisticId)],
              },
            ],
          },
          optimisticMessageIds: { "sess-a": optimisticId },
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    // Real message arrives from SSE with a server-assigned ID
    useChatStore.getState().handleEvent(
      {
        type: "message.updated",
        properties: { info: makeMessage("server-msg-1", "sess-a", "user") },
      },
      "ws-a",
    );

    const messages =
      useChatStore.getState().workspaceStates["ws-a"].messages["sess-a"];
    // Optimistic message must be gone, replaced by the real one
    expect(messages).toHaveLength(1);
    expect(messages[0].info.id).toBe("server-msg-1");
    // optimisticMessageIds must be cleared for this session
    expect(
      useChatStore.getState().workspaceStates["ws-a"].optimisticMessageIds[
        "sess-a"
      ],
    ).toBeUndefined();
  });

  it("message.part.updated batches and flushes part updates into the correct message", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {
            "sess-a": [
              { info: makeAssistantMessage("msg-1", "sess-a"), parts: [] },
            ],
          },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    useChatStore.getState().handleEvent(
      {
        type: "message.part.updated",
        properties: { part: makePart("part-1", "sess-a", "msg-1") },
      },
      "ws-a",
    );

    // RAF was shimmed to flush synchronously in setup.ts
    const messages =
      useChatStore.getState().workspaceStates["ws-a"].messages["sess-a"];
    expect(messages[0].parts).toHaveLength(1);
    expect(messages[0].parts[0].id).toBe("part-1");
  });

  it("message.part.removed removes the correct part", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {
            "sess-a": [
              {
                info: makeAssistantMessage("msg-1", "sess-a"),
                parts: [
                  makePart("part-1", "sess-a", "msg-1"),
                  makePart("part-2", "sess-a", "msg-1"),
                ],
              },
            ],
          },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    useChatStore.getState().handleEvent(
      {
        type: "message.part.removed",
        properties: {
          sessionID: "sess-a",
          messageID: "msg-1",
          partID: "part-1",
        },
      },
      "ws-a",
    );

    const parts =
      useChatStore.getState().workspaceStates["ws-a"].messages["sess-a"][0]
        .parts;
    expect(parts).toHaveLength(1);
    expect(parts[0].id).toBe("part-2");
  });
});

// ---------------------------------------------------------------------------
// 7. Permission and question lifecycle
// ---------------------------------------------------------------------------

describe("permission lifecycle", () => {
  beforeEach(resetStore);

  it("permission.asked adds permission to the owning workspace", () => {
    useChatStore.getState().handleEvent(
      {
        type: "session.created",
        properties: { info: makeSession("sess-a") },
      },
      "ws-a",
    );
    useChatStore.getState().handleEvent(
      {
        type: "permission.asked",
        properties: makePermission("perm-1", "sess-a"),
      },
      "ws-a",
    );

    expect(
      useChatStore.getState().workspaceStates["ws-a"].permissions,
    ).toHaveLength(1);
  });

  it("permission.replied removes the permission from all workspaces", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: {},
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [makePermission("perm-1", "sess-a")],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    useChatStore
      .getState()
      .handleEvent(
        { type: "permission.replied", properties: { requestID: "perm-1" } },
        "ws-a",
      );

    expect(
      useChatStore.getState().workspaceStates["ws-a"].permissions,
    ).toHaveLength(0);
  });

  it("pending permission makes getStreamingStatus return waiting", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [makePermission("perm-1", "sess-a")],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    expect(useChatStore.getState().getStreamingStatus()).toBe("waiting");
  });

  it("after permission.replied the status returns to streaming (not idle)", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [makePermission("perm-1", "sess-a")],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    useChatStore
      .getState()
      .handleEvent(
        { type: "permission.replied", properties: { requestID: "perm-1" } },
        "ws-a",
      );

    expect(useChatStore.getState().getStreamingStatus()).toBe("streaming");
  });
});

describe("question lifecycle", () => {
  beforeEach(resetStore);

  it("question.asked adds the question and makes status waiting", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    useChatStore
      .getState()
      .handleEvent(
        { type: "question.asked", properties: makeQuestion("q-1", "sess-a") },
        "ws-a",
      );

    expect(
      useChatStore.getState().workspaceStates["ws-a"].questions,
    ).toHaveLength(1);
    expect(useChatStore.getState().getStreamingStatus()).toBe("waiting");
  });

  it("question.replied removes the question from the owning workspace", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [makeQuestion("q-1", "sess-a")],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    useChatStore
      .getState()
      .handleEvent(
        { type: "question.replied", properties: { requestID: "q-1" } },
        "ws-a",
      );

    expect(
      useChatStore.getState().workspaceStates["ws-a"].questions,
    ).toHaveLength(0);
  });

  it("question.asked with malformed payload is dropped without throwing", () => {
    expect(() => {
      useChatStore
        .getState()
        .handleEvent(
          { type: "question.asked", properties: { notAnId: true } },
          "ws-a",
        );
    }).not.toThrow();

    expect(
      useChatStore.getState().workspaceStates["ws-a"]?.questions ?? [],
    ).toHaveLength(0);
  });

  it("question.replied resolves using fallback id field when requestID is absent", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [makeQuestion("q-1", "sess-a")],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    // Simulate API renaming the field to "id"
    useChatStore
      .getState()
      .handleEvent(
        { type: "question.replied", properties: { id: "q-1" } },
        "ws-a",
      );

    expect(
      useChatStore.getState().workspaceStates["ws-a"].questions,
    ).toHaveLength(0);
  });

  it("question.rejected resolves using fallback questionID field when requestID is absent", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [makeQuestion("q-2", "sess-a")],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    // Simulate API renaming the field to "questionID"
    useChatStore
      .getState()
      .handleEvent(
        { type: "question.rejected", properties: { questionID: "q-2" } },
        "ws-a",
      );

    expect(
      useChatStore.getState().workspaceStates["ws-a"].questions,
    ).toHaveLength(0);
  });

  it("question.replied with no recognisable ID field is silently dropped", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [makeQuestion("q-3", "sess-a")],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    expect(() => {
      useChatStore
        .getState()
        .handleEvent(
          { type: "question.replied", properties: { unknownField: "q-3" } },
          "ws-a",
        );
    }).not.toThrow();

    // Question remains — event was dropped, not an error
    expect(
      useChatStore.getState().workspaceStates["ws-a"].questions,
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 8. SSE connection management
// ---------------------------------------------------------------------------

describe("SSE connection management", () => {
  beforeEach(resetStore);

  it("connectGlobalSSE stores a globalEventSource", () => {
    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    expect(useChatStore.getState().globalEventSource).not.toBeNull();
  });

  it("connectGlobalSSE closes old EventSource after new one opens (overlap strategy)", () => {
    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const first = useChatStore.getState().globalEventSource!;
    const closeSpy = vi.spyOn(first, "close");

    useChatStore.getState().connectGlobalSSE(["ws-a", "ws-b"]);

    expect(closeSpy).not.toHaveBeenCalled();

    const second = useChatStore.getState().globalEventSource!;
    second.onopen?.(new Event("open"));

    expect(closeSpy).toHaveBeenCalled();
  });

  it("disconnectGlobalSSE closes and nulls the globalEventSource", () => {
    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const es = useChatStore.getState().globalEventSource!;
    const closeSpy = vi.spyOn(es, "close");

    useChatStore.getState().disconnectGlobalSSE();

    expect(closeSpy).toHaveBeenCalled();
    expect(useChatStore.getState().globalEventSource).toBeNull();
  });

  it("SSE onopen resets reconnect attempts counter", () => {
    useChatStore.setState({
      sseReconnectAttempts: 5,
    });

    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const es = useChatStore.getState().globalEventSource as unknown as {
      simulateOpen: () => void;
    };
    es.simulateOpen();

    expect(useChatStore.getState().sseReconnectAttempts).toBe(0);
  });

  it("SSE onopen clears a stale streamingError when it fires for the active workspace", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      streamingError: "previous error",
    });

    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const es = useChatStore.getState().globalEventSource as unknown as {
      simulateOpen: () => void;
    };
    es.simulateOpen();

    expect(useChatStore.getState().streamingError).toBeNull();
  });

  it("SSE onerror increments reconnect attempts and nulls the globalEventSource", () => {
    vi.useFakeTimers();

    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const es = useChatStore.getState().globalEventSource as unknown as {
      simulateError: () => void;
    };
    es.simulateError();

    expect(useChatStore.getState().sseReconnectAttempts).toBe(1);
    expect(useChatStore.getState().globalEventSource).toBeNull();

    vi.useRealTimers();
  });

  it("SSE onopen seeds questions missed during disconnect", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/question")) {
        return Promise.resolve({
          ok: true,
          json: async () => [makeQuestion("q-missed", "sess-a")],
        });
      }
      // permission endpoint, session/status, session list — all return benign empty responses
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      // Not the active workspace — avoids fetchMessages/refreshActiveSessionStatus side effects
      activeWorkspaceId: null,
      activeSessionId: null,
    });

    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const es = useChatStore.getState().globalEventSource as unknown as {
      simulateOpen: () => void;
    };
    es.simulateOpen();

    // Flush: fetch → .then(res.json()) → async json body → .then(setState) = 4 microtask hops
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      useChatStore.getState().workspaceStates["ws-a"].questions,
    ).toHaveLength(1);
    expect(
      useChatStore.getState().workspaceStates["ws-a"].questions[0].id,
    ).toBe("q-missed");
  });

  it("SSE onopen reconciles permissions — removes stale entries not in server response", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/permission")) {
        // Server no longer has perm-stale (was replied while SSE was down)
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [makePermission("perm-stale", "sess-a")],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: null,
      activeSessionId: null,
    });

    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const es = useChatStore.getState().globalEventSource as unknown as {
      simulateOpen: () => void;
    };
    es.simulateOpen();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      useChatStore.getState().workspaceStates["ws-a"].permissions,
    ).toHaveLength(0);
  });

  it("SSE onopen reconciles questions — removes stale entries not in server response", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/question")) {
        // Server no longer has q-stale (was answered while SSE was down)
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [makeQuestion("q-stale", "sess-a")],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: null,
      activeSessionId: null,
    });

    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const es = useChatStore.getState().globalEventSource as unknown as {
      simulateOpen: () => void;
    };
    es.simulateOpen();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      useChatStore.getState().workspaceStates["ws-a"].questions,
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Streaming poll
// ---------------------------------------------------------------------------

describe("streaming poll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clearStreamingPoll clears the interval and nulls streamingPollInterval", () => {
    // Manually inject a fake interval
    const intervalId = setInterval(() => {}, 9999);
    useChatStore.setState({ streamingPollInterval: intervalId });

    useChatStore.getState().clearStreamingPoll();

    expect(useChatStore.getState().streamingPollInterval).toBeNull();
  });

  it("startStreamingPoll replaces any existing poll with a new one", () => {
    const firstInterval = setInterval(() => {}, 9999);
    useChatStore.setState({ streamingPollInterval: firstInterval });

    // Set up an active streaming session so the poll doesn't self-cancel immediately
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      optimisticStreamingSessionId: null,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ "sess-a": { type: "busy" } }),
    });

    useChatStore.getState().startStreamingPoll("ws-a");

    expect(useChatStore.getState().streamingPollInterval).not.toBe(
      firstInterval,
    );
    expect(useChatStore.getState().streamingPollInterval).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. refreshActiveSessionStatus
// ---------------------------------------------------------------------------

describe("refreshActiveSessionStatus", () => {
  beforeEach(resetStore);

  it("updates sessionStatuses when server returns idle", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ "sess-a": { type: "idle" } }),
    });

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      optimisticStreamingSessionId: "sess-a",
    });

    await useChatStore.getState().refreshActiveSessionStatus("ws-a");

    expect(
      useChatStore.getState().workspaceStates["ws-a"].sessionStatuses["sess-a"],
    ).toEqual({ type: "idle" });
    expect(useChatStore.getState().optimisticStreamingSessionId).toBeNull();
    expect(useChatStore.getState().getStreamingStatus()).toBe("idle");
  });

  it("leaves status unchanged when server returns a non-OK response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: { "sess-a": { type: "busy" } },
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    await useChatStore.getState().refreshActiveSessionStatus("ws-a");

    expect(
      useChatStore.getState().workspaceStates["ws-a"].sessionStatuses["sess-a"],
    ).toEqual({ type: "busy" });
  });

  it("does nothing when there is no active session", async () => {
    global.fetch = vi.fn();
    useChatStore.setState({ activeSessionId: null });

    await useChatStore.getState().refreshActiveSessionStatus("ws-a");

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 11. handleVisibilityRestored
// ---------------------------------------------------------------------------

describe("handleVisibilityRestored", () => {
  beforeEach(resetStore);

  it("reconnects a CLOSED globalEventSource when visibility is restored", () => {
    const closedEs = new EventSource("/fake-url");
    closedEs.close();

    useChatStore.setState({
      globalEventSource: closedEs as unknown as EventSource,
      sseWorkspaceIds: ["ws-a"],
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    const connectGlobalSSESpy = vi.spyOn(
      useChatStore.getState(),
      "connectGlobalSSE",
    );

    useChatStore.getState().handleVisibilityRestored();

    expect(connectGlobalSSESpy).toHaveBeenCalledWith(["ws-a"]);
  });

  it("does not reconnect when globalEventSource is already open", () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const es = useChatStore.getState().globalEventSource!;
    Object.defineProperty(es, "readyState", {
      value: EventSource.OPEN,
      writable: true,
    });

    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    useChatStore.getState().handleVisibilityRestored();

    // The globalEventSource reference must be unchanged — no reconnect happened
    expect(useChatStore.getState().globalEventSource).toBe(es);
  });

  it("reconciles pending questions and permissions when SSE is still open", async () => {
    const pendingQuestion = makeQuestion("q-1", "sess-a");
    const pendingPermission = makePermission("p-1", "sess-a");

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/question")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([pendingQuestion]),
        });
      }
      if (url.includes("/permission")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([pendingPermission]),
        });
      }
      if (url.includes("/session/status")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const es = useChatStore.getState().globalEventSource!;
    Object.defineProperty(es, "readyState", {
      value: EventSource.OPEN,
      writable: true,
    });

    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          sessionsLoaded: true,
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          sessionVariants: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionNotes: {},
        },
      },
    });

    useChatStore.getState().handleVisibilityRestored();

    await vi.waitFor(() => {
      const ws = useChatStore.getState().workspaceStates["ws-a"];
      expect(ws.questions).toHaveLength(1);
      expect(ws.questions[0].id).toBe("q-1");
      expect(ws.permissions).toHaveLength(1);
      expect(ws.permissions[0].id).toBe("p-1");
    });

    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const questionFetch = fetchCalls.find(
      ([url]: [string]) => url.includes("/question") && url.includes("ws-a"),
    );
    const permissionFetch = fetchCalls.find(
      ([url]: [string]) => url.includes("/permission") && url.includes("ws-a"),
    );
    expect(questionFetch).toBeTruthy();
    expect(permissionFetch).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 12. Unified / cross-workspace session list
// ---------------------------------------------------------------------------

describe("getRecentSessionsAcrossWorkspaces", () => {
  beforeEach(resetStore);

  it("returns sessions from all workspaces merged and sorted by updated time", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: {
            "sess-a": makeSession("sess-a", { updated: 2000 }),
            "sess-a2": makeSession("sess-a2", { updated: 500 }),
          },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
        "ws-b": {
          sessions: { "sess-b": makeSession("sess-b", { updated: 1500 }) },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    const sessions = useChatStore
      .getState()
      .getRecentSessionsAcrossWorkspaces(10);
    expect(sessions.map((s) => s.id)).toEqual(["sess-a", "sess-b", "sess-a2"]);
  });

  it("respects the limit parameter", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: {
            "sess-1": makeSession("sess-1", { updated: 3000 }),
            "sess-2": makeSession("sess-2", { updated: 2000 }),
            "sess-3": makeSession("sess-3", { updated: 1000 }),
          },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    const sessions = useChatStore
      .getState()
      .getRecentSessionsAcrossWorkspaces(2);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe("sess-1");
  });

  it("excludes child sessions (those with a parentID)", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: {
            "sess-parent": makeSession("sess-parent", { updated: 2000 }),
            "sess-child": makeSession("sess-child", {
              updated: 3000,
              parentID: "sess-parent",
            }),
          },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    const sessions = useChatStore
      .getState()
      .getRecentSessionsAcrossWorkspaces(10);
    expect(sessions.map((s) => s.id)).toEqual(["sess-parent"]);
  });

  it("returns a stable reference when workspace sessions have not changed", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    const first = useChatStore.getState().getRecentSessionsAcrossWorkspaces(10);
    const second = useChatStore
      .getState()
      .getRecentSessionsAcrossWorkspaces(10);
    expect(first).toBe(second); // reference equality — memoisation working
  });
});

// ---------------------------------------------------------------------------
// 13. clearChat
// ---------------------------------------------------------------------------

describe("clearChat", () => {
  beforeEach(resetStore);

  it("resets activeSessionId, optimisticStreamingSessionId, and streamingError", () => {
    const fakeInterval = setInterval(() => {}, 9999);
    useChatStore.setState({
      activeSessionId: "sess-a",
      optimisticStreamingSessionId: "sess-a",
      streamingError: "oops",
      streamingPollInterval: fakeInterval,
    });

    useChatStore.getState().clearChat();

    expect(useChatStore.getState().activeSessionId).toBeNull();
    expect(useChatStore.getState().optimisticStreamingSessionId).toBeNull();
    expect(useChatStore.getState().streamingError).toBeNull();
    expect(useChatStore.getState().streamingPollInterval).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 14. createSession — message initialization
// ---------------------------------------------------------------------------

describe("createSession — message initialization", () => {
  beforeEach(resetStore);

  it("initializes an empty messages array for the newly created session", async () => {
    const newSession = makeSession("sess-new");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => newSession,
    });

    await useChatStore.getState().createSession("ws-a");

    const ws = useChatStore.getState().workspaceStates["ws-a"];
    expect(ws.messages["sess-new"]).toEqual([]);
  });

  it("does not overwrite existing messages for other sessions in the same workspace", async () => {
    const existingMessages = [
      { info: makeAssistantMessage("msg-1", "sess-existing"), parts: [] },
    ];
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-existing": makeSession("sess-existing") },
          messages: { "sess-existing": existingMessages },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    const newSession = makeSession("sess-new");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => newSession,
    });

    await useChatStore.getState().createSession("ws-a");

    const ws = useChatStore.getState().workspaceStates["ws-a"];
    expect(ws.messages["sess-new"]).toEqual([]);
    expect(ws.messages["sess-existing"]).toHaveLength(1);
  });

  it("sets activeSessionId to the new session", async () => {
    const newSession = makeSession("sess-new");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => newSession,
    });

    await useChatStore.getState().createSession("ws-a");

    expect(useChatStore.getState().activeSessionId).toBe("sess-new");
  });
});

// ---------------------------------------------------------------------------
// 15. fetchMessages — error handling
// ---------------------------------------------------------------------------

describe("fetchMessages — error handling", () => {
  beforeEach(resetStore);

  it("sets empty messages array on HTTP error (non-ok response)", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/sessions/cache/messages"))
        return Promise.resolve({ ok: true, json: async () => null });
      return Promise.resolve({ ok: false, status: 500 });
    });

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    await useChatStore.getState().fetchMessages("sess-a", "ws-a");

    const ws = useChatStore.getState().workspaceStates["ws-a"];
    expect(ws.messages["sess-a"]).toEqual([]);
  });

  it("sets empty messages array on network error (fetch throws)", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/sessions/cache/messages"))
        return Promise.resolve({ ok: true, json: async () => null });
      return Promise.reject(new Error("Network error"));
    });

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    await useChatStore.getState().fetchMessages("sess-a", "ws-a");

    const ws = useChatStore.getState().workspaceStates["ws-a"];
    expect(ws.messages["sess-a"]).toEqual([]);
  });

  it("preserves existing messages on HTTP error (does not clobber)", async () => {
    const existingMessages = [
      { info: makeAssistantMessage("msg-1", "sess-a"), parts: [] },
    ];

    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: { "sess-a": existingMessages },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    await useChatStore.getState().fetchMessages("sess-a", "ws-a");

    const ws = useChatStore.getState().workspaceStates["ws-a"];
    expect(ws.messages["sess-a"]).toHaveLength(1);
    expect(ws.messages["sess-a"][0].info.id).toBe("msg-1");
  });

  it("preserves existing messages on network error (does not clobber)", async () => {
    const existingMessages = [
      { info: makeAssistantMessage("msg-1", "sess-a"), parts: [] },
    ];

    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: { "sess-a": existingMessages },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    await useChatStore.getState().fetchMessages("sess-a", "ws-a");

    const ws = useChatStore.getState().workspaceStates["ws-a"];
    expect(ws.messages["sess-a"]).toHaveLength(1);
    expect(ws.messages["sess-a"][0].info.id).toBe("msg-1");
  });
});

// ---------------------------------------------------------------------------
// fetchMessages — stale-while-revalidate caching
// ---------------------------------------------------------------------------

describe("fetchMessages — stale-while-revalidate caching", () => {
  beforeEach(resetStore);

  it("loads cached messages from SQLite when no in-memory messages exist", async () => {
    const cachedMessages = [
      { info: makeUserMessage("cached-1", "sess-a"), parts: [] },
    ];
    const remoteMessages = [
      { info: makeUserMessage("cached-1", "sess-a"), parts: [] },
      { info: makeAssistantMessage("remote-2", "sess-a"), parts: [] },
    ];

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/sessions/cache/messages"))
        return Promise.resolve({
          ok: true,
          json: async () => ({ messages: cachedMessages, cachedAt: 1000 }),
        });
      if (url.includes("/api/opencode/"))
        return Promise.resolve({
          ok: true,
          json: async () => remoteMessages,
        });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    await useChatStore.getState().fetchMessages("sess-a", "ws-a");

    const ws = useChatStore.getState().workspaceStates["ws-a"];
    expect(ws.messages["sess-a"]).toHaveLength(2);
    expect(ws.messages["sess-a"][1].info.id).toBe("remote-2");
  });

  it("skips SQLite cache when in-memory messages already exist", async () => {
    const inMemoryMessages = [
      { info: makeUserMessage("mem-1", "sess-a"), parts: [] },
    ];
    const remoteMessages = [
      { info: makeUserMessage("mem-1", "sess-a"), parts: [] },
      { info: makeAssistantMessage("remote-2", "sess-a"), parts: [] },
    ];

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/opencode/"))
        return Promise.resolve({
          ok: true,
          json: async () => remoteMessages,
        });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: { "sess-a": inMemoryMessages },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    await useChatStore.getState().fetchMessages("sess-a", "ws-a");

    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const cacheReadCalls = fetchCalls.filter(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        args[0].includes("/api/sessions/cache/messages?"),
    );
    expect(cacheReadCalls).toHaveLength(0);

    const ws = useChatStore.getState().workspaceStates["ws-a"];
    expect(ws.messages["sess-a"]).toHaveLength(2);
  });

  it("persists messages to SQLite cache after successful remote fetch", async () => {
    const remoteMessages = [
      { info: makeUserMessage("msg-1", "sess-a"), parts: [] },
    ];

    let savedPayload: unknown = null;
    global.fetch = vi
      .fn()
      .mockImplementation((url: string, opts?: RequestInit) => {
        if (url.includes("/api/sessions/cache/messages")) {
          if (opts?.method === "POST") {
            savedPayload = JSON.parse(opts.body as string);
            return Promise.resolve({
              ok: true,
              json: async () => ({ ok: true }),
            });
          }
          return Promise.resolve({ ok: true, json: async () => null });
        }
        if (url.includes("/api/opencode/"))
          return Promise.resolve({
            ok: true,
            json: async () => remoteMessages,
          });
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      });

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    await useChatStore.getState().fetchMessages("sess-a", "ws-a");

    await vi.waitFor(() => expect(savedPayload).not.toBeNull());
    const payload = savedPayload as {
      sessionId: string;
      workspaceId: string;
      messages: unknown[];
    };
    expect(payload.sessionId).toBe("sess-a");
    expect(payload.workspaceId).toBe("ws-a");
    expect(payload.messages).toHaveLength(1);
  });

  it("gracefully handles SQLite cache failure and still loads from remote", async () => {
    const remoteMessages = [
      { info: makeAssistantMessage("remote-1", "sess-a"), parts: [] },
    ];

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/sessions/cache/messages"))
        return Promise.reject(new Error("Cache unavailable"));
      if (url.includes("/api/opencode/"))
        return Promise.resolve({
          ok: true,
          json: async () => remoteMessages,
        });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });

    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });

    await useChatStore.getState().fetchMessages("sess-a", "ws-a");

    const ws = useChatStore.getState().workspaceStates["ws-a"];
    expect(ws.messages["sess-a"]).toHaveLength(1);
    expect(ws.messages["sess-a"][0].info.id).toBe("remote-1");
  });
});

// ---------------------------------------------------------------------------
// 16. isMessagesLoaded selector logic
// ---------------------------------------------------------------------------

describe("isMessagesLoaded selector logic", () => {
  // Tests the inline selector used in chat-interface.tsx:
  //   const isMessagesLoaded = useChatStore((state) => {
  //     const { activeSessionId: sid, activeWorkspaceId: wid, workspaceStates } = state
  //     if (!sid || !wid) return true
  //     const ws = workspaceStates[wid]
  //     if (!ws) return false
  //     return sid in ws.messages
  //   })

  function isMessagesLoaded(state: {
    activeSessionId: string | null;
    activeWorkspaceId: string | null;
    workspaceStates: Record<string, { messages: Record<string, unknown[]> }>;
  }): boolean {
    const {
      activeSessionId: sid,
      activeWorkspaceId: wid,
      workspaceStates,
    } = state;
    if (!sid || !wid) return true;
    const ws = workspaceStates[wid];
    if (!ws) return false;
    return sid in ws.messages;
  }

  beforeEach(resetStore);

  it("returns true when no active session (guard clause)", () => {
    useChatStore.setState({ activeSessionId: null, activeWorkspaceId: "ws-a" });
    expect(isMessagesLoaded(useChatStore.getState())).toBe(true);
  });

  it("returns true when no active workspace (guard clause)", () => {
    useChatStore.setState({
      activeSessionId: "sess-a",
      activeWorkspaceId: null,
    });
    expect(isMessagesLoaded(useChatStore.getState())).toBe(true);
  });

  it("returns false when workspace has no messages key for the active session", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });
    expect(isMessagesLoaded(useChatStore.getState())).toBe(false);
  });

  it("returns true when messages[sessionId] is an empty array (loaded but empty)", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: { "sess-a": [] },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });
    expect(isMessagesLoaded(useChatStore.getState())).toBe(true);
  });

  it("returns true when messages[sessionId] has data", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {
            "sess-a": [
              { info: makeAssistantMessage("msg-1", "sess-a"), parts: [] },
            ],
          },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
        },
      },
    });
    expect(isMessagesLoaded(useChatStore.getState())).toBe(true);
  });

  it("returns false when workspace state does not exist at all", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-missing",
      activeSessionId: "sess-a",
      workspaceStates: {},
    });
    expect(isMessagesLoaded(useChatStore.getState())).toBe(false);
  });

  it("integration: createSession makes isMessagesLoaded true immediately", async () => {
    const newSession = makeSession("sess-new");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => newSession,
    });

    useChatStore.setState({ activeWorkspaceId: "ws-a" });
    await useChatStore.getState().createSession("ws-a");

    const state = useChatStore.getState();
    expect(isMessagesLoaded(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeSessionLocal / restoreSessionLocal (soft-delete with undo)
// ---------------------------------------------------------------------------

describe("removeSessionLocal and restoreSessionLocal", () => {
  beforeEach(resetStore);

  const fullWorkspaceState = () => ({
    sessions: {
      "sess-a": makeSession("sess-a", { updated: 2000 }),
      "sess-b": makeSession("sess-b", { updated: 1000 }),
    },
    messages: {
      "sess-a": [{ info: makeUserMessage("msg-1", "sess-a"), parts: [] }],
      "sess-b": [],
    },
    optimisticMessageIds: {} as Record<string, string>,
    sessionStatuses: { "sess-a": { type: "busy" as const } },
    permissions: [] as ReturnType<typeof makePermission>[],
    questions: [] as ReturnType<typeof makeQuestion>[],
    todos: {} as Record<string, never[]>,
    sessionAgents: { "sess-a": "code" },
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: { "sess-a": 1500, "sess-b": 900 },
    pinnedSessionIds: new Set<string>(),
    sessionsLoaded: true,
  });

  it("removes session from local state and returns a snapshot", () => {
    useChatStore.setState({
      workspaceStates: { "ws-a": fullWorkspaceState() },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    const snapshot = useChatStore
      .getState()
      .removeSessionLocal("sess-a", "ws-a");

    expect(snapshot).not.toBeNull();
    expect(snapshot!.sessionId).toBe("sess-a");
    expect(snapshot!.wasActive).toBe(true);
    expect(snapshot!.session.id).toBe("sess-a");
    expect(snapshot!.messages).toHaveLength(1);
    expect(snapshot!.sessionAgent).toBe("code");
    expect(snapshot!.lastViewedAt).toBe(1500);

    const ws = useChatStore.getState().workspaceStates["ws-a"];
    expect(ws.sessions["sess-a"]).toBeUndefined();
    expect(ws.sessions["sess-b"]).toBeDefined();
    expect(ws.messages["sess-a"]).toBeUndefined();
    expect(ws.sessionAgents["sess-a"]).toBeUndefined();
    expect(useChatStore.getState().activeSessionId).toBe("sess-b");
  });

  it("auto-selects null when no remaining sessions exist", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          ...fullWorkspaceState(),
          sessions: { "sess-a": makeSession("sess-a", { updated: 2000 }) },
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    useChatStore.getState().removeSessionLocal("sess-a", "ws-a");
    expect(useChatStore.getState().activeSessionId).toBeNull();
  });

  it("returns null when session does not exist", () => {
    useChatStore.setState({
      workspaceStates: { "ws-a": fullWorkspaceState() },
    });

    const snapshot = useChatStore
      .getState()
      .removeSessionLocal("sess-nonexistent", "ws-a");
    expect(snapshot).toBeNull();
  });

  it("returns null when workspace does not exist", () => {
    const snapshot = useChatStore
      .getState()
      .removeSessionLocal("sess-a", "ws-missing");
    expect(snapshot).toBeNull();
  });

  it("does not clear activeSessionId when removing a non-active session", () => {
    useChatStore.setState({
      workspaceStates: { "ws-a": fullWorkspaceState() },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    useChatStore.getState().removeSessionLocal("sess-b", "ws-a");

    expect(useChatStore.getState().activeSessionId).toBe("sess-a");
  });

  it("restoreSessionLocal fully restores a removed session", () => {
    useChatStore.setState({
      workspaceStates: { "ws-a": fullWorkspaceState() },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    const snapshot = useChatStore
      .getState()
      .removeSessionLocal("sess-a", "ws-a")!;
    useChatStore.getState().restoreSessionLocal(snapshot);

    const ws = useChatStore.getState().workspaceStates["ws-a"];
    expect(ws.sessions["sess-a"]).toBeDefined();
    expect(ws.sessions["sess-a"].id).toBe("sess-a");
    expect(ws.messages["sess-a"]).toHaveLength(1);
    expect(ws.sessionAgents["sess-a"]).toBe("code");
    expect(ws.lastViewedAt["sess-a"]).toBe(1500);
    expect(useChatStore.getState().activeSessionId).toBe("sess-a");
  });

  it("restoreSessionLocal does not override activeSessionId if the snapshot was not active", () => {
    useChatStore.setState({
      workspaceStates: { "ws-a": fullWorkspaceState() },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    const snapshot = useChatStore
      .getState()
      .removeSessionLocal("sess-b", "ws-a")!;
    expect(snapshot.wasActive).toBe(false);

    useChatStore.getState().restoreSessionLocal(snapshot);

    expect(useChatStore.getState().activeSessionId).toBe("sess-a");
    expect(
      useChatStore.getState().workspaceStates["ws-a"].sessions["sess-b"],
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// revertSession — optimistic removal + text extraction
// ---------------------------------------------------------------------------

describe("revertSession", () => {
  beforeEach(resetStore);

  function seedMessages() {
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          optimisticMessageIds: {} as Record<string, string>,
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionsLoaded: true,
          messages: {
            "sess-a": [
              {
                info: makeUserMessage("msg-1", "sess-a"),
                parts: [
                  {
                    id: "p1",
                    sessionID: "sess-a",
                    messageID: "msg-1",
                    type: "text" as const,
                    text: "first question",
                  },
                ],
              },
              {
                info: makeAssistantMessage("msg-2", "sess-a"),
                parts: [
                  {
                    id: "p2",
                    sessionID: "sess-a",
                    messageID: "msg-2",
                    type: "text" as const,
                    text: "first answer",
                  },
                ],
              },
              {
                info: makeUserMessage("msg-3", "sess-a"),
                parts: [
                  {
                    id: "p3",
                    sessionID: "sess-a",
                    messageID: "msg-3",
                    type: "text" as const,
                    text: "second question",
                  },
                ],
              },
              {
                info: makeAssistantMessage("msg-4", "sess-a"),
                parts: [
                  {
                    id: "p4",
                    sessionID: "sess-a",
                    messageID: "msg-4",
                    type: "text" as const,
                    text: "second answer",
                  },
                ],
              },
            ],
          },
        },
      },
    });
  }

  it("optimistically removes the target message and all subsequent messages", async () => {
    seedMessages();
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });

    await useChatStore.getState().revertSession("sess-a", "ws-a", "msg-3");

    const msgs =
      useChatStore.getState().workspaceStates["ws-a"].messages["sess-a"];
    expect(msgs).toHaveLength(2);
    expect(msgs[0].info.id).toBe("msg-1");
    expect(msgs[1].info.id).toBe("msg-2");
  });

  it("returns the text content of the reverted message", async () => {
    seedMessages();
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });

    const text = await useChatStore
      .getState()
      .revertSession("sess-a", "ws-a", "msg-3");

    expect(text).toBe("second question");
  });

  it("restores messages on fetch failure", async () => {
    seedMessages();
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    await useChatStore.getState().revertSession("sess-a", "ws-a", "msg-3");

    const msgs =
      useChatStore.getState().workspaceStates["ws-a"].messages["sess-a"];
    expect(msgs).toHaveLength(4);
  });

  it("returns null when message ID is not found", async () => {
    seedMessages();
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });

    const text = await useChatStore
      .getState()
      .revertSession("sess-a", "ws-a", "nonexistent");

    expect(text).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pinned sessions
// ---------------------------------------------------------------------------

describe("pinned sessions", () => {
  beforeEach(resetStore);

  it("fetchPinnedSessions populates pinnedSessionIds for a workspace", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ["sess-1", "sess-2"],
    });

    await useChatStore.getState().fetchPinnedSessions("ws-a");

    const pinned =
      useChatStore.getState().workspaceStates["ws-a"].pinnedSessionIds;
    expect(pinned.has("sess-1")).toBe(true);
    expect(pinned.has("sess-2")).toBe(true);
    expect(pinned.size).toBe(2);
  });

  it("pinSession optimistically adds to pinnedSessionIds", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pinned: true }),
    });

    await useChatStore.getState().pinSession("sess-1", "ws-a");

    const pinned =
      useChatStore.getState().workspaceStates["ws-a"].pinnedSessionIds;
    expect(pinned.has("sess-1")).toBe(true);
  });

  it("unpinSession optimistically removes from pinnedSessionIds", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unpinned: true }),
    });

    await useChatStore.getState().pinSession("sess-1", "ws-a");
    expect(
      useChatStore
        .getState()
        .workspaceStates["ws-a"].pinnedSessionIds.has("sess-1"),
    ).toBe(true);

    await useChatStore.getState().unpinSession("sess-1", "ws-a");
    expect(
      useChatStore
        .getState()
        .workspaceStates["ws-a"].pinnedSessionIds.has("sess-1"),
    ).toBe(false);
  });

  it("pinSession rolls back on fetch failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    await useChatStore.getState().pinSession("sess-1", "ws-a");

    const pinned =
      useChatStore.getState().workspaceStates["ws-a"].pinnedSessionIds;
    expect(pinned.has("sess-1")).toBe(false);
  });

  it("unpinSession rolls back on fetch failure", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pinned: true }) })
      .mockRejectedValueOnce(new Error("network error"));

    await useChatStore.getState().pinSession("sess-1", "ws-a");
    expect(
      useChatStore
        .getState()
        .workspaceStates["ws-a"].pinnedSessionIds.has("sess-1"),
    ).toBe(true);

    await useChatStore.getState().unpinSession("sess-1", "ws-a");
    expect(
      useChatStore
        .getState()
        .workspaceStates["ws-a"].pinnedSessionIds.has("sess-1"),
    ).toBe(true);
  });

  it("isSessionPinned returns correct state", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pinned: true }),
    });

    expect(useChatStore.getState().isSessionPinned("sess-1", "ws-a")).toBe(
      false,
    );

    await useChatStore.getState().pinSession("sess-1", "ws-a");

    expect(useChatStore.getState().isSessionPinned("sess-1", "ws-a")).toBe(
      true,
    );
  });

  it("pinned sessions are scoped per workspace", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pinned: true }),
    });

    await useChatStore.getState().pinSession("sess-1", "ws-a");
    await useChatStore.getState().pinSession("sess-2", "ws-b");

    expect(useChatStore.getState().isSessionPinned("sess-1", "ws-a")).toBe(
      true,
    );
    expect(useChatStore.getState().isSessionPinned("sess-2", "ws-a")).toBe(
      false,
    );
    expect(useChatStore.getState().isSessionPinned("sess-2", "ws-b")).toBe(
      true,
    );
    expect(useChatStore.getState().isSessionPinned("sess-1", "ws-b")).toBe(
      false,
    );
  });

  it("getPinnedSessionIds returns empty set for unknown workspace", () => {
    expect(useChatStore.getState().getPinnedSessionIds("unknown").size).toBe(0);
  });

  it("getActivePinnedSessionIds reflects pinned state for active workspace", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pinned: true }),
    });

    useChatStore.setState({ activeWorkspaceId: "ws-a" });

    const before = useChatStore.getState().getActivePinnedSessionIds();
    expect(before.size).toBe(0);

    await useChatStore.getState().pinSession("sess-1", "ws-a");

    const after = useChatStore.getState().getActivePinnedSessionIds();
    expect(after.has("sess-1")).toBe(true);
    expect(after).not.toBe(before);
  });

  it("getUnifiedPinnedSessionIds merges across workspaces", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pinned: true }),
    });

    await useChatStore.getState().pinSession("sess-1", "ws-a");
    await useChatStore.getState().pinSession("sess-2", "ws-b");

    const unified = useChatStore.getState().getUnifiedPinnedSessionIds();
    expect(unified.has("sess-1")).toBe(true);
    expect(unified.has("sess-2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 16. fetchSessions — fallback to cached sessions on failure
// ---------------------------------------------------------------------------

describe("fetchSessions fallback to cache", () => {
  beforeEach(resetStore);

  it("falls back to cached sessions when live fetch returns 502", async () => {
    const cachedSessions = [
      {
        id: "cached-1",
        title: "Cached Session 1",
        parentId: null,
        time: { created: 1000, updated: 2000 },
        fromCache: true,
      },
      {
        id: "cached-2",
        title: "Cached Session 2",
        parentId: null,
        time: { created: 1000, updated: 1500 },
        fromCache: true,
      },
    ];

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/api/opencode/session")) {
        return Promise.resolve({
          ok: false,
          status: 502,
          json: async () => ({ error: "OpenCode proxy error" }),
        });
      }
      if ((url as string).includes("/api/sessions/cache")) {
        return Promise.resolve({ ok: true, json: async () => cachedSessions });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    await useChatStore.getState().fetchSessions("ws-remote");

    const ws = useChatStore.getState().workspaceStates["ws-remote"];
    expect(ws.sessionsLoaded).toBe(true);
    expect(Object.keys(ws.sessions)).toHaveLength(2);
    expect(ws.sessions["cached-1"].title).toBe("Cached Session 1");
    expect(ws.sessions["cached-2"].title).toBe("Cached Session 2");
  });

  it("falls back to cached sessions on network error", async () => {
    const cachedSessions = [
      {
        id: "cached-1",
        title: "Cached",
        parentId: null,
        time: { created: 1000, updated: 2000 },
        fromCache: true,
      },
    ];

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/api/opencode/session")) {
        return Promise.reject(new Error("fetch failed"));
      }
      if ((url as string).includes("/api/sessions/cache")) {
        return Promise.resolve({ ok: true, json: async () => cachedSessions });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    await useChatStore.getState().fetchSessions("ws-remote");

    const ws = useChatStore.getState().workspaceStates["ws-remote"];
    expect(ws.sessionsLoaded).toBe(true);
    expect(Object.keys(ws.sessions)).toHaveLength(1);
    expect(ws.sessions["cached-1"].title).toBe("Cached");
  });

  it("sets sessionsLoaded even when both live and cache fetches fail", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/api/opencode/session")) {
        return Promise.resolve({
          ok: false,
          status: 502,
          json: async () => ({ error: "proxy error" }),
        });
      }
      if ((url as string).includes("/api/sessions/cache")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: "db error" }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    await useChatStore.getState().fetchSessions("ws-remote");

    const ws = useChatStore.getState().workspaceStates["ws-remote"];
    expect(ws.sessionsLoaded).toBe(true);
  });

  it("does not overwrite live sessions with cache on successful fetch", async () => {
    const liveSessions = [
      makeSession("live-1", { updated: 3000 }),
      makeSession("live-2", { updated: 2500 }),
    ];

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if ((url as string).includes("/api/opencode/session")) {
        return Promise.resolve({ ok: true, json: async () => liveSessions });
      }
      // Cache POST (fire-and-forget after success)
      if ((url as string).includes("/api/sessions/cache")) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    await useChatStore.getState().fetchSessions("ws-remote");

    const ws = useChatStore.getState().workspaceStates["ws-remote"];
    expect(ws.sessionsLoaded).toBe(true);
    expect(Object.keys(ws.sessions)).toHaveLength(2);
    expect(ws.sessions["live-1"]).toBeDefined();
    expect(ws.sessions["live-2"]).toBeDefined();
    // Cache should not have been read (GET with ?workspaceId=), only written (POST to /api/sessions/cache)
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const cacheReads = fetchCalls.filter(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        args[0].includes("/api/sessions/cache?workspaceId="),
    );
    expect(cacheReads).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sessionVariants CRUD
// ---------------------------------------------------------------------------

describe("sessionVariants", () => {
  beforeEach(resetStore);

  it("setSessionVariant stores the variant per session per workspace", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          sessionVariants: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionNotes: {},
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    useChatStore.getState().setSessionVariant("sess-a", "ws-a", "concise");

    expect(
      useChatStore.getState().workspaceStates["ws-a"].sessionVariants["sess-a"],
    ).toBe("concise");
  });

  it("getSessionVariant returns the stored variant", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          sessionVariants: { "sess-a": "verbose" },
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionNotes: {},
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    expect(useChatStore.getState().getSessionVariant("sess-a")).toBe("verbose");
  });

  it("getSessionVariant returns null when no variant is stored", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    expect(useChatStore.getState().getSessionVariant("sess-a")).toBeNull();
  });

  it("clearSessionVariant removes the variant for the session", () => {
    useChatStore.setState({
      workspaceStates: {
        "ws-a": {
          sessions: { "sess-a": makeSession("sess-a") },
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          sessionVariants: { "sess-a": "concise" },
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
          sessionNotes: {},
          sessionsLoaded: true,
        },
      },
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
    });

    useChatStore.getState().clearSessionVariant("sess-a", "ws-a");

    expect(
      useChatStore.getState().workspaceStates["ws-a"].sessionVariants["sess-a"],
    ).toBeUndefined();
    expect(useChatStore.getState().getSessionVariant("sess-a")).toBeNull();
  });
});
