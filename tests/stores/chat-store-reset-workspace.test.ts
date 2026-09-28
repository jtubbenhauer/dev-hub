import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Message,
  MessageWithParts,
  Part,
  Session,
} from "@/lib/opencode/types";
import {
  _resetModuleCaches,
  useChatStore,
  type WorkspaceState,
} from "@/stores/chat-store";

vi.mock("sonner", () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

interface MockEventSourceInstance {
  readonly url: string;
  readyState: number;
  close(): void;
  simulateOpen(): void;
  simulateMessage(data: string): void;
  simulateError(): void;
}

type MockEventSourceConstructor = new (url: string) => MockEventSourceInstance;

const createdSources: MockEventSourceInstance[] = [];
const originalEventSource = globalThis.EventSource;
const BaseEventSource =
  originalEventSource as unknown as MockEventSourceConstructor;

class RecordingEventSource extends BaseEventSource {
  constructor(url: string) {
    super(url);
    createdSources.push(this);
  }
}

let animationFrames: FrameRequestCallback[] = [];

function flushAnimationFrames(): void {
  while (animationFrames.length > 0) {
    const pending = animationFrames;
    animationFrames = [];
    for (const callback of pending) callback(performance.now());
  }
}

function currentSource(): MockEventSourceInstance {
  const source = useChatStore.getState().globalEventSource;
  if (!source) throw new Error("Expected an open global EventSource");
  return source as unknown as MockEventSourceInstance;
}

function session(id: string): Session {
  return {
    id,
    projectID: "project",
    directory: "/workspace",
    title: id,
    version: "1",
    time: { created: 1, updated: 1 },
  };
}

function assistantInfo(id: string, sessionID: string): Message {
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 1 },
    parentID: "user-message",
    modelID: "model",
    providerID: "provider",
    mode: "build",
    path: { cwd: "/workspace", root: "/workspace" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  };
}

function textPart(
  id: string,
  sessionID: string,
  messageID: string,
  text: string,
): Part {
  return { id, sessionID, messageID, type: "text", text };
}

function workspaceWith(
  sessionId: string,
  messages: MessageWithParts[],
): WorkspaceState {
  return {
    sessions: { [sessionId]: session(sessionId) },
    sessionsLoaded: true,
    messages: { [sessionId]: messages },
    optimisticMessageIds: {},
    sessionStatuses: { [sessionId]: { type: "busy" } },
    permissions: [],
    questions: [],
    todos: {},
    todoUpdatedAt: {},
    sessionAgents: { [sessionId]: "build" },
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: { [sessionId]: 1 },
    pinnedSessionIds: new Set(),
    sessionNotes: {},
  };
}

function deliver(
  source: MockEventSourceInstance,
  workspaceId: string,
  type: string,
  properties: Record<string, unknown>,
): void {
  source.simulateMessage(
    JSON.stringify({ workspaceId, event: { type, properties } }),
  );
}

function textOf(message: MessageWithParts | undefined): string | undefined {
  const part = message?.parts[0];
  return part?.type === "text" ? part.text : undefined;
}

const fetchMock = vi.fn(
  async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
);

beforeEach(() => {
  createdSources.length = 0;
  animationFrames = [];
  globalThis.EventSource =
    RecordingEventSource as unknown as typeof EventSource;
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  fetchMock.mockClear();

  useChatStore.getState().disconnectGlobalSSE();
  useChatStore.getState().clearStreamingPoll();
  _resetModuleCaches();
  useChatStore.setState({
    workspaceStates: {},
    messageAccessOrder: [],
    queuedMessages: new Map(),
    queuedWorkspaceIds: new Set(),
    activeWorkspaceId: null,
    activeSessionId: null,
    streamingError: null,
    optimisticStreamingSessionId: null,
    hasMoreBeforeBySession: {},
    isLoadingOlderBySession: {},
    messageLoadErrorBySession: {},
    recoveredMessageIdsBySession: {},
    sseReconnectAttempts: 0,
    engineRev: 0,
    sseGeneration: 0,
  });
});

afterEach(() => {
  flushAnimationFrames();
  useChatStore.getState().disconnectGlobalSSE();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.EventSource = originalEventSource;
});

describe("resetWorkspace SSE isolation", () => {
  it("closes the open source synchronously and reconnects with the new engineRev", () => {
    useChatStore.getState().connectGlobalSSE(["ws-a", "ws-b"]);
    const oldSource = currentSource();
    oldSource.simulateOpen();
    expect(oldSource.url).toContain("engineRev=0");

    useChatStore.getState().resetWorkspace("ws-b");

    const newSource = currentSource();
    expect(oldSource.readyState).toBe(EventSource.CLOSED);
    expect(newSource).not.toBe(oldSource);
    expect(newSource.url).toContain("workspaceIds=ws-a,ws-b");
    expect(newSource.url).toContain("engineRev=1");
    expect(useChatStore.getState().engineRev).toBe(1);
    expect(createdSources).toHaveLength(2);
  });

  it("drops events delivered to the old source after the reset", () => {
    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const oldSource = currentSource();
    oldSource.simulateOpen();

    useChatStore.getState().resetWorkspace("ws-a");
    deliver(oldSource, "ws-a", "session.created", {
      info: session("stale-session"),
    });

    expect(useChatStore.getState().workspaceStates["ws-a"]?.sessions).toEqual(
      {},
    );

    deliver(currentSource(), "ws-a", "session.created", {
      info: session("fresh-session"),
    });
    expect(
      Object.keys(useChatStore.getState().workspaceStates["ws-a"].sessions),
    ).toEqual(["fresh-session"]);
  });

  it("ignores a stale onopen so no reconciliation fetches run", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "sess-a",
      workspaceStates: { "ws-a": workspaceWith("sess-a", []) },
    });
    const fetchMessagesSpy = vi
      .spyOn(useChatStore.getState(), "fetchMessages")
      .mockResolvedValue();
    useChatStore.getState().connectGlobalSSE(["ws-a", "ws-b"]);
    const oldSource = currentSource();

    useChatStore.getState().resetWorkspace("ws-b");
    fetchMock.mockClear();
    oldSource.simulateOpen();

    expect(fetchMessagesSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    currentSource().simulateOpen();
    expect(fetchMessagesSpy).toHaveBeenCalledWith("sess-a", "ws-a", {
      force: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/opencode/permission?workspaceId=ws-a"),
      expect.anything(),
    );
  });

  it("ignores a stale onerror so the new source stays current with no reconnect timer", () => {
    vi.useFakeTimers();
    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const oldSource = currentSource();
    oldSource.simulateOpen();

    useChatStore.getState().resetWorkspace("ws-a");
    const newSource = currentSource();
    oldSource.simulateError();

    expect(useChatStore.getState().globalEventSource).toBe(newSource);
    expect(useChatStore.getState().sseReconnectTimer).toBeNull();
    expect(useChatStore.getState().sseReconnectAttempts).toBe(0);

    vi.advanceTimersByTime(60_000);
    expect(createdSources).toHaveLength(2);
    expect(useChatStore.getState().globalEventSource).toBe(newSource);
  });

  it("still reconnects after backoff when the current source errors", () => {
    vi.useFakeTimers();
    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const source = currentSource();
    source.simulateOpen();

    source.simulateError();

    expect(useChatStore.getState().globalEventSource).toBeNull();
    expect(useChatStore.getState().sseReconnectAttempts).toBe(1);
    expect(useChatStore.getState().sseReconnectTimer).not.toBeNull();

    vi.advanceTimersByTime(999);
    expect(createdSources).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(createdSources).toHaveLength(2);
    const reconnected = currentSource();
    expect(reconnected).not.toBe(source);
    expect(reconnected.url).toContain("workspaceIds=ws-a");
    expect(useChatStore.getState().sseReconnectTimer).toBeNull();
  });

  it("never fires a reconnect timer that a later connect superseded", () => {
    vi.useFakeTimers();
    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    currentSource().simulateError();
    expect(useChatStore.getState().sseReconnectTimer).not.toBeNull();

    useChatStore.getState().connectGlobalSSE([]);
    vi.advanceTimersByTime(60_000);

    expect(createdSources).toHaveLength(1);
    expect(useChatStore.getState().globalEventSource).toBeNull();
  });

  it("treats an engineRev change since the last connect as a forced reconnect", () => {
    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    const staleSource = currentSource();
    useChatStore.setState({ engineRev: 5 });

    useChatStore.getState().connectGlobalSSE(["ws-a"]);

    expect(staleSource.readyState).toBe(EventSource.CLOSED);
    expect(currentSource()).not.toBe(staleSource);
    expect(currentSource().url).toContain("engineRev=5");
  });

  it("keeps today's early return and overlap for non-forced connects after a reset", () => {
    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    useChatStore.getState().resetWorkspace("ws-a");
    const resetSource = currentSource();

    useChatStore.getState().connectGlobalSSE(["ws-a"]);
    expect(currentSource()).toBe(resetSource);
    expect(createdSources).toHaveLength(2);

    useChatStore.getState().connectGlobalSSE(["ws-a", "ws-b"]);
    const overlapSource = currentSource();
    expect(overlapSource.url).toContain("engineRev=1");
    expect(resetSource.readyState).not.toBe(EventSource.CLOSED);

    deliver(resetSource, "ws-b", "session.created", {
      info: session("overlap-session"),
    });
    expect(
      useChatStore.getState().workspaceStates["ws-b"]?.sessions,
    ).toHaveProperty("overlap-session");

    overlapSource.simulateOpen();
    expect(resetSource.readyState).toBe(EventSource.CLOSED);
  });
});

describe("resetWorkspace state", () => {
  it("drops pending message, part, and delta updates for the reset workspace only", () => {
    const loadedMessage: MessageWithParts = {
      info: assistantInfo("msg-b1", "sess-b"),
      parts: [textPart("part-b1", "sess-b", "msg-b1", "hello")],
    };
    useChatStore.setState({
      workspaceStates: {
        "ws-a": workspaceWith("sess-a", []),
        "ws-b": workspaceWith("sess-b", [loadedMessage]),
      },
    });
    useChatStore.getState().connectGlobalSSE(["ws-a", "ws-b"]);
    const source = currentSource();

    deliver(source, "ws-b", "message.updated", {
      info: assistantInfo("msg-b2", "sess-b"),
    });
    deliver(source, "ws-b", "message.part.updated", {
      part: textPart("part-b1", "sess-b", "msg-b1", "hello world"),
    });
    deliver(source, "ws-b", "message.part.delta", {
      sessionID: "sess-b",
      messageID: "msg-b3",
      partID: "part-b3",
      field: "text",
      delta: "STALE",
    });
    deliver(source, "ws-a", "message.updated", {
      info: assistantInfo("msg-a2", "sess-a"),
    });
    expect(animationFrames.length).toBeGreaterThan(0);

    useChatStore.getState().resetWorkspace("ws-b");
    useChatStore.setState((state) => ({
      workspaceStates: {
        ...state.workspaceStates,
        "ws-b": workspaceWith("sess-b", [loadedMessage]),
      },
    }));
    flushAnimationFrames();

    const freshSource = currentSource();
    deliver(freshSource, "ws-b", "message.updated", {
      info: assistantInfo("msg-b3", "sess-b"),
    });
    deliver(freshSource, "ws-b", "message.part.updated", {
      part: textPart("part-b3", "sess-b", "msg-b3", "fresh"),
    });
    flushAnimationFrames();

    const state = useChatStore.getState();
    const workspaceBMessages = state.workspaceStates["ws-b"].messages["sess-b"];
    expect(workspaceBMessages.map((message) => message.info.id)).toEqual([
      "msg-b1",
      "msg-b3",
    ]);
    expect(textOf(workspaceBMessages[0])).toBe("hello");
    expect(textOf(workspaceBMessages[1])).toBe("fresh");
    expect(
      state.workspaceStates["ws-a"].messages["sess-a"].map(
        (message) => message.info.id,
      ),
    ).toEqual(["msg-a2"]);
  });

  it("clears the workspace's sessions, messages, status, and keyed metadata", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-b",
      activeSessionId: "sess-b",
      optimisticStreamingSessionId: "sess-b",
      streamingError: "stale error",
      workspaceStates: {
        "ws-a": workspaceWith("sess-a", []),
        "ws-b": workspaceWith("sess-b", []),
      },
      messageAccessOrder: [
        { sessionId: "sess-a", workspaceId: "ws-a" },
        { sessionId: "sess-b", workspaceId: "ws-b" },
      ],
      hasMoreBeforeBySession: { "ws-a:sess-a": true, "ws-b:sess-b": true },
      messageLoadErrorBySession: { "ws-b:sess-b": "failed" },
      recoveredMessageIdsBySession: { "ws-b:sess-b": new Set(["m1"]) },
      queuedMessages: new Map([
        [
          "ws-b",
          [
            {
              sessionId: "sess-b",
              text: "queued",
              workspaceId: "ws-b",
              optimisticMessageId: "optimistic-1",
            },
          ],
        ],
      ]),
      queuedWorkspaceIds: new Set(["ws-b"]),
    });

    useChatStore.getState().resetWorkspace("ws-b");

    const state = useChatStore.getState();
    const workspaceB = state.workspaceStates["ws-b"];
    expect(workspaceB.sessions).toEqual({});
    expect(workspaceB.messages).toEqual({});
    expect(workspaceB.sessionStatuses).toEqual({});
    expect(workspaceB.sessionAgents).toEqual({});
    expect(workspaceB.sessionsLoaded).toBe(false);
    expect(state.workspaceStates["ws-a"].sessions).toHaveProperty("sess-a");
    expect(state.activeSessionId).toBeNull();
    expect(state.optimisticStreamingSessionId).toBeNull();
    expect(state.streamingError).toBeNull();
    expect(state.messageAccessOrder).toEqual([
      { sessionId: "sess-a", workspaceId: "ws-a" },
    ]);
    expect(state.hasMoreBeforeBySession).toEqual({ "ws-a:sess-a": true });
    expect(state.messageLoadErrorBySession).toEqual({});
    expect(state.recoveredMessageIdsBySession).toEqual({});
    expect(state.queuedMessages.has("ws-b")).toBe(false);
    expect(state.queuedWorkspaceIds.has("ws-b")).toBe(false);
  });
});
