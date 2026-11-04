import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { useSessionCreate } from "@/components/chat/use-session-create";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";
import type { Workspace } from "@/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const storeMocks = vi.hoisted(() => ({
  setActiveWorkspaceId: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: {
    getState: vi.fn(() => storeMocks),
  },
}));

const workspaceStoreMocks = vi.hoisted(() => ({
  setActiveWorkspaceId: vi.fn(),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => workspaceStoreMocks),
  },
}));

function makeWorkspace(
  id: string,
  overrides: Partial<Workspace> = {},
): Workspace {
  return {
    id,
    userId: "user-1",
    name: id,
    path: `/workspaces/${id}`,
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "local",
    provider: null,
    opencodeUrl: null,
    agentUrl: null,
    providerMeta: null,
    shellCommand: null,
    sshTarget: null,
    sshPath: null,
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date(0),
    lastAccessedAt: new Date(0),
    ...overrides,
  };
}

describe("useSessionCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNewChatEngineStore.setState({ engineByWorkspace: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("creates each chat on the engine picked for it", () => {
    storeMocks.createSession.mockResolvedValue({ id: "omo_1" });
    const { result } = renderHook(() =>
      useSessionCreate({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [makeWorkspace("ws-1"), makeWorkspace("ws-2")],
        healthStatus: "healthy",
      }),
    );

    act(() => {
      result.current.handleCreateSession("omo");
      result.current.handleCreateSessionInWorkspace("ws-2", "opencode");
    });

    expect(storeMocks.createSession).toHaveBeenCalledWith("ws-1", "omo");
    expect(storeMocks.createSession).toHaveBeenCalledWith("ws-2", "opencode");
  });

  it("uses the engine picked in the empty chat when the caller names none", () => {
    storeMocks.createSession.mockResolvedValue({ id: "omo_1" });
    useNewChatEngineStore.getState().setNewChatEngine("ws-1", "omo");
    const { result } = renderHook(() =>
      useSessionCreate({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [makeWorkspace("ws-1")],
        healthStatus: "healthy",
      }),
    );

    act(() => result.current.handleCreateSession());

    expect(storeMocks.createSession).toHaveBeenCalledWith("ws-1", "omo");
  });

  it("tells the user when a chat can't be created", async () => {
    storeMocks.createSession.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useSessionCreate({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [makeWorkspace("ws-1")],
        healthStatus: "healthy",
      }),
    );

    act(() => result.current.handleCreateSession("omo"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't create a new chat"),
    );
  });

  it("creates the picked engine's chat once a sleeping remote workspace is healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    storeMocks.createSession.mockResolvedValue({ id: "omo_1" });
    const remoteWorkspaces = [makeWorkspace("ws-1", { backend: "remote" })];
    const { result, rerender } = renderHook(
      ({ healthStatus }: { healthStatus: string }) =>
        useSessionCreate({
          activeWorkspaceId: "ws-1",
          allWorkspaces: remoteWorkspaces,
          healthStatus,
        }),
      { initialProps: { healthStatus: "stopped" } },
    );

    act(() => result.current.handleCreateSession("omo"));
    expect(storeMocks.createSession).not.toHaveBeenCalled();

    rerender({ healthStatus: "healthy" });

    await waitFor(() =>
      expect(storeMocks.createSession).toHaveBeenCalledWith("ws-1", "omo"),
    );
    expect(storeMocks.createSession).toHaveBeenCalledTimes(1);
  });

  describe("with session-chosen and new-chat callbacks", () => {
    function renderSessionCreate(
      overrides: Partial<Parameters<typeof useSessionCreate>[0]> = {},
    ) {
      return renderHook(
        (props: Partial<Parameters<typeof useSessionCreate>[0]>) =>
          useSessionCreate({
            activeWorkspaceId: "ws-1",
            allWorkspaces: [makeWorkspace("ws-1"), makeWorkspace("ws-2")],
            healthStatus: "healthy",
            ...props,
          }),
        { initialProps: overrides },
      );
    }

    it("tells the caller which session a new chat created", async () => {
      storeMocks.createSession.mockResolvedValue({ id: "omo_1" });
      const onSessionChosen = vi.fn();
      const { result } = renderSessionCreate({ onSessionChosen });

      act(() => result.current.handleCreateSession("omo"));

      await waitFor(() =>
        expect(onSessionChosen).toHaveBeenCalledExactlyOnceWith(
          "ws-1",
          "omo_1",
        ),
      );
    });

    it("does not report a chat that could not be created", async () => {
      storeMocks.createSession.mockResolvedValue(null);
      const onSessionChosen = vi.fn();
      const { result } = renderSessionCreate({ onSessionChosen });

      act(() => result.current.handleCreateSession("omo"));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Couldn't create a new chat"),
      );
      expect(onSessionChosen).not.toHaveBeenCalled();
    });

    it("reports the chat created once a sleeping remote workspace is healthy", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 200 })),
      );
      storeMocks.createSession.mockResolvedValue({ id: "ses_remote" });
      const onSessionChosen = vi.fn();
      const remoteWorkspaces = [makeWorkspace("ws-1", { backend: "remote" })];
      const { result, rerender } = renderSessionCreate({
        allWorkspaces: remoteWorkspaces,
        healthStatus: "stopped",
        onSessionChosen,
      });

      act(() => result.current.handleCreateSession("opencode"));
      expect(onSessionChosen).not.toHaveBeenCalled();

      rerender({
        allWorkspaces: remoteWorkspaces,
        healthStatus: "healthy",
        onSessionChosen,
      });

      await waitFor(() =>
        expect(onSessionChosen).toHaveBeenCalledWith("ws-1", "ses_remote"),
      );
    });

    it("hands a new chat in another workspace over instead of creating it", () => {
      const onNewChatInWorkspace = vi.fn();
      const { result } = renderSessionCreate({ onNewChatInWorkspace });

      act(() => result.current.handleCreateSessionInWorkspace("ws-2", "omo"));

      expect(onNewChatInWorkspace).toHaveBeenCalledExactlyOnceWith(
        "ws-2",
        "omo",
      );
      expect(storeMocks.createSession).not.toHaveBeenCalled();
      expect(workspaceStoreMocks.setActiveWorkspaceId).not.toHaveBeenCalled();
      expect(storeMocks.setActiveWorkspaceId).not.toHaveBeenCalled();
    });

    it("wakes a sleeping remote workspace before handing its new chat over", () => {
      const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const onNewChatInWorkspace = vi.fn();
      const { result } = renderSessionCreate({
        allWorkspaces: [
          makeWorkspace("ws-1"),
          makeWorkspace("ws-2", { backend: "remote" }),
        ],
        healthStatus: undefined,
        onNewChatInWorkspace,
      });

      act(() => result.current.handleCreateSessionInWorkspace("ws-2", "omo"));

      expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/ws-2/start", {
        method: "POST",
      });
      expect(onNewChatInWorkspace).toHaveBeenCalledWith("ws-2", "omo");
      expect(storeMocks.createSession).not.toHaveBeenCalled();
    });

    it("still creates a chat in its own workspace", () => {
      storeMocks.createSession.mockResolvedValue({ id: "ses_1" });
      const onNewChatInWorkspace = vi.fn();
      const { result } = renderSessionCreate({ onNewChatInWorkspace });

      act(() =>
        result.current.handleCreateSessionInWorkspace("ws-1", "opencode"),
      );

      expect(storeMocks.createSession).toHaveBeenCalledWith("ws-1", "opencode");
      expect(onNewChatInWorkspace).not.toHaveBeenCalled();
    });
  });
});
