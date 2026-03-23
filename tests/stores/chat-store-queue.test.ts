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
});
