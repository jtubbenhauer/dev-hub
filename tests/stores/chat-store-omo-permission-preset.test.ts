import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";
import { useOmoPermissionPresetStore } from "@/stores/omo-permission-preset-store";
import { useSubAgentActivityStore } from "@/stores/sub-agent-activity-store";

vi.mock("@/lib/sounds", () => ({
  playSoundForEvent: vi.fn(),
}));

function workspaceWithSession(): WorkspaceState {
  return {
    sessions: {
      "sess-1": {
        id: "sess-1",
        projectID: "proj-1",
        directory: "/workspace",
        title: "Session sess-1",
        version: "1",
        parentID: undefined,
        time: { created: 1000, updated: 1000 },
      },
    },
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
    sessionVariants: {},
    sessionNotes: {},
  };
}

const fetchMock = vi.fn(
  async (_url: string, _init?: RequestInit) =>
    new Response(null, { status: 204 }),
);

function sentBody(pathSuffix: string): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) =>
    url.split("?")[0]?.endsWith(pathSuffix),
  );
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

describe("chat store omo permission presets and sub-agent activity", () => {
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    useOmoPermissionPresetStore.setState({ presetByWorkspace: {} });
    useSubAgentActivityStore.setState({ activityBySession: {} });
    useChatStore.setState({
      workspaceStates: { "ws-1": workspaceWithSession() },
      queuedMessages: new Map(),
      queuedWorkspaceIds: new Set(),
      activeWorkspaceId: null,
      activeSessionId: null,
      streamingError: null,
      optimisticStreamingSessionId: null,
    });
  });

  afterEach(() => {
    useChatStore.getState().clearStreamingPoll();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("sends the workspace's permission preset with a prompt", async () => {
    // Given
    useOmoPermissionPresetStore.getState().setPreset("ws-1", "ask");

    // When
    await useChatStore.getState().sendMessage("sess-1", "hello", "ws-1");

    // Then
    expect(sentBody("/session/sess-1/prompt_async")).toMatchObject({
      permissionPreset: "ask",
    });
  });

  it("leaves the preset out when the workspace has none", async () => {
    // Given
    useOmoPermissionPresetStore.getState().setPreset("ws-2", "ask");

    // When
    await useChatStore.getState().sendMessage("sess-1", "hello", "ws-1");

    // Then
    expect(sentBody("/session/sess-1/prompt_async")).not.toHaveProperty(
      "permissionPreset",
    );
  });

  it("sends the workspace's permission preset with a command", async () => {
    // Given
    useOmoPermissionPresetStore.getState().setPreset("ws-1", "read-only");

    // When
    await useChatStore
      .getState()
      .executeCommand("sess-1", "ws-1", "review", "src");

    // Then
    expect(sentBody("/session/sess-1/command")).toMatchObject({
      command: "review",
      arguments: "src",
      permissionPreset: "read-only",
    });
  });

  it("tracks a sub-agent's activity until it goes idle", () => {
    // Given
    const store = useChatStore.getState();
    const activity = {
      summary: "Running bash",
      currentTool: "bash",
      turns: 2,
      updatedAt: 10,
    };

    // When
    store.handleEvent(
      {
        type: "session.activity",
        properties: { sessionID: "child-1", activity },
      },
      "ws-1",
    );
    const tracked =
      useSubAgentActivityStore.getState().activityBySession["child-1"];
    store.handleEvent(
      {
        type: "session.status",
        properties: { sessionID: "child-1", status: { type: "idle" } },
      },
      "ws-1",
    );

    // Then
    expect(tracked).toEqual(activity);
    expect(
      useSubAgentActivityStore.getState().activityBySession["child-1"],
    ).toBeUndefined();
  });
});
