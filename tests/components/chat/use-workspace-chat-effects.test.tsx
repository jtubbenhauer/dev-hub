import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceChatEffects } from "@/components/chat/use-workspace-chat-effects";
import type { Session } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";
import { usePendingChatStore } from "@/stores/pending-chat-store";

vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: () => ({ engine: "opencode", isLoading: false }),
}));

const initialStoreState = useChatStore.getState();

function stubStoreLoaders() {
  const store = useChatStore.getState();
  const setActiveWorkspaceId = vi
    .spyOn(store, "setActiveWorkspaceId")
    .mockImplementation(() => {});
  vi.spyOn(store, "fetchSessions").mockResolvedValue();
  const fetchCommands = vi.spyOn(store, "fetchCommands").mockResolvedValue();
  vi.spyOn(store, "fetchPinnedSessions").mockResolvedValue();
  vi.spyOn(store, "fetchSessionNotes").mockResolvedValue();
  return { setActiveWorkspaceId, fetchCommands };
}

function makeSession(id: string): Session {
  return {
    id,
    projectID: "project",
    directory: "/workspace",
    title: "New chat",
    version: "1",
    time: { created: 0, updated: 0 },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  useChatStore.setState(initialStoreState, true);
  usePendingChatStore.setState({ pending: null });
});

describe("useWorkspaceChatEffects", () => {
  it("syncs the chat store to the workspace it is given", () => {
    const { setActiveWorkspaceId } = stubStoreLoaders();

    renderHook(() =>
      useWorkspaceChatEffects({
        workspaceId: "ws-a",
        healthStatus: undefined,
        isWorkspaceRemote: false,
      }),
    );

    expect(setActiveWorkspaceId).toHaveBeenCalledWith("ws-a");
  });

  it("loads commands for the open chat's engine and reloads them when it changes", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-a",
      activeSessionId: "omo_a",
    });
    const { fetchCommands } = stubStoreLoaders();

    const { unmount } = renderHook(() =>
      useWorkspaceChatEffects({
        workspaceId: "ws-a",
        healthStatus: undefined,
        isWorkspaceRemote: false,
      }),
    );
    expect(fetchCommands).toHaveBeenLastCalledWith("ws-a", "omo");

    act(() => {
      useChatStore.setState({ activeSessionId: "ses_b" });
    });

    expect(fetchCommands).toHaveBeenLastCalledWith("ws-a", "opencode");
    expect(fetchCommands).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("reports the session it starts for a pending chat before sending to it", async () => {
    stubStoreLoaders();
    const store = useChatStore.getState();
    vi.spyOn(store, "createSession").mockResolvedValue(makeSession("ses_new"));
    const sendMessage = vi
      .spyOn(store, "sendMessage")
      .mockImplementation(async () => {});
    const onSessionStarted = vi.fn();
    usePendingChatStore
      .getState()
      .setPending({ workspaceId: "ws-a", message: "plan the task" });

    renderHook(() =>
      useWorkspaceChatEffects({
        workspaceId: "ws-a",
        healthStatus: undefined,
        isWorkspaceRemote: false,
        onSessionStarted,
      }),
    );

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith(
        "ses_new",
        "plan the task",
        "ws-a",
      ),
    );
    expect(onSessionStarted).toHaveBeenCalledExactlyOnceWith("ws-a", "ses_new");
    expect(onSessionStarted.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0],
    );
  });

  it("leaves a pending chat for another workspace queued", () => {
    stubStoreLoaders();
    const createSession = vi.spyOn(useChatStore.getState(), "createSession");
    usePendingChatStore
      .getState()
      .setPending({ workspaceId: "ws-other", message: "plan the task" });

    renderHook(() =>
      useWorkspaceChatEffects({
        workspaceId: "ws-a",
        healthStatus: undefined,
        isWorkspaceRemote: false,
        onSessionStarted: vi.fn(),
      }),
    );

    expect(createSession).not.toHaveBeenCalled();
    expect(usePendingChatStore.getState().pending).toEqual({
      workspaceId: "ws-other",
      message: "plan the task",
    });
  });
});
