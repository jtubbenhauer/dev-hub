import { describe, it, expect, vi, beforeEach } from "vitest";
import { useChatStore } from "../../stores/chat-store";
import { playSoundForEvent } from "@/lib/sounds";

vi.mock("@/lib/sounds", () => ({
  playSoundForEvent: vi.fn(),
}));

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

describe("chat-store sounds integration", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("playSoundForEvent('agent') called on session.idle event", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-1") } },
      "ws-1",
    );

    store.handleEvent(
      { type: "session.idle", properties: { sessionID: "sess-1" } },
      "ws-1",
    );

    expect(playSoundForEvent).toHaveBeenCalledWith("agent");
  });

  it("playSoundForEvent('errors') called on session.error event", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-1") } },
      "ws-1",
    );

    store.handleEvent(
      {
        type: "session.error",
        properties: {
          sessionID: "sess-1",
          error: { data: { message: "Something broke" } },
        },
      },
      "ws-1",
    );

    expect(playSoundForEvent).toHaveBeenCalledWith("errors");
  });

  it("playSoundForEvent('permissions') called on permission.asked event", () => {
    const store = useChatStore.getState();
    const permission = makePermission("perm-1", "sess-1");

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-1") } },
      "ws-1",
    );

    store.handleEvent(
      { type: "permission.asked", properties: permission },
      "ws-1",
    );

    expect(playSoundForEvent).toHaveBeenCalledWith("permissions");
  });

  it("playSoundForEvent NOT called for other event types (e.g., session.compacted)", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-1") } },
      "ws-1",
    );

    store.handleEvent(
      { type: "session.compacted", properties: { sessionID: "sess-1" } },
      "ws-1",
    );

    expect(playSoundForEvent).not.toHaveBeenCalled();
  });

  it("playSoundForEvent called multiple times for multiple events", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-1") } },
      "ws-1",
    );

    // Fire three events that should trigger sounds
    store.handleEvent(
      { type: "session.idle", properties: { sessionID: "sess-1" } },
      "ws-1",
    );

    store.handleEvent(
      {
        type: "session.error",
        properties: {
          sessionID: "sess-1",
          error: { data: { message: "Error" } },
        },
      },
      "ws-1",
    );

    const permission = makePermission("perm-1", "sess-1");
    store.handleEvent(
      { type: "permission.asked", properties: permission },
      "ws-1",
    );

    expect(playSoundForEvent).toHaveBeenCalledTimes(3);
    expect(playSoundForEvent).toHaveBeenNthCalledWith(1, "agent");
    expect(playSoundForEvent).toHaveBeenNthCalledWith(2, "errors");
    expect(playSoundForEvent).toHaveBeenNthCalledWith(3, "permissions");
  });

  it("playSoundForEvent called even when session is not active", () => {
    const store = useChatStore.getState();

    store.handleEvent(
      { type: "session.created", properties: { info: makeSession("sess-1") } },
      "ws-1",
    );

    store.handleEvent(
      { type: "session.idle", properties: { sessionID: "sess-1" } },
      "ws-1",
    );

    expect(playSoundForEvent).toHaveBeenCalledWith("agent");
  });
});
