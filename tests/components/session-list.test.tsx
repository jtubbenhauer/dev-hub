import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionList } from "@/components/chat/session-list";
import type { ChatEngine } from "@/lib/engine/types";
import { useChatStore, type SessionWithWorkspace } from "@/stores/chat-store";

HTMLElement.prototype.scrollIntoView = vi.fn();
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

const workspaceDefaults = vi.hoisted(() => ({
  engineByWorkspaceId: {} as Record<string, ChatEngine>,
}));
vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: (workspaceId: string | null) => ({
    engine:
      (workspaceId === null
        ? undefined
        : workspaceDefaults.engineByWorkspaceId[workspaceId]) ?? "opencode",
    isLoading: false,
  }),
}));

const initialChatState = useChatStore.getInitialState();

beforeEach(() => {
  workspaceDefaults.engineByWorkspaceId = {};
  useChatStore.setState(initialChatState, true);
});

function getSessionRow(sessionId: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `[data-session-id="${sessionId}"]`,
  );
  if (!row) throw new Error(`No session row rendered for ${sessionId}`);
  return row;
}

function makeUnifiedSession(
  id: string,
  workspaceId: string,
  opts: { title?: string; updated?: number } = {},
): SessionWithWorkspace {
  return {
    id,
    workspaceId,
    projectID: "proj-1",
    directory: "/workspace",
    title: opts.title ?? `Session ${id}`,
    version: "1",
    time: { created: 1000, updated: opts.updated ?? 1000 },
  };
}

const baseProps = {
  activeSessionId: null,
  sessionStatuses: {},
  lastViewedAt: {},
  onCreateSession: vi.fn(),
  onDeleteSession: vi.fn(),
};

describe("SessionList — unified mode workspace picker", () => {
  it("renders a New chat menu trigger when workspaces and callback are provided", () => {
    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[]}
        workspaceNames={{}}
        workspaceBranches={{}}
        onSelectSession={vi.fn()}
        workspaces={[{ id: "ws-1", name: "My Workspace", backend: "local" }]}
        activeWorkspaceId="ws-1"
        onCreateSessionInWorkspace={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "New chat" })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
  });

  it("creates a chat through the New chat menu in unified mode without workspaces", async () => {
    const user = userEvent.setup();
    const onCreateSession = vi.fn();
    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[]}
        workspaceNames={{}}
        workspaceBranches={{}}
        onSelectSession={vi.fn()}
        onCreateSession={onCreateSession}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New chat" }));
    await user.click(await screen.findByRole("menuitem", { name: "OpenCode" }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
    expect(onCreateSession).toHaveBeenCalledWith("opencode");
  });

  it("shows workspace names in dropdown when opened", async () => {
    const user = userEvent.setup();
    const onCreateInWorkspace = vi.fn();

    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[]}
        workspaceNames={{}}
        workspaceBranches={{}}
        onSelectSession={vi.fn()}
        workspaces={[
          { id: "ws-1", name: "Local Project", backend: "local" },
          { id: "ws-2", name: "Remote Server", backend: "remote" },
        ]}
        activeWorkspaceId="ws-1"
        onCreateSessionInWorkspace={onCreateInWorkspace}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New chat" }));

    expect(await screen.findByText("Local Project")).toBeInTheDocument();
    expect(await screen.findByText("Remote Server")).toBeInTheDocument();
  });

  it("creates a chat with the picked engine in the picked workspace", async () => {
    workspaceDefaults.engineByWorkspaceId = { "ws-2": "omo" };
    const user = userEvent.setup();
    const onCreateInWorkspace = vi.fn();

    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[]}
        workspaceNames={{}}
        workspaceBranches={{}}
        onSelectSession={vi.fn()}
        workspaces={[
          { id: "ws-1", name: "Local Project", backend: "local" },
          { id: "ws-2", name: "Remote Server", backend: "remote" },
        ]}
        activeWorkspaceId="ws-1"
        onCreateSessionInWorkspace={onCreateInWorkspace}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New chat" }));
    const remoteWorkspace = await screen.findByRole("menuitem", {
      name: "Remote Server",
    });
    expect(remoteWorkspace).toHaveAttribute("aria-haspopup", "menu");
    await user.click(remoteWorkspace);

    const omoItem = await screen.findByRole("menuitem", {
      name: "OMO Native",
    });
    expect(omoItem).toHaveAccessibleDescription("Default");
    const openCodeItem = screen.getByRole("menuitem", { name: "OpenCode" });
    expect(openCodeItem).not.toHaveAccessibleDescription();

    // jsdom has no layout, so Radix's pointer-grace check closes a submenu as
    // soon as the pointer leaves its trigger. Pick the item from the keyboard.
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(openCodeItem).toHaveFocus());
    await user.keyboard("{Enter}");

    expect(onCreateInWorkspace).toHaveBeenCalledTimes(1);
    expect(onCreateInWorkspace).toHaveBeenCalledWith("ws-2", "opencode");
  });

  it("shows question icon instead of brain icon when session has pending question", () => {
    const sessions: Record<
      string,
      {
        id: string;
        projectID: string;
        directory: string;
        title: string;
        version: string;
        time: { created: number; updated: number };
      }
    > = {
      "sess-1": {
        id: "sess-1",
        projectID: "proj-1",
        directory: "/workspace",
        title: "Question Session",
        version: "1",
        time: { created: 1000, updated: 2000 },
      },
    };

    const { container } = render(
      <SessionList
        {...baseProps}
        mode="workspace"
        sessions={sessions}
        sessionStatuses={{ "sess-1": { type: "busy" } as never }}
        questionSessionIds={new Set(["sess-1"])}
        onSelectSession={vi.fn()}
      />,
    );

    const sessionRow = container.querySelector("[data-session-id='sess-1']");
    expect(sessionRow).toBeTruthy();
    const questionIcon = sessionRow?.querySelector(
      "svg.lucide-message-circle-question-mark",
    );
    const brainIcon = sessionRow?.querySelector("svg.lucide-brain");
    expect(questionIcon).toBeTruthy();
    expect(brainIcon).toBeNull();
  });

  it("shows brain icon for busy session without pending question", () => {
    const sessions: Record<
      string,
      {
        id: string;
        projectID: string;
        directory: string;
        title: string;
        version: string;
        time: { created: number; updated: number };
      }
    > = {
      "sess-1": {
        id: "sess-1",
        projectID: "proj-1",
        directory: "/workspace",
        title: "Busy Session",
        version: "1",
        time: { created: 1000, updated: 2000 },
      },
    };

    const { container } = render(
      <SessionList
        {...baseProps}
        mode="workspace"
        sessions={sessions}
        sessionStatuses={{ "sess-1": { type: "busy" } as never }}
        onSelectSession={vi.fn()}
      />,
    );

    const sessionRow = container.querySelector("[data-session-id='sess-1']");
    expect(sessionRow).toBeTruthy();
    const brainIcon = sessionRow?.querySelector("svg.lucide-brain");
    const questionIcon = sessionRow?.querySelector(
      "svg.lucide-message-circle-question-mark",
    );
    expect(brainIcon).toBeTruthy();
    expect(questionIcon).toBeNull();
  });

  it("renders session items with workspace badges in unified mode", () => {
    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[
          makeUnifiedSession("sess-1", "ws-1", { title: "Test Session" }),
        ]}
        workspaceNames={{ "ws-1": "My Workspace" }}
        workspaceBranches={{ "ws-1": "main" }}
        onSelectSession={vi.fn()}
        workspaces={[{ id: "ws-1", name: "My Workspace", backend: "local" }]}
        activeWorkspaceId="ws-1"
        onCreateSessionInWorkspace={vi.fn()}
      />,
    );

    expect(screen.getByText("Test Session")).toBeInTheDocument();
    // Branch name is shown when workspaceBranches provides it; falls back to workspace name
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("shows task progress only for sessions with tasks", () => {
    const sessions = {
      "sess-1": makeUnifiedSession("sess-1", "ws-1", {
        title: "Session with tasks",
      }),
      "sess-2": makeUnifiedSession("sess-2", "ws-1", {
        title: "Session without tasks",
      }),
    };

    const { container } = render(
      <SessionList
        {...baseProps}
        mode="workspace"
        sessions={sessions}
        taskProgressBySessionId={{
          "sess-1": { completed: 2, total: 3 },
        }}
        onSelectSession={vi.fn()}
      />,
    );

    const sessionWithTasks = container.querySelector(
      "[data-session-id='sess-1']",
    );
    const sessionWithoutTasks = container.querySelector(
      "[data-session-id='sess-2']",
    );

    expect(sessionWithTasks).toHaveTextContent("2/3");
    expect(
      sessionWithTasks?.querySelector(
        "progress[aria-label='2 of 3 tasks completed']",
      ),
    ).toHaveAttribute("value", "2");
    expect(sessionWithoutTasks?.querySelector("progress")).toBeNull();
  });

  it.each([
    ["busy", false, false],
    ["retry", false, false],
    ["idle", true, false],
    ["idle", false, true],
  ] as const)(
    "keeps old task progress colored for %s status with question=%s and active descendant=%s",
    (status, hasQuestion, hasActiveDescendant) => {
      const updatedAt = Date.now() - 2 * 3_600_000;
      const { container } = render(
        <SessionList
          {...baseProps}
          mode="workspace"
          sessions={{
            "sess-1": makeUnifiedSession("sess-1", "ws-1", {
              updated: updatedAt,
            }),
          }}
          sessionStatuses={{ "sess-1": { type: status } as never }}
          questionSessionIds={hasQuestion ? new Set(["sess-1"]) : undefined}
          taskActiveSessionIds={
            hasActiveDescendant ? new Set(["sess-1"]) : undefined
          }
          taskProgressBySessionId={{
            "sess-1": { completed: 1, total: 4, updatedAt },
          }}
          onSelectSession={vi.fn()}
        />,
      );

      expect(
        container.querySelector("[data-session-id='sess-1'] progress"),
      ).toHaveClass("accent-sky-500");
    },
  );

  it("shows the sub-agent counter only for sessions running sub-agents", () => {
    const sessions = {
      "sess-1": makeUnifiedSession("sess-1", "ws-1", {
        title: "Session with sub-agents",
      }),
      "sess-2": makeUnifiedSession("sess-2", "ws-1", {
        title: "Session without sub-agents",
      }),
    };

    const { container } = render(
      <SessionList
        {...baseProps}
        mode="workspace"
        sessions={sessions}
        taskProgressBySessionId={{
          "sess-1": { completed: 2, total: 3 },
        }}
        subAgentCountBySessionId={{
          "sess-1": {
            active: 2,
            waiting: 1,
            progress: { completed: 4, total: 10 },
          },
        }}
        onSelectSession={vi.fn()}
      />,
    );

    const withSubAgents = container.querySelector("[data-session-id='sess-1']");
    const withoutSubAgents = container.querySelector(
      "[data-session-id='sess-2']",
    );

    expect(withSubAgents).toHaveTextContent("2/3");
    expect(
      withSubAgents?.querySelector(
        "[aria-label='3 sub-agents working (1 waiting for input) — 4 of 10 sub-agent tasks completed']",
      ),
    ).toHaveTextContent("3");
    expect(
      withSubAgents?.querySelector(
        "progress[aria-label='4 of 10 sub-agent tasks completed']",
      ),
    ).toHaveAttribute("value", "4");
    expect(
      withoutSubAgents?.querySelector("[aria-label*='sub-agent']"),
    ).toBeNull();
  });

  it("shows the sub-agent counter in grouped workspace mode", () => {
    const { container } = render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[makeUnifiedSession("sess-1", "ws-1")]}
        workspaceNames={{ "ws-1": "Workspace" }}
        workspaceBranches={{}}
        groupByWorkspace
        subAgentCountBySessionId={{ "sess-1": { active: 4, waiting: 0 } }}
        onSelectSession={vi.fn()}
      />,
    );

    expect(
      container.querySelector(
        "[data-session-id='sess-1'] [aria-label='4 sub-agents working']",
      ),
    ).toHaveTextContent("4");
  });

  it("keeps old task progress colored in grouped workspace mode", () => {
    const updatedAt = Date.now() - 2 * 3_600_000;
    const { container } = render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[
          makeUnifiedSession("sess-1", "ws-1", { updated: updatedAt }),
        ]}
        workspaceNames={{ "ws-1": "Workspace" }}
        workspaceBranches={{}}
        groupByWorkspace
        taskActiveSessionIds={new Set(["sess-1"])}
        taskProgressBySessionId={{
          "sess-1": { completed: 1, total: 4, updatedAt },
        }}
        onSelectSession={vi.fn()}
      />,
    );

    expect(
      container.querySelector("[data-session-id='sess-1'] progress"),
    ).toHaveClass("accent-sky-500");
  });
});

describe("SessionList — new chat engine menus", () => {
  it("creates an omo chat from the workspace-mode header +", async () => {
    useChatStore.setState({ activeWorkspaceId: "ws-1" });
    workspaceDefaults.engineByWorkspaceId = { "ws-1": "omo" };
    const user = userEvent.setup();
    const onCreateSession = vi.fn();
    render(
      <SessionList
        {...baseProps}
        mode="workspace"
        sessions={{ ses_1: makeUnifiedSession("ses_1", "ws-1") }}
        onSelectSession={vi.fn()}
        onCreateSession={onCreateSession}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New chat" }));
    const omoItem = await screen.findByRole("menuitem", {
      name: "OMO Native",
    });
    expect(omoItem).toHaveAccessibleDescription("Default");
    await user.click(omoItem);

    expect(onCreateSession).toHaveBeenCalledTimes(1);
    expect(onCreateSession).toHaveBeenCalledWith("omo");
  });

  it("creates a chat from the empty-list New Chat button", async () => {
    const user = userEvent.setup();
    const onCreateSession = vi.fn();
    render(
      <SessionList
        {...baseProps}
        mode="workspace"
        sessions={{}}
        onSelectSession={vi.fn()}
        onCreateSession={onCreateSession}
      />,
    );

    const emptyListButton = screen.getByRole("button", { name: "New Chat" });
    expect(emptyListButton).toHaveTextContent("New Chat");
    await user.click(emptyListButton);
    await user.click(await screen.findByRole("menuitem", { name: "OpenCode" }));

    expect(onCreateSession).toHaveBeenCalledTimes(1);
    expect(onCreateSession).toHaveBeenCalledWith("opencode");
  });

  it("creates a chat in a workspace from its group header +", async () => {
    const user = userEvent.setup();
    const onCreateInWorkspace = vi.fn();
    const onToggleWorkspaceExpanded = vi.fn();
    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[makeUnifiedSession("ses_1", "ws-1")]}
        workspaceNames={{ "ws-1": "Workspace" }}
        workspaceBranches={{}}
        groupByWorkspace
        onToggleWorkspaceExpanded={onToggleWorkspaceExpanded}
        onSelectSession={vi.fn()}
        onCreateSessionInWorkspace={onCreateInWorkspace}
      />,
    );

    const groupTrigger = screen.getByRole("button", {
      name: "New chat in Workspace",
    });
    await user.click(groupTrigger);
    expect(groupTrigger).toHaveAttribute("data-state", "open");
    expect(groupTrigger).toHaveClass("data-[state=open]:opacity-100");
    await user.click(
      await screen.findByRole("menuitem", { name: "OMO Native" }),
    );

    expect(onCreateInWorkspace).toHaveBeenCalledTimes(1);
    expect(onCreateInWorkspace).toHaveBeenCalledWith("ws-1", "omo");
    expect(onToggleWorkspaceExpanded).not.toHaveBeenCalled();
  });
});

describe("SessionList — engine badge", () => {
  it("shows the omo badge on omo sessions only", () => {
    render(
      <SessionList
        {...baseProps}
        mode="workspace"
        sessions={{
          omo_abc: makeUnifiedSession("omo_abc", "ws-1", {
            title: "Omo chat",
          }),
          ses_def: makeUnifiedSession("ses_def", "ws-1", {
            title: "OpenCode chat",
          }),
        }}
        onSelectSession={vi.fn()}
      />,
    );

    expect(within(getSessionRow("omo_abc")).getByText("omo")).toHaveAttribute(
      "title",
      "Chat engine: OmO Native",
    );
    expect(
      within(getSessionRow("ses_def")).queryByText("omo"),
    ).not.toBeInTheDocument();
  });
});

describe("SessionList — rename", () => {
  it("renames a session inline through the chat store", async () => {
    const { useChatStore } = await import("@/stores/chat-store");
    const renameSession = vi.fn(async () => true);
    useChatStore.setState({ renameSession });
    const user = userEvent.setup();
    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[makeUnifiedSession("s1", "ws-1", { title: "Old title" })]}
        workspaceNames={{}}
        workspaceBranches={{}}
        onSelectSession={vi.fn()}
      />,
    );

    await user.click(screen.getAllByTitle("Rename")[0]!);
    const input = screen.getByLabelText("Session title");
    await user.clear(input);
    await user.type(input, "New title{Enter}");

    expect(renameSession).toHaveBeenCalledWith("s1", "ws-1", "New title");
    expect(screen.queryByLabelText("Session title")).not.toBeInTheDocument();
  });

  it("cancels the rename on Escape without saving", async () => {
    const { useChatStore } = await import("@/stores/chat-store");
    const renameSession = vi.fn(async () => true);
    useChatStore.setState({ renameSession });
    const user = userEvent.setup();
    render(
      <SessionList
        {...baseProps}
        mode="unified"
        sessions={[makeUnifiedSession("s1", "ws-1", { title: "Keep" })]}
        workspaceNames={{}}
        workspaceBranches={{}}
        onSelectSession={vi.fn()}
      />,
    );

    await user.click(screen.getAllByTitle("Rename")[0]!);
    await user.type(screen.getByLabelText("Session title"), "x{Escape}");

    expect(renameSession).not.toHaveBeenCalled();
    expect(screen.getByText("Keep")).toBeInTheDocument();
  });
});

describe("SessionList — row actions in unified mode", () => {
  function renderUnifiedRow(options: { isPinned?: boolean } = {}) {
    const handlers = {
      onSelectSession: vi.fn(),
      onDeleteSession: vi.fn(),
      onPinSession: vi.fn(),
      onUnpinSession: vi.fn(),
      onClearSessionNote: vi.fn(),
    };
    render(
      <SessionList
        {...baseProps}
        {...handlers}
        mode="unified"
        sessions={[makeUnifiedSession("s1", "ws-b")]}
        workspaceNames={{}}
        workspaceBranches={{}}
        activeWorkspaceId="ws-a"
        pinnedSessionIds={new Set(options.isPinned ? ["s1"] : [])}
        sessionNotes={{ s1: "Pick up the review" }}
      />,
    );
    return handlers;
  }

  it("selects the session in its own workspace", async () => {
    // Given
    const handlers = renderUnifiedRow();

    // When
    await userEvent.click(getSessionRow("s1"));

    // Then
    expect(handlers.onSelectSession).toHaveBeenCalledWith("s1", "ws-b");
  });

  it("deletes the session in its own workspace", async () => {
    // Given
    const handlers = renderUnifiedRow();

    // When
    await userEvent.click(within(getSessionRow("s1")).getByTitle("Delete"));

    // Then
    expect(handlers.onDeleteSession).toHaveBeenCalledWith("s1", "ws-b");
  });

  it.each([
    { isPinned: false, button: "Pin", handler: "onPinSession" },
    { isPinned: true, button: "Unpin", handler: "onUnpinSession" },
  ] as const)(
    "$button the session in its own workspace",
    async ({ isPinned, button, handler }) => {
      // Given
      const handlers = renderUnifiedRow({ isPinned });

      // When
      await userEvent.click(within(getSessionRow("s1")).getByTitle(button));

      // Then
      expect(handlers[handler]).toHaveBeenCalledWith("s1", "ws-b");
    },
  );

  it("dismisses the session's note in its own workspace", async () => {
    // Given
    const handlers = renderUnifiedRow();

    // When
    await userEvent.click(
      within(getSessionRow("s1")).getByTitle("Dismiss note"),
    );

    // Then
    expect(handlers.onClearSessionNote).toHaveBeenCalledWith("s1", "ws-b");
  });
});
