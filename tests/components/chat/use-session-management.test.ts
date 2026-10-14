import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { useSessionManagement } from "@/components/chat/use-session-management";
import { useIsMobile, useHasCoarsePointer } from "@/hooks/use-mobile";
import type { PromptInputHandle } from "@/components/chat/prompt-input";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";
import type { RefObject } from "react";
import type { Workspace } from "@/types";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(),
  useHasCoarsePointer: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const storeMocks = vi.hoisted(() => ({
  setActiveSession: vi.fn(),
  setActiveWorkspaceId: vi.fn(),
  fetchSessions: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  removeSessionLocal: vi.fn(),
  restoreSessionLocal: vi.fn(),
  fetchPinnedSessions: vi.fn(),
  fetchCachedSessions: vi.fn(),
  pinSession: vi.fn(),
  unpinSession: vi.fn(),
  fetchSessionNotes: vi.fn(),
  setSessionNote: vi.fn(),
  clearSessionNote: vi.fn(),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: {
    getState: vi.fn(() => storeMocks),
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

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => ({
      setActiveWorkspaceId: vi.fn(),
    })),
  },
}));

const nullPromptInputRef = {
  current: null,
} as RefObject<PromptInputHandle | null>;

describe("useSessionManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNewChatEngineStore.setState({ engineByWorkspace: {} });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  it("creates each chat on the engine picked for it", () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(useHasCoarsePointer).mockReturnValue(false);
    storeMocks.createSession.mockResolvedValue({ id: "omo_1" });
    const { result } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [makeWorkspace("ws-1"), makeWorkspace("ws-2")],
        healthStatus: "healthy",
        promptInputRef: nullPromptInputRef,
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
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(useHasCoarsePointer).mockReturnValue(false);
    storeMocks.createSession.mockResolvedValue({ id: "omo_1" });
    useNewChatEngineStore.getState().setNewChatEngine("ws-1", "omo");
    const { result } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [makeWorkspace("ws-1")],
        healthStatus: "healthy",
        promptInputRef: nullPromptInputRef,
      }),
    );

    act(() => result.current.handleCreateSession());

    expect(storeMocks.createSession).toHaveBeenCalledWith("ws-1", "omo");
  });

  it("tells the user when a chat can't be created", async () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(useHasCoarsePointer).mockReturnValue(false);
    storeMocks.createSession.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [makeWorkspace("ws-1")],
        healthStatus: "healthy",
        promptInputRef: nullPromptInputRef,
      }),
    );

    act(() => result.current.handleCreateSession("omo"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't create a new chat"),
    );
  });

  it("creates the picked engine's chat once a sleeping remote workspace is healthy", async () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(useHasCoarsePointer).mockReturnValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    storeMocks.createSession.mockResolvedValue({ id: "omo_1" });
    const remoteWorkspaces = [makeWorkspace("ws-1", { backend: "remote" })];
    const { result, rerender } = renderHook(
      ({ healthStatus }: { healthStatus: string }) =>
        useSessionManagement({
          activeWorkspaceId: "ws-1",
          allWorkspaces: remoteWorkspaces,
          healthStatus,
          promptInputRef: nullPromptInputRef,
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

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("does not focus prompt input on mobile when selecting a session", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    vi.mocked(useHasCoarsePointer).mockReturnValue(false);
    const focusMock = vi.fn();
    const promptInputRef = {
      current: { focus: focusMock } as unknown as PromptInputHandle,
    } as RefObject<PromptInputHandle | null>;

    const { result } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [],
        healthStatus: "healthy",
        promptInputRef,
      }),
    );

    result.current.handleSelectSession("session-1");
    expect(focusMock).not.toHaveBeenCalled();
  });

  it("focuses prompt input on desktop when selecting a session", () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(useHasCoarsePointer).mockReturnValue(false);
    const focusMock = vi.fn();
    const promptInputRef = {
      current: { focus: focusMock } as unknown as PromptInputHandle,
    } as RefObject<PromptInputHandle | null>;

    const { result } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [],
        healthStatus: "healthy",
        promptInputRef,
      }),
    );

    result.current.handleSelectSession("session-1");
    expect(focusMock).toHaveBeenCalled();
  });

  it("does not focus prompt input on coarse-pointer touch devices (e.g. foldables unfolded)", () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(useHasCoarsePointer).mockReturnValue(true);
    const focusMock = vi.fn();
    const promptInputRef = {
      current: { focus: focusMock } as unknown as PromptInputHandle,
    } as RefObject<PromptInputHandle | null>;

    const { result } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [],
        healthStatus: "healthy",
        promptInputRef,
      }),
    );

    result.current.handleSelectSession("session-1");
    expect(focusMock).not.toHaveBeenCalled();
  });

  it("hydrates pins for non-active workspaces in unified mode", () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(useHasCoarsePointer).mockReturnValue(false);
    localStorage.setItem("dev-hub:chat-unified-mode", "true");
    // Run the staggered non-active fetches synchronously instead of after 150ms.
    vi.stubGlobal("setTimeout", (cb: () => void) => {
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    const promptInputRef = {
      current: null,
    } as RefObject<PromptInputHandle | null>;

    renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-active",
        allWorkspaces: [
          makeWorkspace("ws-active"),
          makeWorkspace("ws-remote", { backend: "remote" }),
        ],
        healthStatus: "healthy",
        promptInputRef,
      }),
    );

    expect(storeMocks.fetchCachedSessions).toHaveBeenCalledWith("ws-remote");
    expect(storeMocks.fetchPinnedSessions).toHaveBeenCalledWith("ws-remote");
  });

  it("commits a pending deletion after the hook unmounts", async () => {
    vi.useFakeTimers();
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(useHasCoarsePointer).mockReturnValue(false);
    storeMocks.removeSessionLocal.mockReturnValue({ sessionId: "session-1" });
    storeMocks.deleteSession.mockResolvedValue({ isDeleted: true });
    const promptInputRef = {
      current: null,
    } as RefObject<PromptInputHandle | null>;
    const { result, unmount } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [],
        healthStatus: "healthy",
        promptInputRef,
      }),
    );

    result.current.handleDeleteSession("session-1");
    unmount();
    await vi.runAllTimersAsync();

    expect(storeMocks.deleteSession).toHaveBeenCalledWith("session-1", "ws-1");
  });

  it("restores an optimistic deletion when the upstream delete fails", async () => {
    vi.useFakeTimers();
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(useHasCoarsePointer).mockReturnValue(false);
    const snapshot = { sessionId: "session-1" };
    storeMocks.removeSessionLocal.mockReturnValue(snapshot);
    storeMocks.deleteSession.mockResolvedValue({
      isDeleted: false,
      failureMessage: "Failed to delete chat",
    });
    const promptInputRef = {
      current: null,
    } as RefObject<PromptInputHandle | null>;
    const { result } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [],
        healthStatus: "healthy",
        promptInputRef,
      }),
    );

    result.current.handleDeleteSession("session-1");
    await vi.runAllTimersAsync();

    expect(storeMocks.restoreSessionLocal).toHaveBeenCalledWith(snapshot);
  });

  it("keeps same-id deletions independent across workspaces", async () => {
    vi.useFakeTimers();
    vi.mocked(useIsMobile).mockReturnValue(false);
    vi.mocked(useHasCoarsePointer).mockReturnValue(false);
    storeMocks.removeSessionLocal.mockImplementation(
      (sessionId: string, workspaceId: string) => ({ sessionId, workspaceId }),
    );
    storeMocks.deleteSession.mockResolvedValue({ isDeleted: true });
    const promptInputRef = {
      current: null,
    } as RefObject<PromptInputHandle | null>;
    const { result } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [],
        healthStatus: "healthy",
        promptInputRef,
      }),
    );

    result.current.handleDeleteSession("shared-session", "ws-1");
    result.current.handleDeleteSession("shared-session", "ws-2");
    await vi.runAllTimersAsync();

    expect(storeMocks.deleteSession).toHaveBeenCalledTimes(2);
    expect(storeMocks.deleteSession).toHaveBeenCalledWith(
      "shared-session",
      "ws-1",
    );
    expect(storeMocks.deleteSession).toHaveBeenCalledWith(
      "shared-session",
      "ws-2",
    );
  });
});
