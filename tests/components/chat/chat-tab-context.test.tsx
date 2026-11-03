import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ChatTabProvider,
  useChatTab,
  useChatViewSessionId,
  useChatViewWorkspaceId,
  useIsChatEventTarget,
  useIsChatKeyboardOwner,
  type ChatTabContextValue,
} from "@/components/chat/chat-tab-context";
import { useChatStore } from "@/stores/chat-store";

const initialChatState = useChatStore.getState();

const backgroundTab: ChatTabContextValue = {
  tabId: "tab-b",
  workspaceId: "ws-tab",
  sessionId: "ses_tab",
  isFocused: false,
  isLastFocusedChat: false,
  isVisible: true,
};

function wrapperFor(value: ChatTabContextValue) {
  return function ChatTabWrapper({ children }: { children: ReactNode }) {
    return <ChatTabProvider value={value}>{children}</ChatTabProvider>;
  };
}

beforeEach(() => {
  useChatStore.setState({
    activeWorkspaceId: "ws-global",
    activeSessionId: "ses_global",
  });
});

afterEach(() => {
  useChatStore.setState(initialChatState, true);
});

describe("chat tab context outside a provider", () => {
  it("has no tab", () => {
    const { result } = renderHook(() => useChatTab());

    expect(result.current).toBeNull();
  });

  it("views the global active session", () => {
    const { result } = renderHook(() => useChatViewSessionId());

    expect(result.current).toBe("ses_global");
  });

  it("follows the global active session when it changes", () => {
    const { result } = renderHook(() => useChatViewSessionId());

    act(() => {
      useChatStore.setState({ activeSessionId: "ses_next" });
    });

    expect(result.current).toBe("ses_next");
  });

  it("views the global active workspace", () => {
    const { result } = renderHook(() => useChatViewWorkspaceId());

    expect(result.current).toBe("ws-global");
  });

  it("treats the only chat as the event target and keyboard owner", () => {
    const { result } = renderHook(() => ({
      isEventTarget: useIsChatEventTarget(),
      isKeyboardOwner: useIsChatKeyboardOwner(),
    }));

    expect(result.current).toEqual({
      isEventTarget: true,
      isKeyboardOwner: true,
    });
  });
});

describe("chat tab context inside a provider", () => {
  it("exposes the tab value", () => {
    const { result } = renderHook(() => useChatTab(), {
      wrapper: wrapperFor(backgroundTab),
    });

    expect(result.current).toEqual(backgroundTab);
  });

  it("views the tab's session instead of the global one", () => {
    const { result } = renderHook(() => useChatViewSessionId(), {
      wrapper: wrapperFor(backgroundTab),
    });

    expect(result.current).toBe("ses_tab");
  });

  it("keeps a new-chat tab on no session while another chat is active", () => {
    const { result } = renderHook(() => useChatViewSessionId(), {
      wrapper: wrapperFor({ ...backgroundTab, sessionId: null }),
    });

    expect(result.current).toBeNull();
  });

  it("views the tab's workspace instead of the global one", () => {
    const { result } = renderHook(() => useChatViewWorkspaceId(), {
      wrapper: wrapperFor(backgroundTab),
    });

    expect(result.current).toBe("ws-tab");
  });

  it("is not the event target unless it is the last focused chat", () => {
    const { result } = renderHook(() => useIsChatEventTarget(), {
      wrapper: wrapperFor(backgroundTab),
    });

    expect(result.current).toBe(false);
  });

  it("is the event target when it is the last focused chat", () => {
    const { result } = renderHook(() => useIsChatEventTarget(), {
      wrapper: wrapperFor({ ...backgroundTab, isLastFocusedChat: true }),
    });

    expect(result.current).toBe(true);
  });

  it("does not own the keyboard unless it is focused", () => {
    const { result } = renderHook(() => useIsChatKeyboardOwner(), {
      wrapper: wrapperFor(backgroundTab),
    });

    expect(result.current).toBe(false);
  });

  it("owns the keyboard when it is focused", () => {
    const { result } = renderHook(() => useIsChatKeyboardOwner(), {
      wrapper: wrapperFor({ ...backgroundTab, isFocused: true }),
    });

    expect(result.current).toBe(true);
  });
});
