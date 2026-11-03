import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestCloseTab } from "@/components/workbench/workbench-close-tab";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import type { OpenFile } from "@/types";

import {
  createFakeLayoutApi,
  type FakePanelSeed,
} from "../../lib/workbench/fake-layout-api";

const WORKSPACE_ID = "ws-1";
const OTHER_WORKSPACE_ID = "ws-2";
const FULL_RECT = { left: 0, top: 0, width: 1000, height: 1000 };

const filePanel = {
  id: "file-a",
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

const chatParams = {
  kind: "chat",
  workspaceId: WORKSPACE_ID,
  sessionId: "s1",
} satisfies WorkbenchTabParams;

const chatPanel = { id: "chat-1", params: chatParams } satisfies FakePanelSeed;

function layoutWith(panels: FakePanelSeed[]) {
  return createFakeLayoutApi({
    groups: [{ id: "g1", rect: FULL_RECT, panels }],
  });
}

function buffer(overrides: Partial<OpenFile>): OpenFile {
  return {
    workspaceId: WORKSPACE_ID,
    path: "src/a.ts",
    name: "a.ts",
    content: "edited",
    language: "typescript",
    isDirty: false,
    originalContent: "edited",
    ...overrides,
  };
}

function panelIds(layoutApi: ReturnType<typeof layoutWith>): string[] {
  return layoutApi.getPanels().map((panel) => panel.id);
}

beforeEach(() => {
  useEditorStore.getState().closeAllFiles();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestCloseTab", () => {
  it("keeps a dirty file tab and its buffer when the discard confirm is cancelled", () => {
    // Given
    const layoutApi = layoutWith([filePanel, chatPanel]);
    useEditorStore.setState({ openFiles: [buffer({ isDirty: true })] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    // When
    const isClosed = requestCloseTab({
      layoutApi,
      panelId: filePanel.id,
      endTerminalSession: vi.fn(),
    });

    // Then
    expect(isClosed).toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("a.ts"));
    expect(panelIds(layoutApi)).toEqual([filePanel.id, chatPanel.id]);
    expect(useEditorStore.getState().openFiles).toHaveLength(1);
  });

  it("discards the buffer and removes a dirty file tab when the confirm is accepted", () => {
    // Given
    const layoutApi = layoutWith([filePanel, chatPanel]);
    useEditorStore.setState({ openFiles: [buffer({ isDirty: true })] });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    // When
    const isClosed = requestCloseTab({
      layoutApi,
      panelId: filePanel.id,
      endTerminalSession: vi.fn(),
    });

    // Then
    expect(isClosed).toBe(true);
    expect(panelIds(layoutApi)).toEqual([chatPanel.id]);
    expect(useEditorStore.getState().openFiles).toEqual([]);
  });

  it("closes a clean file tab and its buffer without asking", () => {
    // Given
    const layoutApi = layoutWith([filePanel, chatPanel]);
    useEditorStore.setState({ openFiles: [buffer({ isDirty: false })] });
    const confirmSpy = vi.spyOn(window, "confirm");

    // When
    requestCloseTab({
      layoutApi,
      panelId: filePanel.id,
      endTerminalSession: vi.fn(),
    });

    // Then
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(panelIds(layoutApi)).toEqual([chatPanel.id]);
    expect(useEditorStore.getState().openFiles).toEqual([]);
  });

  it("leaves another workspace's dirty buffer for the same path alone", () => {
    // Given
    const layoutApi = layoutWith([filePanel, chatPanel]);
    const foreignBuffer = buffer({
      workspaceId: OTHER_WORKSPACE_ID,
      isDirty: true,
    });
    useEditorStore.setState({ openFiles: [foreignBuffer] });
    const confirmSpy = vi.spyOn(window, "confirm");

    // When
    requestCloseTab({
      layoutApi,
      panelId: filePanel.id,
      endTerminalSession: vi.fn(),
    });

    // Then
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(panelIds(layoutApi)).toEqual([chatPanel.id]);
    expect(useEditorStore.getState().openFiles).toEqual([foreignBuffer]);
  });

  it("ends the terminal session with the panel's ids before removing the tab", () => {
    // Given
    const layoutApi = layoutWith([terminalPanel, chatPanel]);
    const endTerminalSession = vi.fn();

    // When
    requestCloseTab({
      layoutApi,
      panelId: terminalPanel.id,
      endTerminalSession,
    });

    // Then
    expect(endTerminalSession).toHaveBeenCalledExactlyOnceWith({
      workspaceId: WORKSPACE_ID,
      sessionId: "wb-term-1a2b3c4d",
    });
    expect(panelIds(layoutApi)).toEqual([chatPanel.id]);
  });

  it("only removes a chat tab", () => {
    // Given
    const layoutApi = layoutWith([filePanel, chatPanel]);
    useEditorStore.setState({ openFiles: [buffer({ isDirty: true })] });
    const endTerminalSession = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm");

    // When
    const isClosed = requestCloseTab({
      layoutApi,
      panelId: chatPanel.id,
      endTerminalSession,
    });

    // Then
    expect(isClosed).toBe(true);
    expect(panelIds(layoutApi)).toEqual([filePanel.id]);
    expect(endTerminalSession).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(useEditorStore.getState().openFiles).toHaveLength(1);
  });

  it("forgets the closed panel's last-focused entry", () => {
    // Given
    const layoutApi = layoutWith([filePanel, chatPanel]);
    useWorkbenchStore.setState({
      lastFocusedPanelByWorkspace: {
        [WORKSPACE_ID]: { chat: { panelId: chatPanel.id, params: chatParams } },
      },
    });

    // When
    requestCloseTab({
      layoutApi,
      panelId: chatPanel.id,
      endTerminalSession: vi.fn(),
    });

    // Then
    expect(
      useWorkbenchStore.getState().lastFocusedPanelByWorkspace[WORKSPACE_ID],
    ).toEqual({});
  });

  it("does nothing for a panel that is no longer in the layout", () => {
    // Given
    const layoutApi = layoutWith([chatPanel]);

    // When
    const isClosed = requestCloseTab({
      layoutApi,
      panelId: "tab-gone",
      endTerminalSession: vi.fn(),
    });

    // Then
    expect(isClosed).toBe(false);
    expect(layoutApi.mutations).toEqual([]);
  });
});
