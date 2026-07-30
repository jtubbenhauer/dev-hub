import { SubAgentDialog } from "@/components/chat/sub-agent-dialog";
import {
  ChatDisplayContext,
  type ChatDisplaySettings,
} from "@/components/chat/chat-display-context";
import { useChatStore } from "@/stores/chat-store";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Message, MessageWithParts } from "@/lib/opencode/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: () => "ws-a",
}));

vi.mock("@/hooks/use-git", () => ({
  useWorkspaceGitHub: () => null,
}));

function makeAssistantMessage(
  id: string,
  modelID: string,
  providerID: string,
  options: { readonly text?: string; readonly createdAt?: number } = {},
): MessageWithParts {
  const info: Message = {
    id,
    sessionID: "child",
    role: "assistant",
    time: { created: options.createdAt ?? Date.now() },
    parentID: "parent",
    modelID,
    providerID,
    mode: "",
    path: { cwd: "", root: "" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  };
  return {
    info,
    parts:
      options.text === undefined
        ? []
        : [
            {
              id: `${id}-part`,
              sessionID: "child",
              messageID: id,
              type: "text",
              text: options.text,
            },
          ],
  };
}

function displaySettings(
  overrides: Partial<ChatDisplaySettings> = {},
): ChatDisplaySettings {
  return {
    showThinking: false,
    showToolCalls: false,
    showTokens: false,
    showTimestamps: false,
    ...overrides,
  };
}

function setChildSessionState(
  messages: MessageWithParts[] = [
    makeAssistantMessage("msg-1", "model", "provider", {
      text: "central child output",
      createdAt: 1,
    }),
  ],
): void {
  useChatStore.setState({
    activeWorkspaceId: "ws-a",
    activeSessionId: "parent",
    workspaceStates: {
      "ws-a": {
        sessions: {},
        sessionsLoaded: true,
        messages: { child: messages },
        optimisticMessageIds: {},
        sessionStatuses: {},
        permissions: [],
        questions: [],
        todos: {
          child: [
            {
              id: "todo-1",
              content: "central child todo",
              status: "in_progress",
              priority: "high",
            },
          ],
        },
        sessionAgents: {},
        sessionModels: {},
        sessionVariants: {},
        lastViewedAt: {},
        pinnedSessionIds: new Set(),
        sessionNotes: {},
      },
    },
  });
}

describe("SubAgentDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setChildSessionState();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const messages =
          useChatStore.getState().workspaceStates["ws-a"].messages.child;
        return new Response(
          JSON.stringify({
            messages,
            hasMore: false,
            total: messages.length,
            source: "remote",
          }),
          { status: 200 },
        );
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders child transcript and todos from the central chat store without a private EventSource", () => {
    const closeEventSource = vi.spyOn(EventSource.prototype, "close");

    const { unmount } = render(
      <SubAgentDialog
        childSessionId="child"
        workspaceId="ws-a"
        description="Child"
        isActive={false}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByText("central child output")).toBeInTheDocument();
    expect(screen.getByText("central child todo")).toBeInTheDocument();
    unmount();
    expect(closeEventSource).not.toHaveBeenCalled();
  });

  it("renders the first populated assistant model badge", () => {
    setChildSessionState([
      makeAssistantMessage("placeholder", "", ""),
      makeAssistantMessage("real", "gpt-4", "openai", { text: "output" }),
    ]);

    render(
      <SubAgentDialog
        childSessionId="child"
        workspaceId="ws-a"
        description="Child"
        isActive={false}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByText("gpt-4")).toHaveAttribute(
      "title",
      "openai / gpt-4",
    );
  });

  it("does not render a model badge without populated model metadata", () => {
    setChildSessionState([
      makeAssistantMessage("placeholder", "", "", { text: "output" }),
    ]);

    render(
      <SubAgentDialog
        childSessionId="child"
        workspaceId="ws-a"
        description="Child"
        isActive={false}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(
      screen.queryByTitle(
        (_title, element) =>
          element?.getAttribute("title")?.includes(" / ") ?? false,
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps sub-agent timestamps enabled independently of the parent context", () => {
    const createdAt = new Date("2099-01-15T10:30:00").getTime();
    setChildSessionState([
      makeAssistantMessage("first", "model", "provider", {
        text: "first",
        createdAt,
      }),
      makeAssistantMessage("second", "model", "provider", {
        text: "second",
        createdAt,
      }),
    ]);

    render(
      <ChatDisplayContext.Provider value={displaySettings()}>
        <SubAgentDialog
          childSessionId="child"
          workspaceId="ws-a"
          description="Child"
          isActive={false}
          open
          onOpenChange={() => {}}
        />
      </ChatDisplayContext.Provider>,
    );

    expect(screen.getAllByText(/\d{1,2}:\d{2}/).length).toBeGreaterThan(0);
  });

  it("force-refreshes an open active child on a bounded interval", async () => {
    vi.useFakeTimers();
    const fetchMessages = vi.mocked(fetch);

    render(
      <SubAgentDialog
        childSessionId="child"
        workspaceId="ws-a"
        description="Child"
        isActive
        open
        onOpenChange={() => {}}
      />,
    );

    expect(String(fetchMessages.mock.calls[0]?.[0])).toContain("fresh=1");
    const callsAfterOpen = fetchMessages.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(fetchMessages).toHaveBeenCalledTimes(callsAfterOpen + 1);
  });
});
