import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatEffects } from "@/components/chat/use-chat-effects";
import { useChatStore } from "@/stores/chat-store";

describe("useChatEffects active message sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("requests a fresh snapshot for an idle selected session", async () => {
    const store = useChatStore.getState();
    vi.spyOn(store, "setActiveWorkspaceId").mockImplementation(() => {});
    vi.spyOn(store, "fetchSessions").mockResolvedValue();
    vi.spyOn(store, "fetchMessages").mockResolvedValue();
    vi.spyOn(store, "fetchCommands").mockResolvedValue();
    vi.spyOn(store, "fetchPinnedSessions").mockResolvedValue();
    vi.spyOn(store, "fetchSessionNotes").mockResolvedValue();
    vi.spyOn(store, "getStreamingStatus").mockReturnValue("idle");
    const refreshMessages = vi
      .spyOn(store, "_refreshMessagesFromRemote")
      .mockResolvedValue();

    const { unmount } = renderHook(() =>
      useChatEffects({
        activeWorkspaceId: "ws-a",
        activeSessionId: "sess-a",
        healthStatus: undefined,
        isActiveWorkspaceRemote: false,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    expect(refreshMessages).toHaveBeenCalledWith("sess-a", "ws-a", {
      fresh: true,
    });
    unmount();
  });
});
