import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSessionManagement } from "@/components/chat/use-session-management";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";
import type { Workspace } from "@/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const storeMocks = vi.hoisted(() => ({
  setActiveSession: vi.fn(),
  setActiveWorkspaceId: vi.fn(),
  setActiveWorkspaceSession: vi.fn(),
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

const workspaceStoreMocks = vi.hoisted(() => ({
  setActiveWorkspaceId: vi.fn(),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => workspaceStoreMocks),
  },
}));

describe("useSessionManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNewChatEngineStore.setState({ engineByWorkspace: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("hydrates pins for non-active workspaces in unified mode", () => {
    localStorage.setItem("dev-hub:chat-unified-mode", "true");
    // Run the staggered non-active fetches synchronously instead of after 150ms.
    vi.stubGlobal("setTimeout", (cb: () => void) => {
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-active",
        allWorkspaces: [
          makeWorkspace("ws-active"),
          makeWorkspace("ws-remote", { backend: "remote" }),
        ],
        healthStatus: "healthy",
      }),
    );

    expect(storeMocks.fetchCachedSessions).toHaveBeenCalledWith("ws-remote");
    expect(storeMocks.fetchPinnedSessions).toHaveBeenCalledWith("ws-remote");
  });

  it("commits a pending deletion after the hook unmounts", async () => {
    vi.useFakeTimers();
    storeMocks.removeSessionLocal.mockReturnValue({ sessionId: "session-1" });
    storeMocks.deleteSession.mockResolvedValue({ isDeleted: true });
    const { result, unmount } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [],
        healthStatus: "healthy",
      }),
    );

    result.current.handleDeleteSession("session-1");
    unmount();
    await vi.runAllTimersAsync();

    expect(storeMocks.deleteSession).toHaveBeenCalledWith("session-1", "ws-1");
  });

  it("restores an optimistic deletion when the upstream delete fails", async () => {
    vi.useFakeTimers();
    const snapshot = { sessionId: "session-1" };
    storeMocks.removeSessionLocal.mockReturnValue(snapshot);
    storeMocks.deleteSession.mockResolvedValue({
      isDeleted: false,
      failureMessage: "Failed to delete chat",
    });
    const { result } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [],
        healthStatus: "healthy",
      }),
    );

    result.current.handleDeleteSession("session-1");
    await vi.runAllTimersAsync();

    expect(storeMocks.restoreSessionLocal).toHaveBeenCalledWith(snapshot);
  });

  it("keeps same-id deletions independent across workspaces", async () => {
    vi.useFakeTimers();
    storeMocks.removeSessionLocal.mockImplementation(
      (sessionId: string, workspaceId: string) => ({ sessionId, workspaceId }),
    );
    storeMocks.deleteSession.mockResolvedValue({ isDeleted: true });
    const { result } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [],
        healthStatus: "healthy",
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

  it("still exposes the create handlers through composition", () => {
    storeMocks.createSession.mockResolvedValue({ id: "ses_1" });
    const { result } = renderHook(() =>
      useSessionManagement({
        activeWorkspaceId: "ws-1",
        allWorkspaces: [makeWorkspace("ws-1")],
        healthStatus: "healthy",
      }),
    );

    result.current.handleCreateSession("opencode");

    expect(storeMocks.createSession).toHaveBeenCalledWith("ws-1", "opencode");
  });
});
