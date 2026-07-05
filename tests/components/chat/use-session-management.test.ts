import { renderHook } from "@testing-library/react";
import { useSessionManagement } from "@/components/chat/use-session-management";
import { useIsMobile, useHasCoarsePointer } from "@/hooks/use-mobile";
import type { PromptInputHandle } from "@/components/chat/prompt-input";
import type { RefObject } from "react";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(),
  useHasCoarsePointer: vi.fn(),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: {
    getState: vi.fn(() => ({
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
    })),
  },
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => ({
      setActiveWorkspaceId: vi.fn(),
    })),
  },
}));

describe("useSessionManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
});
