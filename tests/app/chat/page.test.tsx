import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatInterfaceProps } from "@/components/chat/chat-interface";
import { useChatStore } from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const chatInterfaceProps = vi.hoisted(() => ({
  latest: null as ChatInterfaceProps | null,
}));

vi.mock("@/components/layout/authenticated-layout", () => ({
  AuthenticatedLayout: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/components/chat/chat-interface", () => ({
  ChatInterface: (props: ChatInterfaceProps) => {
    chatInterfaceProps.latest = props;
    return <div data-testid="chat-interface" />;
  },
}));
vi.mock("@/components/chat/workspace-chat-effects-host", () => ({
  WorkspaceChatEffectsHost: () => <div data-testid="workspace-chat-effects" />,
}));
vi.mock("@/components/chat/chat-file-dialog", () => ({
  ChatFileDialog: () => <div data-testid="chat-file-dialog" />,
}));

import ChatPage from "@/app/chat/page";

const initialChatState = useChatStore.getState();
const initialWorkspaceState = useWorkspaceStore.getState();

afterEach(() => {
  chatInterfaceProps.latest = null;
  useChatStore.setState(initialChatState, true);
  useWorkspaceStore.setState(initialWorkspaceState, true);
});

describe("legacy chat page", () => {
  it("runs the workspace chat effects next to the chat and its file dialog", () => {
    render(<ChatPage />);

    expect(screen.getByTestId("workspace-chat-effects")).toBeInTheDocument();
    expect(screen.getByTestId("chat-interface")).toBeInTheDocument();
    expect(screen.getByTestId("chat-file-dialog")).toBeInTheDocument();
  });

  it("shows the active workspace's active session in legacy page mode", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-1" });
    useChatStore.setState({ activeSessionId: "ses_1" });

    render(<ChatPage />);

    expect(chatInterfaceProps.latest).toEqual({
      tabId: "legacy-chat-page",
      workspaceId: "ws-1",
      sessionId: "ses_1",
      isFocused: true,
      isLastFocusedChat: true,
      isVisible: true,
      legacyPageMode: true,
    });
  });

  it("follows the global active session when it changes", () => {
    useWorkspaceStore.setState({ activeWorkspaceId: "ws-1" });
    useChatStore.setState({ activeSessionId: "ses_1" });
    render(<ChatPage />);

    act(() => {
      useChatStore.setState({ activeSessionId: "ses_2" });
    });

    expect(chatInterfaceProps.latest?.sessionId).toBe("ses_2");
  });
});
