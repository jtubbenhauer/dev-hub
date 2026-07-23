import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useChatUrlState,
  type UseChatUrlStateOptions,
} from "@/components/chat/use-chat-url-state";

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearch = "";

const mockChatState = {
  activeWorkspaceId: "ws-1" as string | null,
  activeSessionId: "session-1" as string | null,
  workspaceStates: {
    "ws-1": { sessions: { "session-1": {} } },
    "ws-2": { sessions: { "session-2": {} } },
  } as Record<string, { sessions: Record<string, object> }>,
  setActiveWorkspaceId: vi.fn(),
  setActiveSession: vi.fn(),
};
const mockWorkspaceState = {
  activeWorkspaceId: "ws-1" as string | null,
  setActiveWorkspaceId: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: { getState: () => mockChatState },
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: { getState: () => mockWorkspaceState },
}));

function createOptions(): UseChatUrlStateOptions {
  return {
    activeWorkspaceId: "ws-1",
    activeSessionId: "session-1",
    workspaceIds: new Set(["ws-1", "ws-2"]),
    isUnifiedMode: false,
    groupByWorkspace: false,
    sessionAgeFilter: "all" as const,
    onToggleUnifiedMode: vi.fn(),
    onToggleGroupByWorkspace: vi.fn(),
    onSetSessionAgeFilter: vi.fn(),
  };
}

describe("useChatUrlState", () => {
  beforeEach(() => {
    mockSearch = "";
    mockPush.mockClear();
    mockReplace.mockClear();
    mockChatState.activeWorkspaceId = "ws-1";
    mockChatState.activeSessionId = "session-1";
    mockChatState.workspaceStates = {
      "ws-1": { sessions: { "session-1": {} } },
      "ws-2": { sessions: { "session-2": {} } },
    };
    mockChatState.setActiveWorkspaceId.mockClear();
    mockChatState.setActiveSession.mockClear();
    mockWorkspaceState.activeWorkspaceId = "ws-1";
    mockWorkspaceState.setActiveWorkspaceId.mockClear();
  });

  it("replaces a bare chat URL with the current session and list state", () => {
    renderHook(() => useChatUrlState(createOptions()));

    expect(mockReplace).toHaveBeenCalledWith(
      "/chat?workspaceId=ws-1&sessionId=session-1&view=workspace&group=0&age=all",
    );
  });

  it("does not canonicalize a session before its workspace is available", () => {
    renderHook(() =>
      useChatUrlState({
        ...createOptions(),
        activeWorkspaceId: null,
        workspaceIds: new Set(),
      }),
    );

    expect(mockReplace).toHaveBeenCalledWith(
      "/chat?view=workspace&group=0&age=all",
    );
  });

  it("applies session and list state when browser history changes", () => {
    let options = createOptions();
    mockSearch =
      "workspaceId=ws-2&sessionId=session-2&view=unified&group=1&age=1w";
    const { rerender } = renderHook(() => useChatUrlState(options));

    expect(mockWorkspaceState.setActiveWorkspaceId).toHaveBeenCalledWith(
      "ws-2",
    );
    expect(mockChatState.setActiveWorkspaceId).toHaveBeenCalledWith("ws-2");
    expect(mockChatState.setActiveSession).toHaveBeenCalledWith("session-2");
    expect(options.onToggleUnifiedMode).toHaveBeenCalledOnce();
    expect(options.onToggleGroupByWorkspace).toHaveBeenCalledOnce();
    expect(options.onSetSessionAgeFilter).toHaveBeenCalledWith("1w");

    mockChatState.activeWorkspaceId = "ws-2";
    mockChatState.activeSessionId = "session-2";
    mockWorkspaceState.activeWorkspaceId = "ws-2";
    options = {
      ...options,
      isUnifiedMode: true,
      groupByWorkspace: true,
      sessionAgeFilter: "1w",
    };
    mockSearch =
      "workspaceId=ws-1&sessionId=session-1&view=workspace&group=0&age=all";
    rerender();

    expect(mockWorkspaceState.setActiveWorkspaceId).toHaveBeenLastCalledWith(
      "ws-1",
    );
    expect(mockChatState.setActiveSession).toHaveBeenLastCalledWith(
      "session-1",
    );
    expect(options.onSetSessionAgeFilter).toHaveBeenLastCalledWith("all");
  });

  it("pushes a complete next state while preserving unchanged settings", () => {
    const options = createOptions();
    const { result } = renderHook(() => useChatUrlState(options));

    act(() => {
      result.current.pushChatState({
        workspaceId: "ws-2",
        sessionId: "session-2",
      });
    });

    expect(mockPush).toHaveBeenCalledWith(
      "/chat?workspaceId=ws-2&sessionId=session-2&view=workspace&group=0&age=all",
    );
  });

  it("canonicalizes partial session links with the current list settings", () => {
    mockSearch = "workspaceId=ws-2&sessionId=session-2";

    renderHook(() => useChatUrlState(createOptions()));

    expect(mockReplace).toHaveBeenCalledWith(
      "/chat?workspaceId=ws-2&sessionId=session-2&view=workspace&group=0&age=all",
    );
  });

  it("adds a delayed active workspace to a canonical session URL", () => {
    let options: UseChatUrlStateOptions = {
      ...createOptions(),
      activeWorkspaceId: null,
      workspaceIds: new Set(),
    };
    mockSearch = "sessionId=session-1&view=workspace&group=0&age=all";
    const { rerender } = renderHook(() => useChatUrlState(options));

    expect(mockReplace).not.toHaveBeenCalled();

    options = {
      ...options,
      activeWorkspaceId: "ws-1",
      workspaceIds: new Set(["ws-1"]),
    };
    rerender();

    expect(mockReplace).toHaveBeenCalledWith(
      "/chat?workspaceId=ws-1&sessionId=session-1&view=workspace&group=0&age=all",
    );
  });

  it("waits for workspaces before applying a deep-linked session", () => {
    let options: UseChatUrlStateOptions = {
      ...createOptions(),
      workspaceIds: new Set(),
    };
    mockSearch = "workspaceId=ws-2&sessionId=session-2";
    const { rerender } = renderHook(() => useChatUrlState(options));

    expect(mockChatState.setActiveSession).not.toHaveBeenCalled();

    options = { ...options, workspaceIds: new Set(["ws-1", "ws-2"]) };
    rerender();

    expect(mockChatState.setActiveSession).toHaveBeenCalledWith("session-2");
  });

  it("pushes a session created outside the URL navigation handlers", () => {
    let options = createOptions();
    mockSearch =
      "workspaceId=ws-1&sessionId=session-1&view=workspace&group=0&age=all";
    const { rerender } = renderHook(() => useChatUrlState(options));

    mockChatState.activeSessionId = "session-new";
    mockChatState.workspaceStates["ws-1"].sessions["session-new"] = {};
    options = { ...options, activeSessionId: "session-new" };
    rerender();

    expect(mockPush).toHaveBeenCalledWith(
      "/chat?workspaceId=ws-1&sessionId=session-new&view=workspace&group=0&age=all",
    );
  });

  it("does not overwrite browser history while applying a previous session", () => {
    let options = createOptions();
    mockSearch =
      "workspaceId=ws-1&sessionId=session-1&view=workspace&group=0&age=all";
    const { rerender } = renderHook(() => useChatUrlState(options));

    mockPush.mockClear();
    mockChatState.activeSessionId = "session-2";
    options = { ...options, activeSessionId: "session-2" };
    mockSearch =
      "workspaceId=ws-1&sessionId=session-previous&view=workspace&group=0&age=all";
    rerender();

    expect(mockPush).not.toHaveBeenCalled();

    mockChatState.activeSessionId = "session-previous";
    options = { ...options, activeSessionId: "session-previous" };
    rerender();

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("replaces a session URL after delayed automatic session selection", () => {
    let options: UseChatUrlStateOptions = {
      ...createOptions(),
      activeSessionId: null,
    };
    mockChatState.activeSessionId = null;
    mockSearch = "workspaceId=ws-1&view=workspace&group=0&age=all";
    const { rerender } = renderHook(() => useChatUrlState(options));

    mockReplace.mockClear();
    mockChatState.activeSessionId = "session-auto";
    mockChatState.workspaceStates["ws-1"].sessions["session-auto"] = {};
    options = { ...options, activeSessionId: "session-auto" };
    rerender();

    expect(mockReplace).toHaveBeenCalledWith(
      "/chat?workspaceId=ws-1&sessionId=session-auto&view=workspace&group=0&age=all",
    );
  });
});
