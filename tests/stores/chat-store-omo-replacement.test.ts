import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message, QuestionRequest, Session } from "@/lib/opencode/types";
import {
  _debugPendingMessageUpdateSessionIds,
  _resetModuleCaches,
  useChatStore,
  type WorkspaceState,
} from "@/stores/chat-store";

vi.mock("sonner", () => ({ toast: vi.fn() }));

const WORKSPACE_ID = "ws-replace";
const OLD_ID = "omo_old";
const NEW_ID = "omo_new";
const OTHER_ROOT_ID = "omo_other-root";

function session(id: string, updated = 1): Session {
  return {
    id,
    projectID: "project",
    directory: "/workspace",
    title: id,
    version: "omo",
    time: { created: 1, updated },
  };
}

function assistantInfo(id: string, sessionID: string): Message {
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 1 },
    parentID: "omo_root",
    modelID: "gpt-5.6-sol",
    providerID: "openai",
    mode: "omo",
    path: { cwd: "/workspace", root: "/workspace" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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

function resetStore(): void {
  _resetModuleCaches();
  useChatStore.setState({
    workspaceStates: {},
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: OLD_ID,
    queuedMessages: new Map(),
    queuedWorkspaceIds: new Set(),
    sessionMutationGen: {},
    hasMoreBeforeBySession: {},
    isLoadingOlderBySession: {},
    messageLoadErrorBySession: {},
    recoveredMessageIdsBySession: {},
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  _resetModuleCaches();
  vi.unstubAllGlobals();
});

describe("session.deleted extended cleanup (D23)", () => {
  it("tears down every D23-scoped bucket for the deleted session and keeps the other root active", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true })),
    );
    // A manual RAF queue (never flushed in this test) keeps the message.updated
    // buffered in pendingMessageUpdates so the cleanup's clearing is observable
    // — the default jsdom shim in tests/setup.ts runs RAF synchronously.
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    useChatStore.setState({
      workspaceStates: {
        [WORKSPACE_ID]: workspace({
          sessions: {
            [OLD_ID]: session(OLD_ID),
            [OTHER_ROOT_ID]: session(OTHER_ROOT_ID, 2),
          },
          messages: { [OLD_ID]: [], [OTHER_ROOT_ID]: [] },
          questions: [question("dh_q_old", OLD_ID)],
          todoUpdatedAt: { [OLD_ID]: 999 },
        }),
      },
      activeSessionId: OLD_ID,
      queuedMessages: new Map([
        [
          WORKSPACE_ID,
          [
            {
              sessionId: OLD_ID,
              text: "unsent",
              workspaceId: WORKSPACE_ID,
              optimisticMessageId: "optimistic-1",
            },
          ],
        ],
      ]),
      queuedWorkspaceIds: new Set([WORKSPACE_ID]),
    });

    // Populate the pendingMessageUpdates RAF buffer for the old session so the
    // extended cleanup's clearing is observable.
    useChatStore.getState().handleEvent(
      {
        type: "message.updated",
        properties: { info: assistantInfo("msg-1", OLD_ID) },
      },
      WORKSPACE_ID,
    );
    expect(_debugPendingMessageUpdateSessionIds()).toContain(OLD_ID);

    useChatStore
      .getState()
      .handleEvent(
        { type: "session.created", properties: { info: session(NEW_ID) } },
        WORKSPACE_ID,
      );
    useChatStore
      .getState()
      .handleEvent(
        { type: "session.deleted", properties: { info: session(OLD_ID) } },
        WORKSPACE_ID,
      );

    const state = useChatStore.getState();
    const ws = state.workspaceStates[WORKSPACE_ID];
    expect(ws.sessions[OLD_ID]).toBeUndefined();
    expect(ws.messages[OLD_ID]).toBeUndefined();
    expect(ws.questions.some((q) => q.sessionID === OLD_ID)).toBe(false);
    expect(state.queuedMessages.get(WORKSPACE_ID)).toBeUndefined();
    expect(ws.todoUpdatedAt?.[OLD_ID]).toBeUndefined();
    expect(_debugPendingMessageUpdateSessionIds()).not.toContain(OLD_ID);
    expect(state.activeSessionId).toBe(OTHER_ROOT_ID);
    expect(ws.sessions[NEW_ID]).toEqual(session(NEW_ID));
  });

  it("bumps sessionMutationGen on local createSession, deleteSession, and the reducers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(session("omo_created"))),
    );
    useChatStore.setState({
      workspaceStates: { [WORKSPACE_ID]: workspace() },
    });

    expect(useChatStore.getState().sessionMutationGen[WORKSPACE_ID] ?? 0).toBe(
      0,
    );
    await useChatStore.getState().createSession(WORKSPACE_ID);
    expect(useChatStore.getState().sessionMutationGen[WORKSPACE_ID]).toBe(1);

    useChatStore
      .getState()
      .handleEvent(
        { type: "session.created", properties: { info: session(OLD_ID) } },
        WORKSPACE_ID,
      );
    expect(useChatStore.getState().sessionMutationGen[WORKSPACE_ID]).toBe(2);

    useChatStore
      .getState()
      .handleEvent(
        { type: "session.deleted", properties: { info: session(OLD_ID) } },
        WORKSPACE_ID,
      );
    expect(useChatStore.getState().sessionMutationGen[WORKSPACE_ID]).toBe(3);
  });
});

describe("flushQueuedMessages guard (D23)", () => {
  it("discards a snapshotted entry whose session was confirmed-deleted mid-flush", async () => {
    const fetchCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        fetchCalls.push(url);
        if (url.includes("/api/sessions/messages")) {
          return jsonResponse({
            messages: [],
            hasMore: false,
            total: 0,
            source: "remote",
            recoveredMessageIds: [],
          });
        }
        return jsonResponse({ ok: true });
      }),
    );

    useChatStore.setState({
      workspaceStates: {
        [WORKSPACE_ID]: workspace({
          sessions: { [OLD_ID]: session(OLD_ID) },
          messages: { [OLD_ID]: [] },
        }),
      },
      queuedMessages: new Map([
        [
          WORKSPACE_ID,
          [
            {
              sessionId: OLD_ID,
              text: "queued before delete",
              workspaceId: WORKSPACE_ID,
              optimisticMessageId: "optimistic-old",
            },
          ],
        ],
      ]),
      queuedWorkspaceIds: new Set([WORKSPACE_ID]),
    });

    const sendMessageSpy = vi
      .spyOn(useChatStore.getState(), "sendMessage")
      .mockResolvedValue();

    // Start the flush without awaiting — its synchronous prefix (snapshotting
    // `queued`, clearing state.queuedMessages) runs before this call returns
    // control, but the loop over the snapshot only resumes after the awaited
    // fetchMessages() call below settles.
    const flushPromise = useChatStore
      .getState()
      .flushQueuedMessages(WORKSPACE_ID);

    // The delayed-response race: the session is confirmed-deleted after the
    // snapshot was taken but before the queued entry is replayed.
    useChatStore
      .getState()
      .handleEvent(
        { type: "session.deleted", properties: { info: session(OLD_ID) } },
        WORKSPACE_ID,
      );

    await flushPromise;

    expect(sendMessageSpy).not.toHaveBeenCalled();
  });
});

describe("session.metadata_moved coalescing (D23)", () => {
  it("calls fetchPinnedSessions and fetchSessionNotes exactly once for three events within 500ms", () => {
    vi.useFakeTimers();
    useChatStore.setState({
      workspaceStates: { [WORKSPACE_ID]: workspace() },
    });
    const pinnedSpy = vi
      .spyOn(useChatStore.getState(), "fetchPinnedSessions")
      .mockResolvedValue();
    const notesSpy = vi
      .spyOn(useChatStore.getState(), "fetchSessionNotes")
      .mockResolvedValue();

    for (let i = 0; i < 3; i += 1) {
      useChatStore.getState().handleEvent(
        {
          type: "session.metadata_moved",
          properties: { sessionID: NEW_ID, fromSessionID: OLD_ID },
        },
        WORKSPACE_ID,
      );
    }

    vi.advanceTimersByTime(500);

    expect(pinnedSpy).toHaveBeenCalledTimes(1);
    expect(notesSpy).toHaveBeenCalledTimes(1);
    expect(pinnedSpy).toHaveBeenCalledWith(WORKSPACE_ID);
    vi.useRealTimers();
  });
});
