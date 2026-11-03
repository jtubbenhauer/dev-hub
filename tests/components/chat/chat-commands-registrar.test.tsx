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
import type { ReactNode, Ref } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChatInterface,
  type ChatInterfaceProps,
} from "@/components/chat/chat-interface";
import type { PromptInputHandle } from "@/components/chat/prompt-input";
import type { PaletteCommand } from "@/components/providers/command-palette-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Session } from "@/lib/opencode/types";
import {
  _resetModuleCaches,
  useChatStore,
  type WorkspaceState,
} from "@/stores/chat-store";
import { useSidePanelStore } from "@/stores/side-panel-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";
import type { LeaderAction } from "@/types/leader-key";

const leaderKey = vi.hoisted(() => ({
  registerAction: vi.fn<(action: LeaderAction, handler: () => void) => void>(),
  deregisterAction: vi.fn<(actionId: string) => void>(),
}));
const commandPalette = vi.hoisted(() => ({
  registerCommands: vi.fn<(commands: PaletteCommand[]) => () => void>(
    () => () => {},
  ),
}));
const promptFocus = vi.hoisted(() => vi.fn<(tabId: string) => void>());

vi.mock("@/components/providers/leader-key-provider", () => ({
  useLeaderKey: () => leaderKey,
}));
vi.mock("@/components/providers/command-palette-provider", () => ({
  useCommandPalette: () => commandPalette,
}));
vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: () => ({ engine: "opencode", isLoading: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/workbench",
}));

interface PromptInputStubProps {
  readonly ref?: Ref<PromptInputHandle>;
  readonly isVariantSelectorOpen?: boolean;
  readonly onVariantSelectorOpenChange?: (open: boolean) => void;
}

// The composer only exposes its focus handle and the variant selector state
// the chat owns.
vi.mock("@/components/chat/prompt-input", async () => {
  const { useImperativeHandle } = await import("react");
  const { useChatTab } = await import("@/components/chat/chat-tab-context");
  return {
    PromptInput: function PromptInputStub({
      ref,
      isVariantSelectorOpen,
      onVariantSelectorOpenChange,
    }: PromptInputStubProps) {
      const tabId = useChatTab()?.tabId ?? "no-tab";
      useImperativeHandle(
        ref,
        () => ({ focus: () => promptFocus(tabId), setValue: () => {} }),
        [tabId],
      );
      return (
        <div
          data-testid="prompt-input"
          data-variant-selector-open={String(isVariantSelectorOpen ?? false)}
        >
          <button
            type="button"
            onClick={() => onVariantSelectorOpenChange?.(true)}
          >
            Open variants
          </button>
        </div>
      );
    },
  };
});

const initialChatState = useChatStore.getState();
const initialWorkspaceState = useWorkspaceStore.getState();
const initialSidePanelState = useSidePanelStore.getState();

function makeWorkspace(id: string): Workspace {
  return {
    id,
    userId: "user-1",
    name: id,
    path: `/workspaces/${id}`,
    type: "repo",
    parentRepoPath: null,
    packageManager: null,
    quickCommands: null,
    backend: "local",
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

function makeSession(id: string, updated: number): Session {
  return {
    id,
    projectID: "project",
    directory: "/workspace",
    title: `Chat ${id}`,
    version: "1",
    time: { created: updated, updated },
  };
}

function workspaceState(sessions: readonly Session[]): WorkspaceState {
  return {
    sessions: Object.fromEntries(sessions.map((entry) => [entry.id, entry])),
    sessionsLoaded: true,
    messages: {},
    optimisticMessageIds: {},
    sessionStatuses: {},
    permissions: [],
    questions: [],
    todos: {},
    sessionAgents: {},
    sessionModels: {},
    sessionVariants: {},
    lastViewedAt: {},
    pinnedSessionIds: new Set(),
    sessionNotes: {},
  };
}

function seedStores() {
  useWorkspaceStore.setState({
    workspaces: [makeWorkspace("w1")],
    activeWorkspaceId: "w1",
  });
  useChatStore.setState({
    createSession: vi.fn(async () => makeSession("s3", 30)),
    fetchMessages: vi.fn(async () => {}),
    fetchSessionTodos: vi.fn(async () => {}),
    fetchSessions: vi.fn(async () => {}),
    fetchCachedSessions: vi.fn(async () => {}),
    fetchPinnedSessions: vi.fn(async () => {}),
    fetchSessionNotes: vi.fn(async () => {}),
    activeWorkspaceId: "w1",
    activeSessionId: "s1",
    workspaceStates: {
      w1: workspaceState([makeSession("s1", 20), makeSession("s2", 10)]),
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
    legacyPageMode: false,
    ...overrides,
  };
}

interface TwoTabsProps {
  readonly tabA: ChatInterfaceProps;
  readonly tabB: ChatInterfaceProps;
}

function TwoTabs({ tabA, tabB }: TwoTabsProps) {
  return (
    <>
      <div data-testid="tab-a">
        <ChatInterface {...tabA} />
      </div>
      <div data-testid="tab-b">
        <ChatInterface {...tabB} />
      </div>
    </>
  );
}

function renderTwoTabs(tabs: TwoTabsProps) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const withProviders = (children: ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <VirtuosoMockContext.Provider
          value={{ viewportHeight: 2000, itemHeight: 100 }}
        >
          {children}
        </VirtuosoMockContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(withProviders(<TwoTabs {...tabs} />));
  return {
    rerenderTabs: (nextTabs: TwoTabsProps) =>
      rerender(withProviders(<TwoTabs {...nextTabs} />)),
  };
}

function leaderRegistrationCount(actionId: string): number {
  return leaderKey.registerAction.mock.calls.filter(
    ([action]) => action.id === actionId,
  ).length;
}

function latestLeaderHandler(actionId: string): () => void {
  const registration = leaderKey.registerAction.mock.calls
    .filter(([action]) => action.id === actionId)
    .at(-1);
  if (!registration) throw new Error(`${actionId} was never registered`);
  return registration[1];
}

function variantSelectorState(tabTestId: string): string | undefined {
  return within(screen.getByTestId(tabTestId)).getByTestId("prompt-input")
    .dataset.variantSelectorOpen;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]")),
  );
  useSidePanelStore.setState({ isOpen: false });
  seedStores();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
  useChatStore.setState(initialChatState, true);
  useWorkspaceStore.setState(initialWorkspaceState, true);
  useSidePanelStore.setState(initialSidePanelState, true);
  useTerminalStore.setState({ isOpen: false });
  _resetModuleCaches();
});

describe("chat commands with two chat tabs", () => {
  it("registers the chat leader actions only for the focused tab", () => {
    // When
    renderTwoTabs({
      tabA: tabProps("tab-a", { sessionId: "s1", isFocused: true }),
      tabB: tabProps("tab-b", { sessionId: "s2" }),
    });

    // Then
    expect(leaderRegistrationCount("chat:new-session")).toBe(1);
  });

  it("registers the chat palette commands only for the focused tab", () => {
    // When
    renderTwoTabs({
      tabA: tabProps("tab-a", { sessionId: "s1", isFocused: true }),
      tabB: tabProps("tab-b", { sessionId: "s2" }),
    });

    // Then
    const registeredIds = commandPalette.registerCommands.mock.calls.flatMap(
      ([commands]) => commands.map((command) => command.id),
    );
    expect(
      registeredIds.filter((id) => id === "chat:new-session"),
    ).toHaveLength(1);
  });

  it("creates the new session for the focused tab", async () => {
    // Given
    const onFocusedTabChosen = vi.fn();
    const onOtherTabChosen = vi.fn();
    renderTwoTabs({
      tabA: tabProps("tab-a", {
        sessionId: "s1",
        isFocused: true,
        onSessionChosen: onFocusedTabChosen,
      }),
      tabB: tabProps("tab-b", {
        sessionId: "s2",
        onSessionChosen: onOtherTabChosen,
      }),
    });

    // When
    act(() => latestLeaderHandler("chat:new-session")());

    // Then
    await waitFor(() =>
      expect(onFocusedTabChosen).toHaveBeenCalledExactlyOnceWith("w1", "s3"),
    );
    expect(onOtherTabChosen).not.toHaveBeenCalled();
  });

  it("hands the chat actions to the tab that gains focus", async () => {
    // Given
    const onTabAChosen = vi.fn();
    const onTabBChosen = vi.fn();
    const { rerenderTabs } = renderTwoTabs({
      tabA: tabProps("tab-a", {
        sessionId: "s1",
        isFocused: true,
        onSessionChosen: onTabAChosen,
      }),
      tabB: tabProps("tab-b", {
        sessionId: "s2",
        onSessionChosen: onTabBChosen,
      }),
    });

    // When
    rerenderTabs({
      tabA: tabProps("tab-a", {
        sessionId: "s1",
        onSessionChosen: onTabAChosen,
      }),
      tabB: tabProps("tab-b", {
        sessionId: "s2",
        isFocused: true,
        onSessionChosen: onTabBChosen,
      }),
    });
    act(() => latestLeaderHandler("chat:new-session")());

    // Then
    expect(leaderKey.deregisterAction).toHaveBeenCalledWith("chat:new-session");
    await waitFor(() =>
      expect(onTabBChosen).toHaveBeenCalledExactlyOnceWith("w1", "s3"),
    );
    expect(onTabAChosen).not.toHaveBeenCalled();
  });

  it("toggles the focused tab's variant selector from the leader action", () => {
    // Given
    renderTwoTabs({
      tabA: tabProps("tab-a", { sessionId: "s1", isFocused: true }),
      tabB: tabProps("tab-b", { sessionId: "s2" }),
    });

    // When
    act(() => latestLeaderHandler("chat:toggle-variant")());

    // Then
    expect(variantSelectorState("tab-a")).toBe("true");
    expect(variantSelectorState("tab-b")).toBe("false");
  });

  it("still opens the variant selector of an unfocused tab from its composer", () => {
    // Given
    renderTwoTabs({
      tabA: tabProps("tab-a", { sessionId: "s1", isFocused: true }),
      tabB: tabProps("tab-b", { sessionId: "s2" }),
    });

    // When
    fireEvent.click(
      within(screen.getByTestId("tab-b")).getByRole("button", {
        name: "Open variants",
      }),
    );

    // Then
    expect(variantSelectorState("tab-b")).toBe("true");
  });

  it("refocuses only the focused tab's composer when the terminal drawer closes", () => {
    // Given
    renderTwoTabs({
      tabA: tabProps("tab-a", { sessionId: "s1" }),
      tabB: tabProps("tab-b", { sessionId: "s2", isFocused: true }),
    });
    act(() => useTerminalStore.getState().setOpen(true));
    promptFocus.mockClear();

    // When
    act(() => useTerminalStore.getState().setOpen(false));

    // Then
    expect(promptFocus.mock.calls).toEqual([["tab-b"]]);
  });
});
