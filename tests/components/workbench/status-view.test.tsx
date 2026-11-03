import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { _resetModuleCaches, useChatStore } from "@/stores/chat-store";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";
import {
  FOCUSED_CHAT_TAB,
  FOCUSED_SESSION_ID,
  GLOBAL_SESSION_ID,
  STATUS_WORKSPACE,
  TWO_CHATS,
  focusChatTab,
  pendingTodo,
  renderStatusView,
  seedChat,
  toolCallMessage,
} from "./status-view-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// The panel has its own tests; here it only marks where it renders.
vi.mock("@/components/chat/workspace-context-panel", () => ({
  WorkspaceContextPanel: ({
    workspaceId,
    workspace,
  }: {
    readonly workspaceId: string;
    readonly workspace: Workspace;
  }) => (
    <div data-testid="workspace-context-panel">{`${workspaceId}:${workspace.name}`}</div>
  ),
}));

const WORKSPACE_ID = STATUS_WORKSPACE.id;

const initialChatState = useChatStore.getState();
const initialWorkspaceState = useWorkspaceStore.getState();

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useContextSidebarStore.setState(
    useContextSidebarStore.getInitialState(),
    true,
  );
  useWorkspaceStore.setState({ activeWorkspaceId: WORKSPACE_ID });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useChatStore.setState(initialChatState, true);
  useWorkspaceStore.setState(initialWorkspaceState, true);
  _resetModuleCaches();
});

describe("StatusView", () => {
  it("shows the workspace context of its workspace", () => {
    // Given
    seedChat(TWO_CHATS);

    // When
    renderStatusView();

    // Then
    expect(screen.getByTestId("workspace-context-panel")).toHaveTextContent(
      `${WORKSPACE_ID}:${STATUS_WORKSPACE.name}`,
    );
  });

  it("shows the task progress of the last focused chat's session", () => {
    // Given
    seedChat({
      ...TWO_CHATS,
      todos: { [FOCUSED_SESSION_ID]: [pendingTodo("Port the status view")] },
    });
    focusChatTab(FOCUSED_CHAT_TAB, FOCUSED_SESSION_ID);

    // When
    renderStatusView();

    // Then
    expect(screen.getByText("Task Progress")).toBeInTheDocument();
    expect(screen.getByText("Port the status view")).toBeInTheDocument();
  });

  it("hides the task progress when only another session has todos", () => {
    // Given
    seedChat({
      ...TWO_CHATS,
      todos: { [GLOBAL_SESSION_ID]: [pendingTodo("Global chat task")] },
    });
    focusChatTab(FOCUSED_CHAT_TAB, FOCUSED_SESSION_ID);

    // When
    renderStatusView();

    // Then
    expect(screen.queryByText("Task Progress")).not.toBeInTheDocument();
    expect(screen.queryByText("Global chat task")).not.toBeInTheDocument();
  });

  it("lists the MCP servers", () => {
    // Given
    seedChat(TWO_CHATS);

    // When
    renderStatusView();

    // Then
    expect(screen.getByText("MCP Servers")).toBeInTheDocument();
    expect(screen.getByText("codegraph")).toBeInTheDocument();
    expect(screen.getByText("1/1 active")).toBeInTheDocument();
  });

  it("lists the files the last focused chat's session read", async () => {
    // Given
    seedChat({
      sessions: TWO_CHATS.sessions,
      messages: {
        [FOCUSED_SESSION_ID]: [
          toolCallMessage({
            sessionId: FOCUSED_SESSION_ID,
            tool: "read",
            relativePath: "README.md",
          }),
        ],
        [GLOBAL_SESSION_ID]: [
          toolCallMessage({
            sessionId: GLOBAL_SESSION_ID,
            tool: "read",
            relativePath: "GLOBAL.md",
          }),
        ],
      },
    });
    focusChatTab(FOCUSED_CHAT_TAB, FOCUSED_SESSION_ID);
    renderStatusView();

    // When
    await userEvent.click(screen.getByRole("button", { name: "Read (1)" }));

    // Then
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.queryByText("GLOBAL.md")).not.toBeInTheDocument();
  });

  it("includes the files of the focused session's sub-agents, not the global session's", () => {
    // Given
    seedChat({
      sessions: [
        { id: FOCUSED_SESSION_ID },
        { id: "ses_focused_child", parentID: FOCUSED_SESSION_ID },
        { id: GLOBAL_SESSION_ID },
        { id: "ses_global_child", parentID: GLOBAL_SESSION_ID },
      ],
      messages: {
        ses_focused_child: [
          toolCallMessage({
            sessionId: "ses_focused_child",
            tool: "edit",
            relativePath: "src/sub-agent.ts",
          }),
        ],
        ses_global_child: [
          toolCallMessage({
            sessionId: "ses_global_child",
            tool: "edit",
            relativePath: "src/global-sub-agent.ts",
          }),
        ],
      },
    });
    // Both children count as fully loaded, so nothing is fetched.
    useChatStore.setState({
      hasMoreBeforeBySession: {
        [`${WORKSPACE_ID}:ses_focused_child`]: false,
        [`${WORKSPACE_ID}:ses_global_child`]: false,
      },
    });
    focusChatTab(FOCUSED_CHAT_TAB, FOCUSED_SESSION_ID);

    // When
    renderStatusView();

    // Then
    expect(screen.getByText("src/sub-agent.ts")).toBeInTheDocument();
    expect(
      screen.queryByText("src/global-sub-agent.ts"),
    ).not.toBeInTheDocument();
  });

  it("says no chat is focused yet when the workspace has no focused chat", () => {
    // Given
    seedChat(TWO_CHATS);

    // When
    renderStatusView();

    // Then
    expect(screen.getByText("No chat focused yet")).toBeInTheDocument();
    expect(screen.queryByText("src/global.ts")).not.toBeInTheDocument();
  });

  it("treats a focused new chat as a chat without files", () => {
    // Given
    seedChat(TWO_CHATS);
    focusChatTab(FOCUSED_CHAT_TAB, null);

    // When
    renderStatusView();

    // Then
    expect(screen.queryByText("No chat focused yet")).not.toBeInTheDocument();
    expect(screen.queryByText("src/global.ts")).not.toBeInTheDocument();
  });

  it("shows no files for a focused chat whose session was deleted", () => {
    // Given
    seedChat({ ...TWO_CHATS, sessions: [{ id: GLOBAL_SESSION_ID }] });
    focusChatTab(FOCUSED_CHAT_TAB, FOCUSED_SESSION_ID);

    // When
    renderStatusView();

    // Then
    expect(screen.queryByText("src/focused.ts")).not.toBeInTheDocument();
  });

  it("follows the focus to another chat tab", () => {
    // Given
    seedChat({
      sessions: [...TWO_CHATS.sessions, { id: "ses_other" }],
      messages: {
        ...TWO_CHATS.messages,
        ses_other: [
          toolCallMessage({
            sessionId: "ses_other",
            tool: "edit",
            relativePath: "src/other-tab.ts",
          }),
        ],
      },
    });
    focusChatTab(FOCUSED_CHAT_TAB, FOCUSED_SESSION_ID);
    renderStatusView();

    // When
    act(() => focusChatTab("tab-chat-other", "ses_other"));

    // Then
    expect(screen.getByText("src/other-tab.ts")).toBeInTheDocument();
    expect(screen.queryByText("src/focused.ts")).not.toBeInTheDocument();
  });

  it("keeps the last focused chat's files while a terminal tab is focused", () => {
    // Given
    seedChat(TWO_CHATS);
    focusChatTab(FOCUSED_CHAT_TAB, FOCUSED_SESSION_ID);
    renderStatusView();

    // When
    act(() =>
      useWorkbenchStore.getState().setFocusedPanel({
        workspaceId: WORKSPACE_ID,
        panelId: "tab-terminal",
        params: {
          kind: "terminal",
          workspaceId: WORKSPACE_ID,
          sessionId: "wb-term-0000abcd",
          title: "Terminal 1",
        },
      }),
    );

    // Then
    expect(screen.getByText("src/focused.ts")).toBeInTheDocument();
  });

  it("says no chat is focused yet once the focused chat tab is closed", () => {
    // Given
    seedChat(TWO_CHATS);
    focusChatTab(FOCUSED_CHAT_TAB, FOCUSED_SESSION_ID);
    renderStatusView();

    // When
    act(() =>
      useWorkbenchStore.getState().forgetPanel(WORKSPACE_ID, FOCUSED_CHAT_TAB),
    );

    // Then
    expect(screen.getByText("No chat focused yet")).toBeInTheDocument();
  });

  it("closes the mobile panels sheet before opening a session file", async () => {
    // Given
    seedChat(TWO_CHATS);
    focusChatTab(FOCUSED_CHAT_TAB, FOCUSED_SESSION_ID);
    useContextSidebarStore.getState().setMobileSheetOpen(true);
    renderStatusView();

    // When
    await userEvent.click(screen.getByText("src/focused.ts"));

    // Then
    expect(useContextSidebarStore.getState().isMobileSheetOpen).toBe(false);
  });
});
