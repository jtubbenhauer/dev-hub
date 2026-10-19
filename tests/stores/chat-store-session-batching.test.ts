import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { _resetModuleCaches, useChatStore } from "../../stores/chat-store";

function makeSession(id: string, title = `Session ${id}`) {
  return {
    id,
    projectID: "proj-1",
    directory: "/workspace",
    title,
    version: "1",
    time: { created: 1000, updated: 1000 },
  };
}

function resetStore() {
  _resetModuleCaches();
  useChatStore.setState({
    workspaceStates: {},
    activeWorkspaceId: null,
    activeSessionId: null,
    streamingError: null,
    streamingPollInterval: null,
    optimisticStreamingSessionId: null,
  });
}

function emit(type: string, properties: Record<string, unknown>) {
  useChatStore.getState().handleEvent({ type, properties }, "ws-a");
}

// tests/setup.ts runs animation frames immediately; holding them makes the
// per-frame batching observable.
function holdAnimationFrames(): { readonly runFrames: () => void } {
  const frames: FrameRequestCallback[] = [];
  const runImmediately = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  onTestFinished(() => {
    globalThis.requestAnimationFrame = runImmediately;
  });
  return {
    runFrames: () => {
      for (const frame of frames.splice(0)) frame(performance.now());
    },
  };
}

function countStoreWrites(): () => number {
  let writes = 0;
  const unsubscribe = useChatStore.subscribe(() => {
    writes += 1;
  });
  onTestFinished(unsubscribe);
  return () => writes;
}

describe("chat store session events", () => {
  beforeEach(() => {
    resetStore();
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    emit("session.created", { info: makeSession("sess-1") });
    emit("session.created", { info: makeSession("sess-2") });
  });

  it("applies the statuses and session updates of one frame in a single store write", () => {
    // Given
    const { runFrames } = holdAnimationFrames();
    const storeWrites = countStoreWrites();

    // When
    emit("session.status", { sessionID: "sess-1", status: { type: "busy" } });
    emit("session.status", { sessionID: "sess-2", status: { type: "busy" } });
    emit("session.updated", { info: makeSession("sess-1", "Renamed") });
    runFrames();

    // Then
    const workspace = useChatStore.getState().workspaceStates["ws-a"];
    expect(storeWrites()).toBe(1);
    expect(workspace?.sessionStatuses).toEqual({
      "sess-1": { type: "busy" },
      "sess-2": { type: "busy" },
    });
    expect(workspace?.sessions["sess-1"]?.title).toBe("Renamed");
  });

  it("leaves the store untouched when events repeat the stored session and status", () => {
    // Given
    emit("session.status", { sessionID: "sess-1", status: { type: "busy" } });
    const storeWrites = countStoreWrites();

    // When
    emit("session.status", { sessionID: "sess-1", status: { type: "busy" } });
    emit("session.updated", { info: makeSession("sess-1") });

    // Then
    expect(storeWrites()).toBe(0);
  });

  it("keeps a session idle when session.idle follows a busy status in the same frame", () => {
    // Given
    const { runFrames } = holdAnimationFrames();

    // When
    emit("session.status", { sessionID: "sess-1", status: { type: "busy" } });
    emit("session.idle", { sessionID: "sess-1" });
    runFrames();

    // Then
    expect(
      useChatStore.getState().workspaceStates["ws-a"]?.sessionStatuses[
        "sess-1"
      ],
    ).toEqual({ type: "idle" });
  });

  it("drops a buffered status when its session is deleted before the frame", () => {
    // Given
    const { runFrames } = holdAnimationFrames();
    emit("session.status", { sessionID: "sess-1", status: { type: "busy" } });

    // When
    emit("session.deleted", { info: makeSession("sess-1") });
    runFrames();

    // Then
    expect(
      useChatStore.getState().workspaceStates["ws-a"]?.sessionStatuses,
    ).not.toHaveProperty("sess-1");
  });
});

describe("chat store session metadata cache writes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the sessions changed within a second as one request", async () => {
    // Given
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => new Response(null, { status: 200 }));
    global.fetch = fetchMock;

    // When
    emit("session.created", { info: makeSession("sess-3") });
    emit("session.updated", { info: makeSession("sess-3", "Renamed") });
    emit("session.created", { info: makeSession("sess-4") });
    await vi.advanceTimersByTimeAsync(1_000);

    // Then
    const posts = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    const body: unknown = JSON.parse(String(posts[0]?.[1]?.body));
    expect(body).toMatchObject({
      workspaceId: "ws-a",
      sessions: [
        { id: "sess-3", title: "Renamed" },
        { id: "sess-4", title: "Session sess-4" },
      ],
    });
  });
});
