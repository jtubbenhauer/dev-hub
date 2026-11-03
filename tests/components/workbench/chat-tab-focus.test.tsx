import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DockviewReact, type DockviewApi } from "dockview-react";
import type { Ref } from "react";
import { VirtuosoMockContext } from "react-virtuoso";

import type { PromptInputHandle } from "@/components/chat/prompt-input";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatTabPanel } from "@/components/workbench/tabs/chat-tab-panel";
import { createWorkbenchDockviewController } from "@/components/workbench/workbench-dockview-controller";
import type { MessageWithParts, Session } from "@/lib/opencode/types";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import {
  _resetModuleCaches,
  useChatStore,
  type WorkspaceState,
} from "@/stores/chat-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

import { createActDockviewLayoutApi } from "./probe-dockview";

const doubles = vi.hoisted(() => ({
  promptFocus: vi.fn<(tabId: string) => void>(),
  leaderKey: { registerAction: () => {}, deregisterAction: () => {} },
  commandPalette: { registerCommands: () => () => {} },
  router: { push: () => {}, replace: () => {} },
}));

vi.mock("@/components/providers/leader-key-provider", () => ({
  useLeaderKey: () => doubles.leaderKey,
}));
vi.mock("@/components/providers/command-palette-provider", () => ({
  useCommandPalette: () => doubles.commandPalette,
}));
vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: () => ({ engine: "opencode", isLoading: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => doubles.router,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

// The composer only exposes the focus handle the chat tab calls.
vi.mock("@/components/chat/prompt-input", async () => {
  const { useImperativeHandle } = await import("react");
  const { useChatTab } = await import("@/components/chat/chat-tab-context");
  return {
    PromptInput: function PromptInputStub({
      ref,
    }: {
      readonly ref?: Ref<PromptInputHandle>;
    }) {
      const tabId = useChatTab()?.tabId ?? "no-tab";
      useImperativeHandle(
        ref,
        () => ({
          focus: () => doubles.promptFocus(tabId),
          setValue: () => {},
        }),
        [tabId],
      );
      return <div data-testid="prompt-input" />;
    },
  };
});

const WORKSPACE_ID = "w1";
const LEFT_TAB = "tab-left";
const RIGHT_TAB = "tab-right";

const initialChatState = useChatStore.getState();
const initialWorkspaceState = useWorkspaceStore.getState();

function makeWorkspace(): Workspace {
  return {
    id: WORKSPACE_ID,
    userId: "user-1",
    name: WORKSPACE_ID,
    path: `/workspaces/${WORKSPACE_ID}`,
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

function workspaceState(): WorkspaceState {
  return {
    sessions: { s1: makeSession("s1", 20), s2: makeSession("s2", 10) },
    sessionsLoaded: true,
    messages: {
      s1: [userMessage("s1", "alpha")],
      s2: [userMessage("s2", "beta")],
    },
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

function seedStores(): void {
  useWorkspaceStore.setState({
    workspaces: [makeWorkspace()],
    activeWorkspaceId: WORKSPACE_ID,
  });
  useChatStore.setState({
    fetchMessages: vi.fn(async () => {}),
    fetchSessionTodos: vi.fn(async () => {}),
    fetchSessions: vi.fn(async () => {}),
    fetchCachedSessions: vi.fn(async () => {}),
    fetchPinnedSessions: vi.fn(async () => {}),
    fetchSessionNotes: vi.fn(async () => {}),
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: "s2",
    workspaceStates: { [WORKSPACE_ID]: workspaceState() },
  });
}

function chatParams(sessionId: string): WorkbenchTabParams {
  return { kind: "chat", workspaceId: WORKSPACE_ID, sessionId };
}

// Two chat tabs side by side; the right one is added last, so it is focused.
function renderChatTabs() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const readyApis: DockviewApi[] = [];
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <VirtuosoMockContext.Provider
          value={{ viewportHeight: 2000, itemHeight: 100 }}
        >
          <div style={{ width: 800, height: 600 }}>
            <DockviewReact
              components={{ chat: ChatTabPanel }}
              defaultRenderer="always"
              onReady={(event) => {
                event.api.addPanel({
                  id: LEFT_TAB,
                  component: "chat",
                  params: chatParams("s1"),
                  title: LEFT_TAB,
                });
                event.api.addPanel({
                  id: RIGHT_TAB,
                  component: "chat",
                  params: chatParams("s2"),
                  title: RIGHT_TAB,
                  position: { referencePanel: LEFT_TAB, direction: "right" },
                });
                readyApis.push(event.api);
              }}
            />
          </div>
        </VirtuosoMockContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const [api] = readyApis;
  if (!api) throw new Error("DockviewReact never fired onReady");
  const layoutApi = createActDockviewLayoutApi(api);
  const controller = createWorkbenchDockviewController({
    layoutApi,
    workspaceId: WORKSPACE_ID,
    endTerminalSession: vi.fn(),
    isMobile: false,
  });
  return { layoutApi, controller };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("[]")),
  );
  localStorage.clear();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  seedStores();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  doubles.promptFocus.mockClear();
  useChatStore.setState(initialChatState, true);
  useWorkspaceStore.setState(initialWorkspaceState, true);
  _resetModuleCaches();
});

describe("chat tab keyboard focus", () => {
  it("focuses the composer of the chat tab a keyboard command moves to", () => {
    // Given
    const { controller } = renderChatTabs();
    doubles.promptFocus.mockClear();

    // When
    act(() =>
      controller.runCommand({ type: "focus-group", direction: "left" }),
    );

    // Then
    expect(doubles.promptFocus.mock.calls).toEqual([[LEFT_TAB]]);
  });

  it.each([
    { name: "a message", target: () => screen.getByText("alpha") },
    { name: "the tab header", target: () => screen.getByText(LEFT_TAB) },
  ])(
    "leaves the composer alone when a click on $name focuses the tab",
    async ({ target }) => {
      // Given
      const { layoutApi } = renderChatTabs();
      doubles.promptFocus.mockClear();

      // When
      await userEvent.click(target());

      // Then
      expect(layoutApi.getActivePanelId()).toBe(LEFT_TAB);
      expect(doubles.promptFocus).not.toHaveBeenCalled();
    },
  );
});
