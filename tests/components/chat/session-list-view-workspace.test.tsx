import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatTabProvider,
  type ChatTabContextValue,
} from "@/components/chat/chat-tab-context";
import { SessionList } from "@/components/chat/session-list";
import type { ChatEngine } from "@/lib/engine/types";
import { useChatStore } from "@/stores/chat-store";

HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
HTMLElement.prototype.releasePointerCapture = vi.fn();

class MockPointerEvent extends Event {
  button: number;
  ctrlKey: boolean;
  pointerType: string;

  constructor(type: string, props: PointerEventInit) {
    super(type, props);
    this.button = props.button || 0;
    this.ctrlKey = props.ctrlKey || false;
    this.pointerType = props.pointerType || "mouse";
  }
}
window.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;

const useWorkspaceEngineMock = vi.hoisted(() =>
  vi.fn((_workspaceId: string | null) => ({
    engine: "opencode" as ChatEngine,
    isLoading: false,
  })),
);
vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: useWorkspaceEngineMock,
}));

const initialChatState = useChatStore.getState();

const tabInOtherWorkspace: ChatTabContextValue = {
  tabId: "tab-1",
  workspaceId: "ws-tab",
  sessionId: null,
  isFocused: false,
  isLastFocusedChat: false,
  isVisible: true,
};

function renderEmptySessionList() {
  return (
    <SessionList
      mode="workspace"
      sessions={{}}
      activeSessionId={null}
      sessionStatuses={{}}
      lastViewedAt={{}}
      onCreateSession={vi.fn()}
      onDeleteSession={vi.fn()}
      onSelectSession={vi.fn()}
    />
  );
}

beforeEach(() => {
  useChatStore.setState({ activeWorkspaceId: "ws-focused" });
});

afterEach(() => {
  useChatStore.setState(initialChatState, true);
});

describe("SessionList new chat menu", () => {
  it("offers the default engine of the global chat's workspace outside a tab", async () => {
    const user = userEvent.setup();
    render(renderEmptySessionList());

    await user.click(screen.getAllByRole("button", { name: /New chat/ })[0]);
    await screen.findByRole("menu");

    expect(useWorkspaceEngineMock).toHaveBeenLastCalledWith("ws-focused");
  });

  it("offers the default engine of the tab's workspace inside a tab", async () => {
    const user = userEvent.setup();
    render(
      <ChatTabProvider value={tabInOtherWorkspace}>
        {renderEmptySessionList()}
      </ChatTabProvider>,
    );

    await user.click(screen.getAllByRole("button", { name: /New chat/ })[0]);
    await screen.findByRole("menu");

    expect(useWorkspaceEngineMock).toHaveBeenLastCalledWith("ws-tab");
  });
});
