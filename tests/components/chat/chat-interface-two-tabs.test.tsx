import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInterface,
  type ChatInterfaceProps,
} from "@/components/chat/chat-interface";
import type { SlashCommand } from "@/components/chat/command-picker";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  Agent,
  MessageWithParts,
  Session,
  SessionStatus,
} from "@/lib/opencode/types";
import {
  _resetModuleCaches,
  useChatStore,
  type WorkspaceState,
} from "@/stores/chat-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

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

interface PromptInputStubProps {
  agents: Agent[];
  onSubmit: (text: string) => void;
  onCommandSelect: (command: SlashCommand, args: string) => void;
}

vi.mock("@/hooks/use-command", () => ({ useCommand: vi.fn() }));
vi.mock("@/hooks/use-leader-action", () => ({ useLeaderAction: vi.fn() }));
vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: () => ({ engine: "opencode", isLoading: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));
// The composer is covered by its own tests; here it only forwards sends and
// slash commands to the chat it belongs to.
vi.mock("@/components/chat/prompt-input", () => ({
  PromptInput: function PromptInputStub({
    agents,
    onSubmit,
    onCommandSelect,
  }: PromptInputStubProps) {
    return (
      <div data-testid="prompt-input" data-agent-count={agents.length}>
        <button type="button" onClick={() => onSubmit("hello")}>
          Send prompt
        </button>
        <button
          type="button"
          onClick={() =>
            onCommandSelect(
              { name: "compact", description: "Compact", source: "builtin" },
              "",
            )
          }
        >
          Run compact
        </button>
      </div>
    );
  },
}));

const initialChatState = useChatStore.getState();
const initialWorkspaceState = useWorkspaceStore.getState();

const BUSY: SessionStatus = { type: "busy" };

function makeWorkspace(id: string, backend: Workspace["backend"]): Workspace {
  return {
    id,
    userId: "user-1",
    name: id,
    path: `/workspaces/${id}`,
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend,
    provider: null,
    opencodeUrl: null,
    agentUrl: null,
    providerMeta: null,
    shellCommand: null,
    sshTarget: null,
    sshPath: null,
    worktreeSymlinks: null,
    linkedTaskId: null,
    linkedTaskMeta: null,
    color: null,
    createdAt: new Date(0),
    lastAccessedAt: new Date(0),
  };
}

function makeSession(id: string, title: string, updated: number): Session {
  return {
    id,
    projectID: "project",
    directory: "/workspace",
    title,
    version: "1",
    time: { created: updated, updated },
  };
}

function userMessage(sessionID: string, text: string): MessageWithParts {
  const id = `${sessionID}-msg`;
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
    },
    parts: [{ id: `${id}-part`, sessionID, messageID: id, type: "text", text }],
  };
}

function workspaceState(overrides: Partial<WorkspaceState>): WorkspaceState {
  return {
    sessions: {},
    sessionsLoaded: true,
    messages: {},
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: {},
    todoUpdatedAt: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set(),
    sessionNotes: {},
    ...overrides,
  };
}

function makeAgent(name: string): Agent {
  return {
    name,
    description: name,
    mode: "primary",
    native: false,
    hidden: false,
    topP: 1,
    temperature: 1,
    color: "#000000",
    permission: [],
    options: {},
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(String(input), "http://localhost");
}

function agentListEngines(): (string | null)[] {
  return vi
    .mocked(fetch)
    .mock.calls.map(([input]) => requestUrl(input))
    .filter((url) => url.pathname === "/api/opencode/agent")
    .map((url) => url.searchParams.get("engine"));
}

const storeStubs = {
  createSession: vi.fn(async (_workspaceId: string) =>
    makeSession("s3", "New chat", 30),
  ),
  sendMessage: vi.fn(
    async (_sessionId: string, _text: string, _workspaceId: string) => {},
  ),
  summarizeSession: vi.fn(
    async (_sessionId: string, _workspaceId: string) => {},
  ),
  setSessionAgent: vi.fn(
    (_sessionId: string, _workspaceId: string, _agent: string) => {},
  ),
};

function seedStores(input: {
  activeSessionId: string;
  w2Backend?: Workspace["backend"];
}) {
  useWorkspaceStore.setState({
    workspaces: [
      makeWorkspace("w1", "local"),
      makeWorkspace("w2", input.w2Backend ?? "local"),
    ],
    activeWorkspaceId: "w1",
  });
  useChatStore.setState({
    ...storeStubs,
    fetchMessages: vi.fn(async () => {}),
    fetchSessionTodos: vi.fn(async () => {}),
    fetchSessions: vi.fn(async () => {}),
    fetchCachedSessions: vi.fn(async () => {}),
    fetchPinnedSessions: vi.fn(async () => {}),
    fetchSessionNotes: vi.fn(async () => {}),
    activeWorkspaceId: "w1",
    activeSessionId: input.activeSessionId,
    workspaceStates: {
      w1: workspaceState({
        sessions: {
          s1: makeSession("s1", "First chat", 20),
          s2: makeSession("s2", "Second chat", 10),
          omo_s4: makeSession("omo_s4", "Omo chat", 5),
        },
        messages: {
          s1: [userMessage("s1", "alpha")],
          s2: [userMessage("s2", "beta")],
        },
        sessionStatuses: { s1: BUSY },
      }),
      w2: workspaceState({
        sessions: { s5: makeSession("s5", "Other workspace chat", 15) },
      }),
    },
  });
}

function tabProps(
  tabId: string,
  overrides: Partial<ChatInterfaceProps>,
): ChatInterfaceProps {
  return {
    tabId,
    workspaceId: "w1",
    sessionId: null,
    isFocused: false,
    isLastFocusedChat: false,
    isVisible: true,
    ...overrides,
  };
}

function renderWithProviders(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <VirtuosoMockContext.Provider
          value={{ viewportHeight: 2000, itemHeight: 100 }}
        >
          {children}
        </VirtuosoMockContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function renderTwoTabs(tabA: ChatInterfaceProps, tabB: ChatInterfaceProps) {
  renderWithProviders(
    <>
      <div data-testid="tab-a">
        <ChatInterface {...tabA} />
      </div>
      <div data-testid="tab-b">
        <ChatInterface {...tabB} />
      </div>
    </>,
  );
  return {
    tabA: screen.getByTestId("tab-a"),
    tabB: screen.getByTestId("tab-b"),
  };
}

function sessionRow(container: HTMLElement, sessionId: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `[data-session-id="${sessionId}"]`,
  );
  if (!row) throw new Error(`no session row for ${sessionId}`);
  return row;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      requestUrl(input).pathname === "/api/opencode/agent"
        ? new Response(
            JSON.stringify({
              build: makeAgent("build"),
              plan: makeAgent("plan"),
            }),
          )
        : new Response("[]"),
    ),
  );
});

// Unmount before resetting the stores: a mounted chat would otherwise run its
// effects against the real store actions and seed state the next test sees.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
  useChatStore.setState(initialChatState, true);
  useWorkspaceStore.setState(initialWorkspaceState, true);
  _resetModuleCaches();
});

describe("ChatInterface in two side-by-side chat tabs", () => {
  it("shows each tab only its own session's messages", () => {
    seedStores({ activeSessionId: "s1" });

    const { tabA, tabB } = renderTwoTabs(
      tabProps("tab-a", { sessionId: "s1", isFocused: true }),
      tabProps("tab-b", { sessionId: "s2" }),
    );

    expect(within(tabA).getByText("alpha")).toBeInTheDocument();
    expect(within(tabA).queryByText("beta")).not.toBeInTheDocument();
    expect(within(tabB).getByText("beta")).toBeInTheDocument();
    expect(within(tabB).queryByText("alpha")).not.toBeInTheDocument();
  });

  it("shows no streaming indicator in the unfocused tab while the focused session is busy", () => {
    seedStores({ activeSessionId: "s1" });

    const { tabA, tabB } = renderTwoTabs(
      tabProps("tab-a", { sessionId: "s1", isFocused: true }),
      tabProps("tab-b", { sessionId: "s2" }),
    );

    expect(within(tabA).getByText("Thinking...")).toBeInTheDocument();
    expect(within(tabB).queryByText("Thinking...")).not.toBeInTheDocument();
  });

  it("tells only the tab whose list was clicked which session to show", () => {
    seedStores({ activeSessionId: "s1" });
    const onTabAChosen = vi.fn();
    const onTabBChosen = vi.fn();
    const { tabA } = renderTwoTabs(
      tabProps("tab-a", {
        sessionId: "s1",
        isFocused: true,
        onSessionChosen: onTabAChosen,
      }),
      tabProps("tab-b", { sessionId: "s2", onSessionChosen: onTabBChosen }),
    );

    fireEvent.click(sessionRow(tabA, "s2"));

    expect(onTabAChosen).toHaveBeenCalledExactlyOnceWith("w1", "s2");
    expect(onTabBChosen).not.toHaveBeenCalled();
  });

  it("reports the session a slash command creates in a new-chat tab", async () => {
    seedStores({ activeSessionId: "s1" });
    const onNewTabChosen = vi.fn();
    const { tabB } = renderTwoTabs(
      tabProps("tab-a", { sessionId: "s1", isFocused: true }),
      tabProps("tab-b", { sessionId: null, onSessionChosen: onNewTabChosen }),
    );

    fireEvent.click(within(tabB).getByRole("button", { name: "Run compact" }));

    await waitFor(() =>
      expect(onNewTabChosen).toHaveBeenCalledWith("w1", "s3"),
    );
    expect(storeStubs.summarizeSession.mock.calls[0]?.slice(0, 2)).toEqual([
      "s3",
      "w1",
    ]);
  });

  it("reports the session the first message creates in a new-chat tab exactly once", async () => {
    seedStores({ activeSessionId: "s1" });
    const onFocusedTabChosen = vi.fn();
    const onNewTabChosen = vi.fn();
    const { tabB } = renderTwoTabs(
      tabProps("tab-a", {
        sessionId: "s1",
        isFocused: true,
        onSessionChosen: onFocusedTabChosen,
      }),
      tabProps("tab-b", { sessionId: null, onSessionChosen: onNewTabChosen }),
    );

    fireEvent.click(within(tabB).getByRole("button", { name: "Send prompt" }));

    await waitFor(() => expect(storeStubs.sendMessage).toHaveBeenCalled());
    expect(storeStubs.sendMessage.mock.calls[0]?.slice(0, 3)).toEqual([
      "s3",
      "hello",
      "w1",
    ]);
    expect(onNewTabChosen).toHaveBeenCalledExactlyOnceWith("w1", "s3");
    expect(onFocusedTabChosen).not.toHaveBeenCalled();
  });

  it("switches the workspace before reporting a pick from another workspace in the unified list", () => {
    localStorage.setItem("dev-hub:chat-unified-mode", "true");
    seedStores({ activeSessionId: "s1" });
    const setActiveWorkspaceId = vi
      .spyOn(useWorkspaceStore.getState(), "setActiveWorkspaceId")
      .mockImplementation(() => {});
    const onTabAChosen = vi.fn();
    const { tabA } = renderTwoTabs(
      tabProps("tab-a", {
        sessionId: "s1",
        isFocused: true,
        onSessionChosen: onTabAChosen,
      }),
      tabProps("tab-b", { sessionId: "s2" }),
    );

    fireEvent.click(sessionRow(tabA, "s5"));

    expect(setActiveWorkspaceId).toHaveBeenCalledWith("w2");
    expect(onTabAChosen).toHaveBeenCalledExactlyOnceWith("w2", "s5");
    expect(setActiveWorkspaceId.mock.invocationCallOrder[0]).toBeLessThan(
      onTabAChosen.mock.invocationCallOrder[0],
    );
  });

  it("hands a new chat in another workspace to the workbench and wakes that workspace", async () => {
    localStorage.setItem("dev-hub:chat-unified-mode", "true");
    localStorage.setItem("dev-hub:chat-group-by-workspace", "true");
    seedStores({ activeSessionId: "s1", w2Backend: "remote" });
    const setActiveWorkspaceId = vi.spyOn(
      useWorkspaceStore.getState(),
      "setActiveWorkspaceId",
    );
    const onNewChatInWorkspace = vi.fn();
    const user = userEvent.setup();
    const { tabA } = renderTwoTabs(
      tabProps("tab-a", {
        sessionId: "s1",
        isFocused: true,
        onNewChatInWorkspace,
      }),
      tabProps("tab-b", { sessionId: "s2" }),
    );

    await user.click(within(tabA).getByTitle("New chat in w2"));
    await user.click(
      await screen.findByRole("menuitem", { name: /OMO Native/ }),
    );

    expect(onNewChatInWorkspace).toHaveBeenCalledExactlyOnceWith("w2", "omo");
    expect(storeStubs.createSession).not.toHaveBeenCalled();
    expect(setActiveWorkspaceId).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("/api/workspaces/w2/start", {
      method: "POST",
    });
  });

  it("cycles the agent of the focused tab's session only", async () => {
    seedStores({ activeSessionId: "s1" });
    const { tabA, tabB } = renderTwoTabs(
      tabProps("tab-a", { sessionId: "s1", isFocused: true }),
      tabProps("tab-b", { sessionId: "s2" }),
    );
    await waitFor(() => {
      expect(within(tabA).getByTestId("prompt-input")).toHaveAttribute(
        "data-agent-count",
        "2",
      );
      expect(within(tabB).getByTestId("prompt-input")).toHaveAttribute(
        "data-agent-count",
        "2",
      );
    });
    storeStubs.setSessionAgent.mockClear();

    act(() => {
      fireEvent.keyDown(within(tabA).getByTestId("prompt-input"), {
        key: ".",
        code: "Period",
        ctrlKey: true,
      });
    });

    expect(storeStubs.setSessionAgent).toHaveBeenCalledExactlyOnceWith(
      "s1",
      "w1",
      "plan",
    );
  });
});

describe("ChatInterface hooks inside its tab", () => {
  it("loads the tab's OpenCode agents while the workspace's active chat is omo", async () => {
    seedStores({ activeSessionId: "omo_s4" });

    renderWithProviders(
      <ChatInterface {...tabProps("tab-a", { sessionId: "s1" })} />,
    );

    await waitFor(() => expect(agentListEngines()).not.toHaveLength(0));
    expect(new Set(agentListEngines())).toEqual(new Set(["opencode"]));
  });
});

describe("ChatInterface without the legacy side panel", () => {
  it("renders no side panel toggle", () => {
    seedStores({ activeSessionId: "s1" });

    renderWithProviders(
      <ChatInterface
        {...tabProps("tab-a", { sessionId: "s1", isFocused: true })}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /side panel/i }),
    ).not.toBeInTheDocument();
  });

  it("leaves Cmd+\\ to the workbench", () => {
    seedStores({ activeSessionId: "s1" });
    renderWithProviders(
      <ChatInterface
        {...tabProps("tab-a", { sessionId: "s1", isFocused: true })}
      />,
    );

    // fireEvent returns false once a listener calls preventDefault.
    const wasDefaultAllowed = fireEvent.keyDown(window, {
      key: "\\",
      metaKey: true,
    });

    expect(wasDefaultAllowed).toBe(true);
  });
});
