import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Message,
  MessageWithParts,
  Part,
  Session,
} from "@/lib/opencode/types";
import {
  _debugPendingMessageUpdateSessionIds,
  _resetModuleCaches,
  useChatStore,
  type WorkspaceState,
} from "@/stores/chat-store";

vi.mock("sonner", () => ({ toast: vi.fn() }));

const WORKSPACE_ID = "ws-resync";
const SESSION_ID = "omo_resync-session";

function session(): Session {
  return {
    id: SESSION_ID,
    projectID: "project",
    directory: "/workspace",
    title: "Resync session",
    version: "omo",
    time: { created: 1, updated: 1 },
  };
}

function userInfo(id: string, created: number): Message {
  return {
    id,
    sessionID: SESSION_ID,
    role: "user",
    time: { created },
    agent: "omo",
    model: { providerID: "openai", modelID: "gpt-5.6-sol" },
  };
}

function assistantInfo(id: string): Message {
  return {
    id,
    sessionID: SESSION_ID,
    role: "assistant",
    time: { created: 2 },
    parentID: "omo_root",
    modelID: "gpt-5.6-sol",
    providerID: "openai",
    mode: "omo",
    path: { cwd: "/workspace", root: "/workspace" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

function textPart(id: string, messageID: string, text: string): Part {
  return { id, sessionID: SESSION_ID, messageID, type: "text", text };
}

function message(
  id: string,
  text: string,
  role: "user" | "assistant" = "assistant",
): MessageWithParts {
  const info = role === "user" ? userInfo(id, 5) : assistantInfo(id);
  return { info, parts: [textPart(`${id}_0`, id, text)] };
}

function workspace(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    sessions: { [SESSION_ID]: session() },
    sessionsLoaded: true,
    messages: { [SESSION_ID]: [] },
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function resetStore(): void {
  _resetModuleCaches();
  useChatStore.setState({
    workspaceStates: { [WORKSPACE_ID]: workspace() },
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: SESSION_ID,
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

describe("_refreshMessagesFromRemote replace mode (D22)", () => {
  it("replaces the window, keeps an unmatched optimistic message, and requests replace=1", async () => {
    const remoteWindow: MessageWithParts[] = [
      message("omo_remote-1", "remote one"),
      message("omo_remote-2", "remote two"),
    ];
    const optimistic = message("optimistic-c", "still pending", "user");
    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = input.toString();
        return jsonResponse({
          messages: remoteWindow,
          hasMore: false,
          total: remoteWindow.length,
          source: "remote",
          recoveredMessageIds: [],
        });
      }),
    );

    useChatStore.setState((state) => ({
      workspaceStates: {
        ...state.workspaceStates,
        [WORKSPACE_ID]: workspace({
          messages: {
            [SESSION_ID]: [
              message("omo_live_a", "streaming"),
              message("omo_stale_b", "stale"),
              optimistic,
            ],
          },
          optimisticMessageIds: { [SESSION_ID]: "optimistic-c" },
        }),
      },
    }));

    await useChatStore
      .getState()
      ._refreshMessagesFromRemote(SESSION_ID, WORKSPACE_ID, { replace: true });

    expect(capturedUrl).toContain("replace=1");
    const messages =
      useChatStore.getState().workspaceStates[WORKSPACE_ID].messages[
        SESSION_ID
      ];
    expect(messages.map((m) => m.info.id)).toEqual([
      "omo_remote-1",
      "omo_remote-2",
      "optimistic-c",
    ]);
    expect(messages.some((m) => m.info.id.startsWith("omo_live_"))).toBe(false);
  });

  it("drops the optimistic message when it is matched by the remote window", async () => {
    const matchingText = "already saved";
    const remoteUser: MessageWithParts = message(
      "omo_remote-user",
      matchingText,
      "user",
    );
    const optimistic = message("optimistic-c", matchingText, "user");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          messages: [remoteUser],
          hasMore: false,
          total: 1,
          source: "remote",
          recoveredMessageIds: [],
        }),
      ),
    );

    useChatStore.setState((state) => ({
      workspaceStates: {
        ...state.workspaceStates,
        [WORKSPACE_ID]: workspace({
          messages: { [SESSION_ID]: [optimistic] },
          optimisticMessageIds: { [SESSION_ID]: "optimistic-c" },
        }),
      },
    }));

    await useChatStore
      .getState()
      ._refreshMessagesFromRemote(SESSION_ID, WORKSPACE_ID, { replace: true });

    const ws = useChatStore.getState().workspaceStates[WORKSPACE_ID];
    expect(ws.messages[SESSION_ID].map((m) => m.info.id)).toEqual([
      "omo_remote-user",
    ]);
    expect(ws.optimisticMessageIds[SESSION_ID]).toBeUndefined();
  });

  it("clears pendingMessageUpdates and pendingPartUpdates for the session on replace", async () => {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queuedFrames.push(cb);
      return queuedFrames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const remoteMessage = message("omo_remote-2", "hi", "user");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          messages: [remoteMessage],
          hasMore: false,
          total: 1,
          source: "remote",
          recoveredMessageIds: [],
        }),
      ),
    );

    // Buffer a stale part update and a stale message update for the session
    // before the replace runs — both must be discarded, never flushed.
    useChatStore.getState().handleEvent(
      {
        type: "message.part.updated",
        properties: {
          part: textPart("extra-part", "omo_remote-2", "should not appear"),
        },
      },
      WORKSPACE_ID,
    );
    useChatStore.getState().handleEvent(
      {
        type: "message.updated",
        properties: { info: assistantInfo("omo_ghost") },
      },
      WORKSPACE_ID,
    );
    expect(_debugPendingMessageUpdateSessionIds()).toContain(SESSION_ID);

    await useChatStore
      .getState()
      ._refreshMessagesFromRemote(SESSION_ID, WORKSPACE_ID, { replace: true });

    expect(_debugPendingMessageUpdateSessionIds()).not.toContain(SESSION_ID);

    while (queuedFrames.length > 0) {
      const pending = queuedFrames.splice(0);
      for (const cb of pending) cb(performance.now());
    }

    const messages =
      useChatStore.getState().workspaceStates[WORKSPACE_ID].messages[
        SESSION_ID
      ];
    expect(messages.map((m) => m.info.id)).toEqual(["omo_remote-2"]);
    expect(messages[0]?.parts.some((p) => p.id === "extra-part")).toBe(false);
    expect(messages.some((m) => m.info.id === "omo_ghost")).toBe(false);
  });
});

describe("session.resync_required reducer (D22)", () => {
  it("ignores the event when the session's message bucket was never initialized", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    useChatStore.setState((state) => ({
      workspaceStates: {
        ...state.workspaceStates,
        [WORKSPACE_ID]: workspace({ messages: {} }),
      },
    }));

    useChatStore.getState().handleEvent(
      {
        type: "session.resync_required",
        properties: { sessionID: SESSION_ID },
      },
      WORKSPACE_ID,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("triggers a replace refresh when the session bucket exists", async () => {
    let capturedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = input.toString();
        return jsonResponse({
          messages: [],
          hasMore: false,
          total: 0,
          source: "remote",
          recoveredMessageIds: [],
        });
      }),
    );

    useChatStore.getState().handleEvent(
      {
        type: "session.resync_required",
        properties: { sessionID: SESSION_ID },
      },
      WORKSPACE_ID,
    );

    await vi.waitFor(() => {
      expect(capturedUrl).toContain("replace=1");
    });
  });

  it("mode precedence: a replace requested mid-flight re-runs after a normal refresh settles", async () => {
    const first = deferred<Response>();
    const urls: string[] = [];
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(input.toString());
        callCount += 1;
        if (callCount === 1) return first.promise;
        return jsonResponse({
          messages: [],
          hasMore: false,
          total: 0,
          source: "remote",
          recoveredMessageIds: [],
        });
      }),
    );

    const normalRefresh = useChatStore
      .getState()
      ._refreshMessagesFromRemote(SESSION_ID, WORKSPACE_ID);

    useChatStore.getState().handleEvent(
      {
        type: "session.resync_required",
        properties: { sessionID: SESSION_ID },
      },
      WORKSPACE_ID,
    );

    first.resolve(
      jsonResponse({
        messages: [],
        hasMore: false,
        total: 0,
        source: "remote",
        recoveredMessageIds: [],
      }),
    );
    await normalRefresh;

    await vi.waitFor(() => {
      expect(urls.filter((u) => u.includes("replace=1"))).toHaveLength(1);
    });
    expect(urls).toHaveLength(2);
  });
});
