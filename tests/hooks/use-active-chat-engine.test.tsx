import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useActiveChatEngine,
  useNewChatEngine,
} from "@/hooks/use-active-chat-engine";
import { useChatStore } from "@/stores/chat-store";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";

const useWorkspaceEngineMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: useWorkspaceEngineMock,
}));

const initialChatState = useChatStore.getState();

beforeEach(() => {
  useWorkspaceEngineMock.mockReturnValue({
    engine: "opencode",
    isLoading: false,
  });
  useNewChatEngineStore.setState({ engineByWorkspace: {} });
});

afterEach(() => {
  useChatStore.setState(initialChatState, true);
});

describe("useNewChatEngine", () => {
  it("falls back to the workspace default, including while it loads", () => {
    useWorkspaceEngineMock.mockReturnValue({ engine: "omo", isLoading: true });

    const { result } = renderHook(() => useNewChatEngine("ws-1"));

    expect(result.current).toEqual({ engine: "omo", isLoading: true });
    expect(useWorkspaceEngineMock).toHaveBeenCalledWith("ws-1");
  });

  it("prefers the engine picked for the workspace's next chat", () => {
    useWorkspaceEngineMock.mockReturnValue({
      engine: "opencode",
      isLoading: true,
    });
    const { result } = renderHook(() => useNewChatEngine("ws-1"));

    act(() => {
      useNewChatEngineStore.getState().setNewChatEngine("ws-1", "omo");
    });

    expect(result.current).toEqual({ engine: "omo", isLoading: false });
  });

  it("ignores a pick made for another workspace", () => {
    useNewChatEngineStore.getState().setNewChatEngine("ws-1", "omo");

    const { result } = renderHook(() => useNewChatEngine("ws-2"));

    expect(result.current).toEqual({ engine: "opencode", isLoading: false });
  });
});

describe("useActiveChatEngine", () => {
  it("uses the open omo chat's engine in an OpenCode workspace", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-1",
      activeSessionId: "omo_1",
    });

    const { result } = renderHook(() => useActiveChatEngine("ws-1"));

    expect(result.current).toEqual({ engine: "omo", isLoading: false });
  });

  it("uses the open OpenCode chat's engine even when omo is picked for the next chat", () => {
    useWorkspaceEngineMock.mockReturnValue({ engine: "omo", isLoading: true });
    useNewChatEngineStore.getState().setNewChatEngine("ws-1", "omo");
    useChatStore.setState({
      activeWorkspaceId: "ws-1",
      activeSessionId: "ses_1",
    });

    const { result } = renderHook(() => useActiveChatEngine("ws-1"));

    expect(result.current).toEqual({ engine: "opencode", isLoading: false });
  });

  it("ignores a chat open in another workspace", () => {
    useNewChatEngineStore.getState().setNewChatEngine("ws-1", "omo");
    useChatStore.setState({
      activeWorkspaceId: "ws-2",
      activeSessionId: "ses_1",
    });

    const { result } = renderHook(() => useActiveChatEngine("ws-1"));

    expect(result.current).toEqual({ engine: "omo", isLoading: false });
  });

  it("switches engines when another chat opens", () => {
    useChatStore.setState({
      activeWorkspaceId: "ws-1",
      activeSessionId: "ses_1",
    });
    const { result } = renderHook(() => useActiveChatEngine("ws-1"));
    expect(result.current.engine).toBe("opencode");

    act(() => {
      useChatStore.setState({ activeSessionId: "omo_1" });
    });

    expect(result.current.engine).toBe("omo");
  });
});
