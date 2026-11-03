import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatTabSessionEffects } from "@/components/chat/use-chat-tab-session-effects";
import { useChatStore } from "@/stores/chat-store";

const initialStoreState = useChatStore.getState();

interface SessionEffectsProps {
  workspaceId: string | null;
  sessionId: string | null;
  isVisible: boolean;
}

function stubStoreLoaders() {
  const store = useChatStore.getState();
  const fetchMessages = vi.spyOn(store, "fetchMessages").mockResolvedValue();
  const fetchSessionTodos = vi
    .spyOn(store, "fetchSessionTodos")
    .mockResolvedValue();
  const refreshMessages = vi
    .spyOn(store, "_refreshMessagesFromRemote")
    .mockResolvedValue();
  return { fetchMessages, fetchSessionTodos, refreshMessages };
}

function renderSessionEffects(initialProps: SessionEffectsProps) {
  return renderHook(
    (props: SessionEffectsProps) => useChatTabSessionEffects(props),
    { initialProps },
  );
}

function visibleCount(workspaceId: string, sessionId: string) {
  return useChatStore.getState().visibleSessionKeys[
    `${workspaceId}:${sessionId}`
  ];
}

const visibleTab: SessionEffectsProps = {
  workspaceId: "ws-a",
  sessionId: "sess-a",
  isVisible: true,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  useChatStore.setState(initialStoreState, true);
});

describe("useChatTabSessionEffects message sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("loads once without polling the full history while idle", async () => {
    const { fetchMessages, refreshMessages } = stubStoreLoaders();

    const { unmount } = renderSessionEffects(visibleTab);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(fetchMessages).toHaveBeenCalledOnce();
    expect(refreshMessages).not.toHaveBeenCalled();
    unmount();
  });
});

describe("useChatTabSessionEffects", () => {
  it("loads the tab session's messages and todos", () => {
    const { fetchMessages, fetchSessionTodos } = stubStoreLoaders();

    renderSessionEffects(visibleTab);

    expect(fetchMessages).toHaveBeenCalledWith("sess-a", "ws-a");
    expect(fetchSessionTodos).toHaveBeenCalledWith("sess-a", "ws-a");
  });

  it("waits until a hidden tab is shown before loading its session", () => {
    const { fetchMessages, fetchSessionTodos } = stubStoreLoaders();

    const { rerender } = renderSessionEffects({
      ...visibleTab,
      isVisible: false,
    });
    expect(fetchMessages).not.toHaveBeenCalled();
    expect(fetchSessionTodos).not.toHaveBeenCalled();

    rerender(visibleTab);

    expect(fetchMessages).toHaveBeenCalledWith("sess-a", "ws-a");
    expect(fetchSessionTodos).toHaveBeenCalledWith("sess-a", "ws-a");
  });

  it("registers the session as visible when a visible tab mounts", () => {
    stubStoreLoaders();

    renderSessionEffects(visibleTab);

    expect(visibleCount("ws-a", "sess-a")).toBe(1);
  });

  it("unregisters the session when the tab is hidden", () => {
    stubStoreLoaders();
    const { rerender } = renderSessionEffects(visibleTab);

    rerender({ ...visibleTab, isVisible: false });

    expect(visibleCount("ws-a", "sess-a")).toBeUndefined();
  });

  it("unregisters the session when the tab unmounts", () => {
    stubStoreLoaders();
    const { unmount } = renderSessionEffects(visibleTab);

    unmount();

    expect(visibleCount("ws-a", "sess-a")).toBeUndefined();
  });

  it("moves the registration when the tab switches sessions", () => {
    stubStoreLoaders();
    const { rerender } = renderSessionEffects(visibleTab);

    rerender({ ...visibleTab, sessionId: "sess-b" });

    expect(visibleCount("ws-a", "sess-a")).toBeUndefined();
    expect(visibleCount("ws-a", "sess-b")).toBe(1);
  });

  it("registers nothing for a new-chat tab", () => {
    const { fetchMessages } = stubStoreLoaders();

    renderSessionEffects({ ...visibleTab, sessionId: null });

    expect(useChatStore.getState().visibleSessionKeys).toEqual({});
    expect(fetchMessages).not.toHaveBeenCalled();
  });
});
