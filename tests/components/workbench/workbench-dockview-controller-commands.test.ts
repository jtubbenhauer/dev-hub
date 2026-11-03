import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkbenchDockviewController } from "@/components/workbench/workbench-dockview-controller";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";

import {
  createFakeLayoutApi,
  type FakeLayoutSeed,
  type FakePanelSeed,
} from "../../lib/workbench/fake-layout-api";

const WORKSPACE_ID = "ws-1";

const chatPanel = {
  id: "chat-1",
  params: { kind: "chat", workspaceId: WORKSPACE_ID, sessionId: "s1" },
} satisfies FakePanelSeed;

const filePanel = {
  id: "file-1",
  params: { kind: "file", workspaceId: WORKSPACE_ID, path: "src/a.ts" },
} satisfies FakePanelSeed;

const terminalPanel = {
  id: "terminal-1",
  params: {
    kind: "terminal",
    workspaceId: WORKSPACE_ID,
    sessionId: "wb-term-1a2b3c4d",
    title: "Terminal 1",
  },
} satisfies FakePanelSeed;

const diffPanel = {
  id: "diff-1",
  params: {
    kind: "diff",
    workspaceId: WORKSPACE_ID,
    path: "src/a.ts",
    source: "working",
    baseRef: null,
  },
} satisfies FakePanelSeed;

// Left group: chat, file, terminal. Right group: one diff tab.
function twoGroupLayout(activePanelId: string): FakeLayoutSeed {
  return {
    groups: [
      {
        id: "left",
        rect: { left: 0, top: 0, width: 500, height: 1000 },
        panels: [chatPanel, filePanel, terminalPanel],
        activePanelId,
      },
      {
        id: "right",
        rect: { left: 500, top: 0, width: 500, height: 1000 },
        panels: [diffPanel],
      },
    ],
    activeGroupId: "left",
  };
}

interface SetUpOptions {
  readonly seed?: FakeLayoutSeed;
  readonly isMobile?: boolean;
}

function setUp({
  seed = twoGroupLayout(chatPanel.id),
  isMobile = false,
}: SetUpOptions = {}) {
  const layoutApi = createFakeLayoutApi(seed);
  const endTerminalSession = vi.fn();
  const controller = createWorkbenchDockviewController({
    layoutApi,
    workspaceId: WORKSPACE_ID,
    endTerminalSession,
    isMobile,
  });
  return { layoutApi, controller, endTerminalSession };
}

beforeEach(() => {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useEditorStore.getState().closeAllFiles();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WorkbenchController.runCommand", () => {
  it("cycles to the next tab of the focused group", () => {
    // Given
    const { layoutApi, controller } = setUp();

    // When
    controller.runCommand({ type: "cycle", direction: "next" });

    // Then
    expect(layoutApi.getActivePanelId()).toBe(filePanel.id);
  });

  it("cycles from the first tab back to the last one", () => {
    // Given
    const { layoutApi, controller } = setUp();

    // When
    controller.runCommand({ type: "cycle", direction: "previous" });

    // Then
    expect(layoutApi.getActivePanelId()).toBe(terminalPanel.id);
  });

  it("focuses tab N of the focused group", () => {
    // Given
    const { layoutApi, controller } = setUp();

    // When
    controller.runCommand({ type: "focus-number", n: 2 });

    // Then
    expect(layoutApi.getActivePanelId()).toBe(filePanel.id);
  });

  it("focuses the last tab of the focused group for tab 9", () => {
    // Given
    const { layoutApi, controller } = setUp();

    // When
    controller.runCommand({ type: "focus-number", n: 9 });

    // Then
    expect(layoutApi.getActivePanelId()).toBe(terminalPanel.id);
  });

  it("focuses the adjacent group", () => {
    // Given
    const { layoutApi, controller } = setUp();

    // When
    controller.runCommand({ type: "focus-group", direction: "right" });

    // Then
    expect(layoutApi.getActiveGroupId()).toBe("right");
    expect(layoutApi.getActivePanelId()).toBe(diffPanel.id);
  });

  it.each([
    { direction: "right" as const, isBeside: true },
    { direction: "below" as const, isBeside: false },
  ])(
    "splits the focused group $direction with a focused launcher",
    ({ direction, isBeside }) => {
      // Given
      const { layoutApi, controller } = setUp();

      // When
      controller.runCommand({ type: "split", direction });

      // Then
      const activePanel = layoutApi.getPanel(
        layoutApi.getActivePanelId() ?? "",
      );
      expect(activePanel?.params).toEqual({
        kind: "launcher",
        workspaceId: WORKSPACE_ID,
      });
      const newGroup = layoutApi
        .getGroups()
        .find((group) => group.id === activePanel?.groupId);
      expect(newGroup?.rect.left).toBe(isBeside ? 250 : 0);
      expect(newGroup?.rect.top).toBe(isBeside ? 0 : 500);
    },
  );

  it("moves the focused tab to the group on its right", () => {
    // Given
    const { layoutApi, controller } = setUp({
      seed: twoGroupLayout(filePanel.id),
    });

    // When
    controller.runCommand({ type: "move-tab", direction: "right" });

    // Then
    expect(layoutApi.getPanel(filePanel.id)?.groupId).toBe("right");
    expect(layoutApi.getActivePanelId()).toBe(filePanel.id);
  });

  it.each([
    {
      name: "split",
      command: { type: "split", direction: "right" } as const,
    },
    {
      name: "tab move",
      command: { type: "move-tab", direction: "right" } as const,
    },
  ])("ignores a $name on a phone", ({ command }) => {
    // Given
    const { layoutApi, controller } = setUp({ isMobile: true });

    // When
    controller.runCommand(command);

    // Then
    expect(layoutApi.mutations).toEqual([]);
  });

  it("closes the focused terminal tab and ends its session", () => {
    // Given
    const { layoutApi, controller, endTerminalSession } = setUp({
      seed: twoGroupLayout(terminalPanel.id),
    });

    // When
    controller.runCommand({ type: "close-active" });

    // Then
    expect(layoutApi.getPanel(terminalPanel.id)).toBeNull();
    expect(endTerminalSession).toHaveBeenCalledExactlyOnceWith({
      workspaceId: WORKSPACE_ID,
      sessionId: terminalPanel.params.sessionId,
    });
  });

  it("keeps the focused file tab when its unsaved changes are kept", () => {
    // Given
    useEditorStore.setState({
      openFiles: [
        {
          workspaceId: WORKSPACE_ID,
          path: filePanel.params.path,
          name: "a.ts",
          content: "edited",
          originalContent: "original",
          language: "typescript",
          isDirty: true,
        },
      ],
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { layoutApi, controller } = setUp({
      seed: twoGroupLayout(filePanel.id),
    });

    // When
    controller.runCommand({ type: "close-active" });

    // Then
    expect(layoutApi.getPanel(filePanel.id)).not.toBeNull();
  });

  it("closes nothing when no tab is focused", () => {
    // Given
    const { layoutApi, controller } = setUp({ seed: { groups: [] } });

    // When
    controller.runCommand({ type: "close-active" });

    // Then
    expect(layoutApi.mutations).toEqual([]);
  });
});

// dockview moves the active tab but never DOM focus, so every keyboard command
// that shows a tab asks that tab to take the keyboard focus.
describe("WorkbenchController.runCommand keyboard focus", () => {
  function focusRequestPanelId(): string | null {
    return useWorkbenchStore.getState().panelFocusRequest;
  }

  it("asks the active tab of the group it focuses for keyboard focus", () => {
    // Given
    const { controller } = setUp();

    // When
    controller.runCommand({ type: "focus-group", direction: "right" });

    // Then
    expect(focusRequestPanelId()).toBe(diffPanel.id);
  });

  it("asks the launcher of a new split for keyboard focus", () => {
    // Given
    const { layoutApi, controller } = setUp();

    // When
    controller.runCommand({ type: "split", direction: "right" });

    // Then
    const launcherPanel = layoutApi
      .getPanels()
      .find((panel) => panel.params.kind === "launcher");
    expect(focusRequestPanelId()).toBe(launcherPanel?.id);
  });

  it.each([
    {
      name: "cycle",
      command: { type: "cycle", direction: "next" } as const,
      focusedPanelId: filePanel.id,
    },
    {
      name: "tab number",
      command: { type: "focus-number", n: 3 } as const,
      focusedPanelId: terminalPanel.id,
    },
  ])(
    "asks the tab a $name shows for keyboard focus",
    ({ command, focusedPanelId }) => {
      // Given
      const { controller } = setUp();

      // When
      controller.runCommand(command);

      // Then
      expect(focusRequestPanelId()).toBe(focusedPanelId);
    },
  );

  it("asks a moved tab for keyboard focus in its new group", () => {
    // Given
    const { controller } = setUp({ seed: twoGroupLayout(filePanel.id) });

    // When
    controller.runCommand({ type: "move-tab", direction: "right" });

    // Then
    expect(focusRequestPanelId()).toBe(filePanel.id);
  });

  it("asks the tab shown after a close for keyboard focus", () => {
    // Given
    const { controller } = setUp({ seed: twoGroupLayout(terminalPanel.id) });

    // When
    controller.runCommand({ type: "close-active" });

    // Then
    expect(focusRequestPanelId()).toBe(filePanel.id);
  });

  it.each([
    {
      name: "there is no group on that side",
      command: { type: "focus-group", direction: "left" } as const,
    },
    {
      name: "the group has no tab N",
      command: { type: "focus-number", n: 5 } as const,
    },
  ])("leaves keyboard focus alone when $name", ({ command }) => {
    // Given
    const { controller } = setUp();

    // When
    controller.runCommand(command);

    // Then
    expect(focusRequestPanelId()).toBeNull();
  });

  it("leaves keyboard focus alone when a dirty tab is kept open", () => {
    // Given
    useEditorStore.setState({
      openFiles: [
        {
          workspaceId: WORKSPACE_ID,
          path: filePanel.params.path,
          name: "a.ts",
          content: "edited",
          originalContent: "original",
          language: "typescript",
          isDirty: true,
        },
      ],
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { controller } = setUp({ seed: twoGroupLayout(filePanel.id) });

    // When
    controller.runCommand({ type: "close-active" });

    // Then
    expect(focusRequestPanelId()).toBeNull();
  });

  it("leaves keyboard focus alone for a split on a phone", () => {
    // Given
    const { controller } = setUp({ isMobile: true });

    // When
    controller.runCommand({ type: "split", direction: "right" });

    // Then
    expect(focusRequestPanelId()).toBeNull();
  });
});
