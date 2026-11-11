import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkbenchDockviewController } from "@/components/workbench/workbench-dockview-controller";
import type { Session } from "@/lib/opencode/types";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";

import {
  createFakeLayoutApi,
  type FakeLayoutSeed,
  type FakePanelSeed,
} from "../../lib/workbench/fake-layout-api";

const WORKSPACE_ID = "ws-1";
const FULL_RECT = { left: 0, top: 0, width: 1000, height: 1000 };

function session(id: string, title: string): Session {
  return {
    id,
    projectID: "project",
    directory: "/workspace",
    title,
    version: "1",
    time: { created: 1_000, updated: 1_000 },
  };
}

function workspaceStateWithSessions(sessions: Session[]): WorkspaceState {
  return {
    sessions: Object.fromEntries(sessions.map((entry) => [entry.id, entry])),
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
  };
}

const terminalPanel = {
  id: "terminal-1",
  params: {
    kind: "terminal",
    workspaceId: WORKSPACE_ID,
    sessionId: "wb-term-1a2b3c4d",
    title: "Terminal 1",
  },
} satisfies FakePanelSeed;

const chatPanel = {
  id: "chat-1",
  params: { kind: "chat", workspaceId: WORKSPACE_ID, sessionId: "s1" },
} satisfies FakePanelSeed;

const filePanel = {
  id: "file-1",
  params: { kind: "file", workspaceId: WORKSPACE_ID, path: "src/a.ts" },
} satisfies FakePanelSeed;

function singleGroup(panels: FakePanelSeed[]): FakeLayoutSeed {
  return { groups: [{ id: "g1", rect: FULL_RECT, panels }] };
}

function setUp(seed: FakeLayoutSeed = singleGroup([chatPanel])) {
  const layoutApi = createFakeLayoutApi(seed);
  const endTerminalSession = vi.fn();
  const controller = createWorkbenchDockviewController({
    layoutApi,
    workspaceId: WORKSPACE_ID,
    endTerminalSession,
    isMobile: false,
  });
  return { layoutApi, controller, endTerminalSession };
}

beforeEach(() => {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useContextSidebarStore.setState(
    useContextSidebarStore.getInitialState(),
    true,
  );
  useEditorStore.getState().closeAllFiles();
  useEditorStore.setState({ workspaceFileStates: {} });
  useChatStore.setState({ workspaceStates: {} });
});

describe("createWorkbenchDockviewController", () => {
  it("exposes the workspace it was created for", () => {
    // When
    const { controller } = setUp();

    // Then
    expect(controller.workspaceId).toBe(WORKSPACE_ID);
  });

  it("opens a file tab once and focuses it on the second request", () => {
    // Given
    const { layoutApi, controller } = setUp();
    const params = {
      kind: "file",
      workspaceId: WORKSPACE_ID,
      path: "src/lib/utils.ts",
    } satisfies WorkbenchTabParams;

    // When
    const firstPanelId = controller.openTab(params);
    layoutApi.activatePanel(chatPanel.id);
    const secondPanelId = controller.openTab(params);

    // Then
    expect(secondPanelId).toBe(firstPanelId);
    expect(layoutApi.getPanels()).toHaveLength(2);
    expect(layoutApi.getActivePanelId()).toBe(firstPanelId);
    expect(layoutApi.getTitle(firstPanelId)).toBe("utils.ts");
  });

  it("titles an opened chat tab with its chat-store session title", () => {
    // Given
    useChatStore.setState({
      workspaceStates: {
        [WORKSPACE_ID]: workspaceStateWithSessions([
          session("s2", "Fix the flaky test"),
        ]),
      },
    });
    const { layoutApi, controller } = setUp();

    // When
    const panelId = controller.openTab({
      kind: "chat",
      workspaceId: WORKSPACE_ID,
      sessionId: "s2",
    });

    // Then
    expect(layoutApi.getTitle(panelId)).toBe("Fix the flaky test");
  });

  it("opens a new terminal with a workbench session id and the next free title", () => {
    // Given
    const { layoutApi, controller } = setUp(
      singleGroup([chatPanel, terminalPanel]),
    );

    // When
    const panelId = controller.openNewTerminal();

    // Then
    const params = layoutApi.getPanel(panelId)?.params;
    expect(params).toEqual({
      kind: "terminal",
      workspaceId: WORKSPACE_ID,
      sessionId: expect.stringMatching(/^wb-term-[0-9a-f]{8}$/),
      title: "Terminal 2",
    });
    expect(layoutApi.getTitle(panelId)).toBe("Terminal 2");
    expect(layoutApi.getActivePanelId()).toBe(panelId);
  });

  it("opens a new terminal into the target group and drops that group's lone launcher", () => {
    // Given
    const { layoutApi, controller } = setUp({
      groups: [
        { id: "g1", rect: { ...FULL_RECT, width: 500 }, panels: [chatPanel] },
        {
          id: "g2",
          rect: { ...FULL_RECT, left: 500, width: 500 },
          panels: [
            {
              id: "launcher-1",
              params: { kind: "launcher", workspaceId: WORKSPACE_ID },
            },
          ],
        },
      ],
      activeGroupId: "g1",
    });

    // When
    const panelId = controller.openNewTerminal({ groupId: "g2" });

    // Then
    expect(layoutApi.getGroups().map((group) => group.panelIds)).toEqual([
      [chatPanel.id],
      [panelId],
    ]);
  });

  it("opens a fresh chat tab every time", () => {
    // Given
    const { layoutApi, controller } = setUp();

    // When
    const firstPanelId = controller.openNewChat();
    const secondPanelId = controller.openNewChat();

    // Then
    expect(secondPanelId).not.toBe(firstPanelId);
    expect(layoutApi.getPanel(secondPanelId)?.params).toEqual({
      kind: "chat",
      workspaceId: WORKSPACE_ID,
      sessionId: null,
    });
    expect(layoutApi.getTitle(secondPanelId)).toBe("New chat");
    expect(layoutApi.getPanels()).toHaveLength(3);
  });

  it("hands the keyboard focus to a new chat tab so its composer takes typing", () => {
    // Given
    const { controller } = setUp();

    // When
    const panelId = controller.openNewChat();

    // Then
    expect(useWorkbenchStore.getState().panelFocusRequest).toBe(panelId);
  });

  it("closes matching tabs through the close flow, ending terminal sessions", () => {
    // Given
    const { layoutApi, controller, endTerminalSession } = setUp(
      singleGroup([chatPanel, terminalPanel, filePanel]),
    );

    // When
    controller.closeTabs((params) => params.kind !== "chat");

    // Then
    expect(layoutApi.getPanels().map((panel) => panel.id)).toEqual([
      chatPanel.id,
    ]);
    expect(endTerminalSession).toHaveBeenCalledExactlyOnceWith({
      workspaceId: WORKSPACE_ID,
      sessionId: "wb-term-1a2b3c4d",
    });
  });

  it("focuses the last-focused tab of a kind", () => {
    // Given
    const otherChatPanel = {
      id: "chat-2",
      params: { kind: "chat", workspaceId: WORKSPACE_ID, sessionId: "s2" },
    } satisfies FakePanelSeed;
    const { layoutApi, controller } = setUp(
      singleGroup([chatPanel, otherChatPanel, filePanel]),
    );
    useWorkbenchStore.setState({
      lastFocusedPanelByWorkspace: {
        [WORKSPACE_ID]: {
          chat: { panelId: otherChatPanel.id, params: otherChatPanel.params },
        },
      },
    });
    layoutApi.activatePanel(filePanel.id);

    // When
    const isFocused = controller.focusMostRecent("chat");

    // Then
    expect(isFocused).toBe(true);
    expect(layoutApi.getActivePanelId()).toBe(otherChatPanel.id);
  });

  it("falls back to any open tab of the kind when the last-focused one is gone", () => {
    // Given
    const { layoutApi, controller } = setUp(
      singleGroup([filePanel, terminalPanel]),
    );
    useWorkbenchStore.setState({
      lastFocusedPanelByWorkspace: {
        [WORKSPACE_ID]: {
          terminal: {
            panelId: "closed-terminal",
            params: terminalPanel.params,
          },
        },
      },
    });
    layoutApi.activatePanel(filePanel.id);

    // When
    const isFocused = controller.focusMostRecent("terminal");

    // Then
    expect(isFocused).toBe(true);
    expect(layoutApi.getActivePanelId()).toBe(terminalPanel.id);
  });

  it("reports false when no tab of the kind is open", () => {
    // Given
    const { layoutApi, controller } = setUp(singleGroup([chatPanel]));

    // When
    const isFocused = controller.focusMostRecent("terminal");

    // Then
    expect(isFocused).toBe(false);
    expect(layoutApi.mutations).toEqual([]);
  });

  it("opens the requested context sidebar view", () => {
    // Given
    useContextSidebarStore.setState({ isOpen: false, view: "explorer" });
    const { controller } = setUp();

    // When
    controller.openContextSidebar("changes");

    // Then
    expect(useContextSidebarStore.getState()).toMatchObject({
      isOpen: true,
      view: "changes",
    });
  });

  it("reveals a folder by expanding it in the explorer view", () => {
    // Given
    useContextSidebarStore.setState({ isOpen: false, view: "status" });
    const { controller } = setUp();

    // When
    controller.revealFolder("src/lib");

    // Then
    expect([
      ...useEditorStore.getState().getExpandedPaths(WORKSPACE_ID),
    ]).toEqual(["src", "src/lib"]);
    expect(useContextSidebarStore.getState()).toMatchObject({
      isOpen: true,
      view: "explorer",
    });
  });
});
