import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatTabProvider,
  type ChatTabContextValue,
} from "@/components/chat/chat-tab-context";
import { EmptyChat } from "@/components/chat/empty-chat";
import { useChatStore } from "@/stores/chat-store";

vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: () => ({ engine: "opencode", isLoading: false }),
}));

const initialChatState = useChatStore.getState();

function chatTab(sessionId: string | null): ChatTabContextValue {
  return {
    tabId: "tab-1",
    workspaceId: "ws-1",
    sessionId,
    isFocused: false,
    isLastFocusedChat: false,
    isVisible: true,
  };
}

beforeEach(() => {
  useChatStore.setState({
    activeWorkspaceId: "ws-1",
    activeSessionId: "ses_focused",
  });
});

afterEach(() => {
  useChatStore.setState(initialChatState, true);
});

describe("EmptyChat", () => {
  it("hides the engine toggle while the global chat has a session", () => {
    render(<EmptyChat onSend={vi.fn()} />);

    expect(
      screen.queryByRole("group", { name: "Chat engine" }),
    ).not.toBeInTheDocument();
  });

  it("offers the engine toggle in a new-chat tab while another chat is focused", () => {
    render(
      <ChatTabProvider value={chatTab(null)}>
        <EmptyChat onSend={vi.fn()} />
      </ChatTabProvider>,
    );

    expect(
      screen.getByRole("group", { name: "Chat engine" }),
    ).toBeInTheDocument();
  });

  it("hides the engine toggle in a tab that already shows a session", () => {
    render(
      <ChatTabProvider value={chatTab("ses_tab")}>
        <EmptyChat onSend={vi.fn()} />
      </ChatTabProvider>,
    );

    expect(
      screen.queryByRole("group", { name: "Chat engine" }),
    ).not.toBeInTheDocument();
  });
});
