import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "@/stores/chat-store";

const toastMock = vi.fn();

vi.mock("sonner", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

function makeSession(id: string) {
  return {
    id,
    projectID: "proj-1",
    directory: "/workspace",
    title: `Session ${id}`,
    version: "1",
    parentID: undefined,
    time: { created: 1000, updated: 1000 },
  };
}

function resetStore() {
  useChatStore.setState({
    workspaceStates: {},
    commands: [],
    messageAccessOrder: [],
    queuedMessages: new Map(),
    queuedWorkspaceIds: new Set(),
    activeWorkspaceId: null,
    activeSessionId: null,
    streamingError: null,
    streamingPollInterval: null,
    optimisticStreamingSessionId: null,
  });
}

describe("chat store queued message handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("queues a message on proxy 502 and keeps optimistic message visible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "OpenCode proxy error" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessions: { "sess-1": makeSession("sess-1") },
          sessionsLoaded: true,
          messages: { "sess-1": [] },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
        },
      },
    });

    await useChatStore.getState().sendMessage("sess-1", "hello", "ws-1");

    const state = useChatStore.getState();
    expect(state.workspaceStates["ws-1"].messages["sess-1"]).toHaveLength(1);
    expect(state.queuedMessages.get("ws-1")).toHaveLength(1);
    expect(state.queuedWorkspaceIds.has("ws-1")).toBe(true);
    expect(state.streamingError).toBeNull();
    expect(toastMock).toHaveBeenCalledWith(
      "Message queued - workspace is starting...",
    );
  });

  it("queues on 504 (timeout) and keeps optimistic message visible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "OpenCode proxy error" }), {
            status: 504,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessions: { "sess-1": makeSession("sess-1") },
          sessionsLoaded: true,
          messages: { "sess-1": [] },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
        },
      },
    });

    await useChatStore.getState().sendMessage("sess-1", "hello", "ws-1");

    const state = useChatStore.getState();
    expect(state.workspaceStates["ws-1"].messages["sess-1"]).toHaveLength(1);
    expect(state.queuedMessages.get("ws-1")).toHaveLength(1);
    expect(state.queuedWorkspaceIds.has("ws-1")).toBe(true);
    expect(state.streamingError).toBeNull();
    expect(toastMock).toHaveBeenCalledWith(
      "Message queued - will retry when workspace is available",
    );
  });

  it("queues on 500 (server error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("err", { status: 500 })),
    );

    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessions: { "sess-1": makeSession("sess-1") },
          sessionsLoaded: true,
          messages: { "sess-1": [] },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
        },
      },
    });

    await useChatStore.getState().sendMessage("sess-1", "hi", "ws-1");

    const state = useChatStore.getState();
    expect(state.queuedMessages.get("ws-1")).toHaveLength(1);
    expect(state.workspaceStates["ws-1"].messages["sess-1"]).toHaveLength(1);
    expect(state.streamingError).toBeNull();
  });

  it("queues on 429 (rate limit)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );

    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessions: { "sess-1": makeSession("sess-1") },
          sessionsLoaded: true,
          messages: { "sess-1": [] },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
        },
      },
    });

    await useChatStore.getState().sendMessage("sess-1", "hi", "ws-1");

    const state = useChatStore.getState();
    expect(state.queuedMessages.get("ws-1")).toHaveLength(1);
    expect(state.workspaceStates["ws-1"].messages["sess-1"]).toHaveLength(1);
  });

  it("queues on network error (fetch throws)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessions: { "sess-1": makeSession("sess-1") },
          sessionsLoaded: true,
          messages: { "sess-1": [] },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
        },
      },
    });

    await useChatStore.getState().sendMessage("sess-1", "hi", "ws-1");

    const state = useChatStore.getState();
    expect(state.queuedMessages.get("ws-1")).toHaveLength(1);
    expect(state.workspaceStates["ws-1"].messages["sess-1"]).toHaveLength(1);
    expect(toastMock).toHaveBeenCalledWith(
      "Message queued - will retry when connection recovers",
    );
  });

  it("rolls back on 400 (client error) — does NOT queue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "bad request" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessions: { "sess-1": makeSession("sess-1") },
          sessionsLoaded: true,
          messages: { "sess-1": [] },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
        },
      },
    });

    await useChatStore.getState().sendMessage("sess-1", "hi", "ws-1");

    const state = useChatStore.getState();
    expect(state.queuedMessages.get("ws-1")).toBeUndefined();
    expect(state.workspaceStates["ws-1"].messages["sess-1"]).toHaveLength(0);
    expect(state.streamingError).not.toBeNull();
  });

  it("removes from queue when send succeeds (200 OK)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessions: { "sess-1": makeSession("sess-1") },
          sessionsLoaded: true,
          messages: { "sess-1": [] },
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
        },
      },
    });

    await useChatStore.getState().sendMessage("sess-1", "hi", "ws-1");

    const state = useChatStore.getState();
    expect(state.queuedMessages.get("ws-1")).toBeUndefined();
    expect(state.queuedWorkspaceIds.has("ws-1")).toBe(false);
    expect(state.workspaceStates["ws-1"].messages["sess-1"]).toHaveLength(1);
  });

  it("flushQueuedMessages replays queued messages and clears queue state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessions: { "sess-1": makeSession("sess-1") },
          sessionsLoaded: true,
          messages: {
            "sess-1": [
              {
                info: {
                  id: "optimistic-old",
                  sessionID: "sess-1",
                  role: "user",
                  time: { created: Date.now() },
                  agent: "",
                  model: { providerID: "", modelID: "" },
                },
                parts: [
                  {
                    id: "optimistic-old-part",
                    sessionID: "sess-1",
                    messageID: "optimistic-old",
                    type: "text",
                    text: "queued hello",
                  },
                ],
              },
            ],
          },
          optimisticMessageIds: { "sess-1": "optimistic-old" },
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: {},
          sessionModels: {},
          lastViewedAt: {},
          pinnedSessionIds: new Set(),
        },
      },
      queuedMessages: new Map([
        [
          "ws-1",
          [
            {
              sessionId: "sess-1",
              text: "queued hello",
              workspaceId: "ws-1",
              optimisticMessageId: "optimistic-old",
            },
          ],
        ],
      ]),
      queuedWorkspaceIds: new Set(["ws-1"]),
    });

    await useChatStore.getState().flushQueuedMessages("ws-1");

    const state = useChatStore.getState();
    expect(state.queuedMessages.get("ws-1")).toBeUndefined();
    expect(state.queuedWorkspaceIds.has("ws-1")).toBe(false);
    expect(
      state.workspaceStates["ws-1"].messages["sess-1"].some(
        (message) => message.info.id === "optimistic-old",
      ),
    ).toBe(false);

    const fetchCalls = vi.mocked(fetch).mock.calls;
    expect(
      fetchCalls.some((call) => String(call[0]).includes("prompt_async")),
    ).toBe(true);
  });

  it("flushQueuedMessages SKIPS a queued message whose text matches a non-optimistic server message (dedup)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 500 })),
    );

    useChatStore.setState({
      workspaceStates: {
        "ws-1": {
          sessions: { "sess-1": makeSession("sess-1") },
          sessionsLoaded: true,
          messages: {
            "sess-1": [
              {
                info: {
                  id: "server-msg-1",
                  sessionID: "sess-1",
                  role: "user",
                  time: { created: Date.now() },
                  agent: "",
                  model: { providerID: "", modelID: "" },
                },
                parts: [
                  {
                    id: "server-msg-1-part",
                    sessionID: "sess-1",
                    messageID: "server-msg-1",
                    type: "text",
                    text: "already delivered",
                  },
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
        },
      },
      queuedMessages: new Map([
        [
          "ws-1",
          [
            {
              sessionId: "sess-1",
              text: "already delivered",
              workspaceId: "ws-1",
              optimisticMessageId: "optimistic-recovered",
            },
          ],
        ],
      ]),
      queuedWorkspaceIds: new Set(["ws-1"]),
    });

    await useChatStore.getState().flushQueuedMessages("ws-1");

    const fetchCalls = vi.mocked(fetch).mock.calls;
    const promptAsyncCalls = fetchCalls.filter((call) =>
      String(call[0]).includes("prompt_async"),
    );
    expect(promptAsyncCalls).toHaveLength(0);

    const state = useChatStore.getState();
    expect(state.queuedMessages.get("ws-1")).toBeUndefined();
    expect(state.queuedWorkspaceIds.has("ws-1")).toBe(false);
  });

  it("partialize serializes queuedMessages Map as entry array and queuedWorkspaceIds Set as string array", () => {
    useChatStore.setState({
      queuedMessages: new Map([
        [
          "ws-1",
          [
            {
              sessionId: "sess-1",
              text: "pending",
              workspaceId: "ws-1",
              optimisticMessageId: "optimistic-1",
            },
          ],
        ],
      ]),
      queuedWorkspaceIds: new Set(["ws-1"]),
    });

    const partialize = useChatStore.persist.getOptions().partialize!;
    const persisted = partialize(useChatStore.getState()) as {
      queuedMessages: Array<[string, Array<{ text: string }>]>;
      queuedWorkspaceIds: string[];
    };

    expect(Array.isArray(persisted.queuedMessages)).toBe(true);
    expect(persisted.queuedMessages).toHaveLength(1);
    expect(persisted.queuedMessages[0][0]).toBe("ws-1");
    expect(persisted.queuedMessages[0][1][0].text).toBe("pending");
    expect(persisted.queuedWorkspaceIds).toEqual(["ws-1"]);
  });

  it("merge rehydrates queuedMessages back into a Map and queuedWorkspaceIds into a Set", () => {
    const merge = useChatStore.persist.getOptions().merge!;
    const merged = merge(
      {
        activeSessionId: null,
        workspaceStates: {},
        queuedMessages: [
          [
            "ws-recovered",
            [
              {
                sessionId: "sess-recovered",
                text: "survived refresh",
                workspaceId: "ws-recovered",
                optimisticMessageId: "optimistic-recovered",
              },
            ],
          ],
        ],
        queuedWorkspaceIds: ["ws-recovered"],
      },
      useChatStore.getState(),
    ) as ReturnType<typeof useChatStore.getState>;

    expect(merged.queuedMessages).toBeInstanceOf(Map);
    expect(merged.queuedWorkspaceIds).toBeInstanceOf(Set);
    expect(merged.queuedMessages.get("ws-recovered")).toHaveLength(1);
    expect(merged.queuedMessages.get("ws-recovered")?.[0].text).toBe(
      "survived refresh",
    );
    expect(merged.queuedWorkspaceIds.has("ws-recovered")).toBe(true);
  });
});
