import { describe, expect, it } from "vitest";
import {
  addVisibleSession,
  computeStreamingStatus,
  EMPTY_MESSAGES,
  EMPTY_TODOS,
  listOnScreenSessionIds,
  listVisibleSessionsToRefetch,
  planMessageCacheEviction,
  removeVisibleSession,
  selectSessionMessages,
  selectSessionStatus,
  selectSessionTodos,
  visibleSessionIdsInWorkspace,
  visibleSessionKey,
  type SessionScopedChatState,
} from "@/lib/chat/session-scoped-selectors";
import type {
  MessageWithParts,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  Todo,
} from "@/lib/opencode/types";
import type { WorkspaceState } from "@/stores/chat-store";

const WS = "ws-1";
const BUSY: SessionStatus = { type: "busy" };
const IDLE: SessionStatus = { type: "idle" };
const NOW = 50_000;

function session(id: string, parentID?: string): Session {
  return {
    id,
    parentID,
    projectID: "project",
    directory: "/workspace",
    title: id,
    version: "1",
    time: { created: 1_000, updated: 1_000 },
  };
}

function permission(id: string, sessionID: string): PermissionRequest {
  return {
    id,
    sessionID,
    permission: "bash",
    patterns: [],
    metadata: {},
    always: [],
  };
}

function question(id: string, sessionID: string): QuestionRequest {
  return {
    id,
    sessionID,
    questions: [{ question: "Continue?", header: "Confirm", options: [] }],
  };
}

function workspaceState(
  overrides: Partial<WorkspaceState> = {},
): WorkspaceState {
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

function chatState(
  overrides: Partial<SessionScopedChatState> = {},
): SessionScopedChatState {
  return {
    workspaceStates: {},
    optimisticStreamingSessionId: null,
    streamingError: null,
    activeWorkspaceId: null,
    activeSessionId: null,
    visibleSessionKeys: {},
    sseWorkspaceIds: [],
    ...overrides,
  };
}

describe("computeStreamingStatus", () => {
  it("reports streaming for two visible sessions that are both busy", () => {
    // Given
    const state = chatState({
      workspaceStates: {
        [WS]: workspaceState({
          sessions: {
            "sess-a": session("sess-a"),
            "sess-b": session("sess-b"),
          },
          sessionStatuses: { "sess-a": BUSY, "sess-b": BUSY },
        }),
      },
    });

    // When
    const statuses = [
      computeStreamingStatus(state, WS, "sess-a", {
        isActiveSession: true,
        now: NOW,
      }),
      computeStreamingStatus(state, WS, "sess-b", {
        isActiveSession: false,
        now: NOW,
      }),
    ];

    // Then
    expect(statuses).toEqual(["streaming", "streaming"]);
  });

  it("reports error for the active session while streamingError is set", () => {
    // Given
    const state = chatState({
      streamingError: "LLM quota exceeded",
      workspaceStates: {
        [WS]: workspaceState({ sessionStatuses: { "sess-a": BUSY } }),
      },
    });

    // When
    const status = computeStreamingStatus(state, WS, "sess-a", {
      isActiveSession: true,
      now: NOW,
    });

    // Then
    expect(status).toBe("error");
  });

  it.each([
    { label: "busy", sessionStatus: BUSY, expected: "streaming" },
    { label: "idle", sessionStatus: IDLE, expected: "idle" },
  ])(
    "ignores streamingError for a $label session that is not active",
    ({ sessionStatus, expected }) => {
      // Given
      const state = chatState({
        streamingError: "LLM quota exceeded",
        workspaceStates: {
          [WS]: workspaceState({
            sessionStatuses: { "sess-b": sessionStatus },
          }),
        },
      });

      // When
      const status = computeStreamingStatus(state, WS, "sess-b", {
        isActiveSession: false,
        now: NOW,
      });

      // Then
      expect(status).toBe(expected);
    },
  );

  it.each([
    {
      pending: "question",
      overrides: { questions: [question("q-1", "sess-a")] },
    },
    {
      pending: "permission",
      overrides: { permissions: [permission("p-1", "sess-a")] },
    },
  ])(
    "reports waiting while the session has a pending $pending",
    ({ overrides }) => {
      // Given
      const state = chatState({
        workspaceStates: {
          [WS]: workspaceState({
            sessionStatuses: { "sess-a": BUSY },
            ...overrides,
          }),
        },
      });

      // When
      const status = computeStreamingStatus(state, WS, "sess-a", {
        isActiveSession: false,
        now: NOW,
      });

      // Then
      expect(status).toBe("waiting");
    },
  );

  it("reports streaming for the session that sent a message before its first event", () => {
    // Given
    const state = chatState({
      optimisticStreamingSessionId: "sess-b",
      workspaceStates: { [WS]: workspaceState() },
    });

    // When
    const status = computeStreamingStatus(state, WS, "sess-b", {
      isActiveSession: false,
      now: NOW,
    });

    // Then
    expect(status).toBe("streaming");
  });

  it("reports idle for a session when a different session sent the message", () => {
    // Given
    const state = chatState({
      optimisticStreamingSessionId: "sess-other",
      workspaceStates: { [WS]: workspaceState() },
    });

    // When
    const status = computeStreamingStatus(state, WS, "sess-b", {
      isActiveSession: false,
      now: NOW,
    });

    // Then
    expect(status).toBe("idle");
  });

  it("reports streaming while a subagent of the session is busy", () => {
    // Given
    const state = chatState({
      workspaceStates: {
        [WS]: workspaceState({
          sessions: {
            "sess-a": session("sess-a"),
            child: session("child", "sess-a"),
          },
          sessionStatuses: { "sess-a": IDLE, child: BUSY },
        }),
      },
    });

    // When
    const status = computeStreamingStatus(state, WS, "sess-a", {
      isActiveSession: false,
      now: NOW,
    });

    // Then
    expect(status).toBe("streaming");
  });

  it("reports idle for a session of an unknown workspace", () => {
    // When
    const status = computeStreamingStatus(chatState(), "ws-missing", "sess-a", {
      isActiveSession: true,
      now: NOW,
    });

    // Then
    expect(status).toBe("idle");
  });
});

describe("session selectors", () => {
  const messages: MessageWithParts[] = [
    {
      info: {
        id: "msg-1",
        sessionID: "sess-a",
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: "provider", modelID: "model" },
      },
      parts: [],
    },
  ];
  const todos: Todo[] = [
    { id: "todo-1", content: "Ship it", status: "pending", priority: "high" },
  ];
  const state = chatState({
    workspaceStates: {
      [WS]: workspaceState({
        messages: { "sess-a": messages },
        todos: { "sess-a": todos },
        sessionStatuses: { "sess-a": BUSY },
      }),
    },
  });

  it("selectSessionMessages returns the stored message list", () => {
    expect(selectSessionMessages(WS, "sess-a")(state)).toBe(messages);
  });

  it("selectSessionTodos returns the stored todo list", () => {
    expect(selectSessionTodos(WS, "sess-a")(state)).toBe(todos);
  });

  it("selectSessionStatus returns the stored status", () => {
    expect(selectSessionStatus(WS, "sess-a")(state)).toBe(BUSY);
  });

  it.each([
    {
      missing: "an unknown workspace",
      workspaceId: "ws-missing",
      sessionId: "sess-a",
    },
    {
      missing: "an unknown session",
      workspaceId: WS,
      sessionId: "sess-missing",
    },
    { missing: "no session id", workspaceId: WS, sessionId: null },
    { missing: "no workspace id", workspaceId: null, sessionId: "sess-a" },
  ])(
    "falls back to stable empty values for $missing",
    ({ workspaceId, sessionId }) => {
      // When
      const selected = {
        messages: selectSessionMessages(workspaceId, sessionId)(state),
        todos: selectSessionTodos(workspaceId, sessionId)(state),
        status: selectSessionStatus(workspaceId, sessionId)(state),
      };

      // Then
      expect(selected.messages).toBe(EMPTY_MESSAGES);
      expect(selected.todos).toBe(EMPTY_TODOS);
      expect(selected.status).toBeNull();
    },
  );
});

describe("visible session registry", () => {
  it("keys a visible session by its workspace and session id", () => {
    expect(visibleSessionKey("ws-1", "sess-a")).toBe("ws-1:sess-a");
  });

  it("counts every registration of the same session", () => {
    // When
    const keys = addVisibleSession(
      addVisibleSession({}, WS, "sess-a"),
      WS,
      "sess-a",
    );

    // Then
    expect(keys).toEqual({ "ws-1:sess-a": 2 });
  });

  it("returns a new registry instead of changing the one it was given", () => {
    // Given
    const original = { "ws-1:sess-a": 1 };

    // When
    addVisibleSession(original, WS, "sess-a");
    removeVisibleSession(original, WS, "sess-a");

    // Then
    expect(original).toEqual({ "ws-1:sess-a": 1 });
  });

  it("keeps a session visible while another registration remains", () => {
    expect(removeVisibleSession({ "ws-1:sess-a": 2 }, WS, "sess-a")).toEqual({
      "ws-1:sess-a": 1,
    });
  });

  it("drops the key when the last registration is removed", () => {
    expect(
      removeVisibleSession(
        { "ws-1:sess-a": 1, "ws-1:sess-b": 1 },
        WS,
        "sess-a",
      ),
    ).toEqual({ "ws-1:sess-b": 1 });
  });

  it("ignores removing a session that was never registered", () => {
    expect(removeVisibleSession({ "ws-1:sess-b": 1 }, WS, "sess-a")).toEqual({
      "ws-1:sess-b": 1,
    });
  });

  it("lists the visible sessions of one workspace only", () => {
    // Given
    const keys = { "ws-1:sess-a": 1, "ws-10:sess-b": 1, "ws-2:sess-c": 2 };

    // Then
    expect(visibleSessionIdsInWorkspace(keys, "ws-1")).toEqual(["sess-a"]);
  });
});

describe("listOnScreenSessionIds", () => {
  it("lists the active session and the visible sessions of the workspace", () => {
    // Given
    const state = chatState({
      activeWorkspaceId: WS,
      activeSessionId: "sess-a",
      visibleSessionKeys: {
        "ws-1:sess-a": 1,
        "ws-1:sess-b": 1,
        "ws-2:sess-c": 1,
      },
    });

    // Then
    expect(listOnScreenSessionIds(state, WS)).toEqual(["sess-a", "sess-b"]);
  });

  it("leaves out the active session of another workspace", () => {
    // Given
    const state = chatState({
      activeWorkspaceId: "ws-2",
      activeSessionId: "sess-c",
      visibleSessionKeys: { "ws-1:sess-b": 1 },
    });

    // Then
    expect(listOnScreenSessionIds(state, WS)).toEqual(["sess-b"]);
  });
});

describe("listVisibleSessionsToRefetch", () => {
  it("lists visible sessions other than the active one in workspaces on the event stream", () => {
    // Given
    const state = chatState({
      activeWorkspaceId: WS,
      activeSessionId: "sess-a",
      sseWorkspaceIds: [WS, "ws-2"],
      visibleSessionKeys: {
        "ws-1:sess-a": 1,
        "ws-1:sess-b": 1,
        "ws-2:sess-c": 1,
        "ws-3:sess-d": 1,
      },
    });

    // Then
    expect(listVisibleSessionsToRefetch(state)).toEqual([
      { workspaceId: WS, sessionId: "sess-b" },
      { workspaceId: "ws-2", sessionId: "sess-c" },
    ]);
  });
});

describe("planMessageCacheEviction", () => {
  function entries(...sessionIds: string[]) {
    return sessionIds.map((sessionId) => ({ workspaceId: WS, sessionId }));
  }

  it("evicts the oldest entries beyond the limit when no session is visible", () => {
    // When
    const plan = planMessageCacheEviction(
      entries("s0", "s1", "s2", "s3"),
      {},
      2,
    );

    // Then
    expect(plan).toEqual({
      kept: entries("s0", "s1"),
      evicted: entries("s2", "s3"),
    });
  });

  it("keeps a visible entry beyond the limit and evicts the oldest hidden entry instead", () => {
    // When
    const plan = planMessageCacheEviction(
      entries("s0", "s1", "s2", "visible"),
      { "ws-1:visible": 1 },
      3,
    );

    // Then
    expect(plan).toEqual({
      kept: entries("s0", "s1", "visible"),
      evicted: entries("s2"),
    });
  });

  it("lets visible entries push the list above the limit when no hidden entry can go", () => {
    // When
    const plan = planMessageCacheEviction(
      entries("s0", "v1", "v2"),
      { "ws-1:v1": 1, "ws-1:v2": 1 },
      2,
    );

    // Then
    expect(plan).toEqual({ kept: entries("s0", "v1", "v2"), evicted: [] });
  });

  it("never evicts the newest entry, even when it is the only hidden one", () => {
    // When
    const plan = planMessageCacheEviction(
      entries("s0", "v1"),
      { "ws-1:v1": 1 },
      1,
    );

    // Then
    expect(plan.evicted).toEqual([]);
  });

  it("only protects an entry whose own workspace has it visible", () => {
    // When
    const plan = planMessageCacheEviction(
      entries("s0", "s1", "s2"),
      { "ws-2:s2": 1 },
      2,
    );

    // Then
    expect(plan.evicted).toEqual(entries("s2"));
  });
});
