import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/opencode/types";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";
import { useOmoPermissionPresetStore } from "@/stores/omo-permission-preset-store";
import { useSubAgentActivityStore } from "@/stores/sub-agent-activity-store";

vi.mock("@/lib/sounds", () => ({
  playSoundForEvent: vi.fn(),
}));

const OMO_SESSION_ID = "omo_1";
const OPENCODE_SESSION_ID = "ses_1";

function session(id: string): Session {
  return {
    id,
    projectID: "proj-1",
    directory: "/workspace",
    title: `Session ${id}`,
    version: "1",
    time: { created: 1000, updated: 1000 },
  };
}

function workspaceWithSessions(): WorkspaceState {
  return {
    sessions: {
      [OMO_SESSION_ID]: session(OMO_SESSION_ID),
      [OPENCODE_SESSION_ID]: session(OPENCODE_SESSION_ID),
    },
    sessionsLoaded: true,
    messages: { [OMO_SESSION_ID]: [], [OPENCODE_SESSION_ID]: [] },
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
      workspaceStates: { "ws-1": workspaceWithSessions() },
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

  it("sends the workspace's permission preset with an omo chat's prompt", async () => {
    // Given
    useOmoPermissionPresetStore.getState().setPreset("ws-1", "ask");

    // When
    await useChatStore.getState().sendMessage(OMO_SESSION_ID, "hello", "ws-1");

    // Then
    expect(sentBody(`/session/${OMO_SESSION_ID}/prompt_async`)).toMatchObject({
      permissionPreset: "ask",
    });
  });

  it("leaves the preset out when the workspace has none", async () => {
    // Given
    useOmoPermissionPresetStore.getState().setPreset("ws-2", "ask");

    // When
    await useChatStore.getState().sendMessage(OMO_SESSION_ID, "hello", "ws-1");

    // Then
    expect(
      sentBody(`/session/${OMO_SESSION_ID}/prompt_async`),
    ).not.toHaveProperty("permissionPreset");
  });

  it("sends the workspace's permission preset with an omo chat's command", async () => {
    // Given
    useOmoPermissionPresetStore.getState().setPreset("ws-1", "read-only");

    // When
    await useChatStore
      .getState()
      .executeCommand(OMO_SESSION_ID, "ws-1", "review", "src");

    // Then
    expect(sentBody(`/session/${OMO_SESSION_ID}/command`)).toMatchObject({
      command: "review",
      arguments: "src",
      permissionPreset: "read-only",
    });
  });

  it("leaves the preset out of an OpenCode chat's prompt in the same workspace", async () => {
    // Given
    useOmoPermissionPresetStore.getState().setPreset("ws-1", "ask");

    // When
    await useChatStore
      .getState()
      .sendMessage(OPENCODE_SESSION_ID, "hello", "ws-1");

    // Then
    expect(
      sentBody(`/session/${OPENCODE_SESSION_ID}/prompt_async`),
    ).not.toHaveProperty("permissionPreset");
  });

  it("leaves the preset out of an OpenCode chat's command in the same workspace", async () => {
    // Given
    useOmoPermissionPresetStore.getState().setPreset("ws-1", "read-only");

    // When
    await useChatStore
      .getState()
      .executeCommand(OPENCODE_SESSION_ID, "ws-1", "review", "src");

    // Then
    expect(
      sentBody(`/session/${OPENCODE_SESSION_ID}/command`),
    ).not.toHaveProperty("permissionPreset");
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
