import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "@/stores/chat-store";

const initialStoreState = useChatStore.getState();

function makeSession(id: string) {
  return {
    id,
    projectID: "project-1",
    directory: "/workspace",
    title: `Session ${id}`,
    version: "1",
    time: { created: 1, updated: 1 },
  };
}

describe("chat session configuration persistence", () => {
  beforeEach(() => {
    useChatStore.setState(initialStoreState, true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the active session configuration when a limited refresh omits it", async () => {
    useChatStore.setState({
      activeWorkspaceId: "workspace-a",
      activeSessionId: "session-active",
      fetchCachedSessions: vi.fn().mockResolvedValue(undefined),
      workspaceStates: {
        "workspace-a": {
          sessions: { "session-active": makeSession("session-active") },
          sessionsLoaded: true,
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: { "session-active": "build" },
          sessionModels: {
            "session-active": {
              providerID: "provider-a",
              modelID: "model-a",
            },
          },
          sessionVariants: { "session-active": "high" },
          lastViewedAt: { "session-active": 100 },
          pinnedSessionIds: new Set(),
          sessionNotes: {},
        },
      },
    });
    const cappedSessions = Array.from({ length: 500 }, (_, index) =>
      makeSession(`session-${index}`),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(cappedSessions), {
          status: 200,
        }),
      ),
    );

    await useChatStore.getState().fetchSessions("workspace-a");

    expect(useChatStore.getState().getSessionAgent("session-active")).toBe(
      "build",
    );
    expect(useChatStore.getState().getSessionModel("session-active")).toEqual({
      providerID: "provider-a",
      modelID: "model-a",
    });
    expect(useChatStore.getState().getSessionVariant("session-active")).toBe(
      "high",
    );
  });

  it("prunes deleted session configuration after a complete refresh", async () => {
    useChatStore.setState({
      activeWorkspaceId: "workspace-a",
      activeSessionId: null,
      fetchCachedSessions: vi.fn().mockResolvedValue(undefined),
      workspaceStates: {
        "workspace-a": {
          sessions: { "session-deleted": makeSession("session-deleted") },
          sessionsLoaded: true,
          messages: {},
          optimisticMessageIds: {},
          sessionStatuses: {},
          permissions: [],
          questions: [],
          todos: {},
          sessionAgents: { "session-deleted": "build" },
          sessionModels: {
            "session-deleted": {
              providerID: "provider-a",
              modelID: "model-a",
            },
          },
          sessionVariants: { "session-deleted": "high" },
          lastViewedAt: { "session-deleted": 100 },
          pinnedSessionIds: new Set(),
          sessionNotes: {},
        },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([makeSession("session-current")]), {
          status: 200,
        }),
      ),
    );

    await useChatStore.getState().fetchSessions("workspace-a");

    expect(
      useChatStore.getState().getSessionAgent("session-deleted"),
    ).toBeNull();
    expect(
      useChatStore.getState().getSessionModel("session-deleted"),
    ).toBeNull();
    expect(
      useChatStore.getState().getSessionVariant("session-deleted"),
    ).toBeNull();
  });
});
