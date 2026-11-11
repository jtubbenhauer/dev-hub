import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeChatTarget,
  resyncGlobalChatSession,
} from "@/components/workbench/consume-chat-target";
import type { Session } from "@/lib/opencode/types";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";
import {
  selectLastFocusedChatSessionId,
  useWorkbenchStore,
  type PendingChatTarget,
} from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

import {
  createFakeLayoutApi,
  type FakeLayoutApi,
  type FakePanelSeed,
} from "../../lib/workbench/fake-layout-api";

const WORKSPACE_ID = "w1";
const OTHER_WORKSPACE_ID = "w2";
const LEFT_RECT = { left: 0, top: 0, width: 500, height: 1000 };
const RIGHT_RECT = { left: 500, top: 0, width: 500, height: 1000 };

function chatParams(sessionId: string | null): WorkbenchTabParams {
  return { kind: "chat", workspaceId: WORKSPACE_ID, sessionId };
}

function chatPanel(id: string, sessionId: string | null): FakePanelSeed {
  return { id, params: chatParams(sessionId) };
}

const terminalPanel: FakePanelSeed = {
  id: "terminal-1",
  params: {
    kind: "terminal",
    workspaceId: WORKSPACE_ID,
    sessionId: "wb-term-1a2b3c4d",
    title: "Terminal 1",
  },
};

function twoGroupLayout(
  leftPanel: FakePanelSeed,
  rightPanel: FakePanelSeed,
  activeGroupId: "left" | "right",
): FakeLayoutApi {
  return createFakeLayoutApi({
    groups: [
      { id: "left", rect: LEFT_RECT, panels: [leftPanel] },
      { id: "right", rect: RIGHT_RECT, panels: [rightPanel] },
    ],
    activeGroupId,
  });
}

function session(id: string): Session {
  return {
    id,
    projectID: "project",
    directory: "/workspace",
    title: `Chat ${id}`,
    version: "1",
    time: { created: 1_000, updated: 1_000 },
  };
}

function loadedWorkspaceState(sessionIds: readonly string[]): WorkspaceState {
  return {
    sessions: Object.fromEntries(sessionIds.map((id) => [id, session(id)])),
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

function titleFor(target: PendingChatTarget): string {
  return `Title of ${target.sessionId}`;
}

function requestTarget(target: PendingChatTarget): void {
  useWorkbenchStore.getState().requestChatTarget(target);
}

function consume(layoutApi: FakeLayoutApi): string | null {
  return consumeChatTarget(
    layoutApi,
    useWorkbenchStore.getState(),
    WORKSPACE_ID,
    titleFor,
  );
}

function resync(layoutApi: FakeLayoutApi): void {
  resyncGlobalChatSession(layoutApi, WORKSPACE_ID, useChatStore.getState());
}

beforeEach(() => {
  localStorage.clear();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkspaceStore.setState({ activeWorkspaceId: WORKSPACE_ID });
  useChatStore.setState({
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: null,
    streamingError: null,
    workspaceStates: {},
  });
});

describe("consumeChatTarget", () => {
  it("focuses the tab that already shows the session", () => {
    // Given
    const layoutApi = twoGroupLayout(
      chatPanel("tab-left", "s1"),
      chatPanel("tab-right", "s2"),
      "left",
    );
    requestTarget({
      workspaceId: WORKSPACE_ID,
      sessionId: "s2",
      panelId: "tab-left",
    });

    // When
    const panelId = consume(layoutApi);

    // Then
    expect(panelId).toBe("tab-right");
    expect(layoutApi.getActivePanelId()).toBe("tab-right");
    expect(layoutApi.getPanel("tab-left")?.params).toEqual(chatParams("s1"));
    expect(layoutApi.mutations).toEqual(["activatePanel"]);
    expect(useWorkbenchStore.getState().pendingChatTarget).toBeNull();
  });

  it("retargets the named tab without changing the active panel", () => {
    // Given
    const layoutApi = twoGroupLayout(
      chatPanel("tab-left", "s1"),
      chatPanel("tab-right", null),
      "left",
    );
    requestTarget({
      workspaceId: WORKSPACE_ID,
      sessionId: "s3",
      panelId: "tab-right",
    });

    // When
    const panelId = consume(layoutApi);

    // Then
    expect(panelId).toBe("tab-right");
    expect(layoutApi.getPanel("tab-right")?.params).toEqual(chatParams("s3"));
    expect(layoutApi.getTitle("tab-right")).toBe("Title of s3");
    expect(layoutApi.getActivePanelId()).toBe("tab-left");
    expect(layoutApi.mutations).toEqual(["updatePanelParams"]);
  });

  it("opens a new chat tab when no tab matches", () => {
    // Given
    const layoutApi = twoGroupLayout(
      chatPanel("tab-left", "s1"),
      terminalPanel,
      "left",
    );
    requestTarget({
      workspaceId: WORKSPACE_ID,
      sessionId: "s4",
      panelId: null,
    });

    // When
    const panelId = consume(layoutApi);

    // Then
    expect(panelId).not.toBeNull();
    expect(layoutApi.getActivePanelId()).toBe(panelId);
    expect(layoutApi.getPanel(panelId ?? "")?.params).toEqual(chatParams("s4"));
    expect(layoutApi.getTitle(panelId ?? "")).toBe("Title of s4");
    expect(layoutApi.mutations).toEqual(["addPanel"]);
  });

  it("leaves a target for another workspace queued", () => {
    // Given
    const layoutApi = twoGroupLayout(
      chatPanel("tab-left", "s1"),
      chatPanel("tab-right", null),
      "left",
    );
    const otherWorkspaceTarget = {
      workspaceId: OTHER_WORKSPACE_ID,
      sessionId: "s5",
      panelId: null,
    };
    requestTarget(otherWorkspaceTarget);

    // When
    const panelId = consume(layoutApi);

    // Then
    expect(panelId).toBeNull();
    expect(layoutApi.mutations).toEqual([]);
    expect(useWorkbenchStore.getState().pendingChatTarget).toEqual(
      otherWorkspaceTarget,
    );
  });

  it("does nothing when no target is pending", () => {
    // Given
    const layoutApi = twoGroupLayout(
      chatPanel("tab-left", "s1"),
      chatPanel("tab-right", null),
      "left",
    );

    // When
    const panelId = consume(layoutApi);

    // Then
    expect(panelId).toBeNull();
    expect(layoutApi.mutations).toEqual([]);
  });

  it("records the retargeted session on the last-focused chat tab", () => {
    // Given
    const layoutApi = twoGroupLayout(
      chatPanel("tab-left", "s1"),
      chatPanel("tab-right", null),
      "left",
    );
    useWorkbenchStore.getState().setFocusedPanel({
      workspaceId: WORKSPACE_ID,
      panelId: "tab-right",
      params: chatParams(null),
    });
    requestTarget({
      workspaceId: WORKSPACE_ID,
      sessionId: "s3",
      panelId: "tab-right",
    });

    // When
    consume(layoutApi);

    // Then
    expect(
      selectLastFocusedChatSessionId(
        useWorkbenchStore.getState(),
        WORKSPACE_ID,
      ),
    ).toBe("s3");
    expect(useWorkbenchStore.getState().focusedPanel?.params).toEqual(
      chatParams("s3"),
    );
  });
});

describe("resyncGlobalChatSession", () => {
  it("points the global session back at the focused tab after a background retarget, keeping its error", () => {
    // Given: createSession in the background tab moved the global session.
    const layoutApi = twoGroupLayout(
      chatPanel("tab-left", "s1"),
      chatPanel("tab-right", "s3"),
      "left",
    );
    useChatStore.setState({
      activeSessionId: "s3",
      streamingError: "focused chat failed",
    });

    // When
    resync(layoutApi);

    // Then
    expect(useChatStore.getState().activeWorkspaceId).toBe(WORKSPACE_ID);
    expect(useChatStore.getState().activeSessionId).toBe("s1");
    expect(useChatStore.getState().streamingError).toBe("focused chat failed");
  });

  it("switches the global workspace too when it points at another workspace", () => {
    // Given
    const layoutApi = twoGroupLayout(
      chatPanel("tab-left", "s1"),
      chatPanel("tab-right", "s3"),
      "left",
    );
    useChatStore.setState({
      activeWorkspaceId: OTHER_WORKSPACE_ID,
      activeSessionId: "s9",
    });

    // When
    resync(layoutApi);

    // Then
    expect(useChatStore.getState().activeWorkspaceId).toBe(WORKSPACE_ID);
    expect(useChatStore.getState().activeSessionId).toBe("s1");
  });

  it("clears the global session when the focused chat tab has none", () => {
    // Given
    const layoutApi = twoGroupLayout(
      chatPanel("tab-left", null),
      chatPanel("tab-right", "s3"),
      "left",
    );
    useChatStore.setState({ activeSessionId: "s3" });

    // When
    resync(layoutApi);

    // Then
    expect(useChatStore.getState().activeSessionId).toBeNull();
  });

  it("clears the global session when the focused tab's session is known to be missing", () => {
    // Given
    const layoutApi = twoGroupLayout(
      chatPanel("tab-left", "s-deleted"),
      chatPanel("tab-right", "s3"),
      "left",
    );
    useChatStore.setState({
      activeSessionId: "s3",
      workspaceStates: { [WORKSPACE_ID]: loadedWorkspaceState(["s3"]) },
    });

    // When
    resync(layoutApi);

    // Then
    expect(useChatStore.getState().activeSessionId).toBeNull();
  });

  it("changes nothing when the global session already matches the focused tab", () => {
    // Given
    const layoutApi = twoGroupLayout(
      chatPanel("tab-left", "s1"),
      chatPanel("tab-right", "s3"),
      "left",
    );
    useChatStore.setState({ activeSessionId: "s1" });
    const chatStateBefore = useChatStore.getState();

    // When
    resync(layoutApi);

    // Then
    expect(useChatStore.getState()).toBe(chatStateBefore);
  });

  it("changes nothing when the focused tab is not a chat", () => {
    // Given
    const layoutApi = twoGroupLayout(
      terminalPanel,
      chatPanel("tab-right", "s3"),
      "left",
    );
    useChatStore.setState({ activeSessionId: "s3" });
    const chatStateBefore = useChatStore.getState();

    // When
    resync(layoutApi);

    // Then
    expect(useChatStore.getState()).toBe(chatStateBefore);
  });

  it("changes nothing while another workspace is active", () => {
    // Given: the layout is being replaced by the other workspace's.
    const layoutApi = twoGroupLayout(
      chatPanel("tab-left", "s1"),
      chatPanel("tab-right", "s3"),
      "left",
    );
    useWorkspaceStore.setState({ activeWorkspaceId: OTHER_WORKSPACE_ID });
    useChatStore.setState({ activeSessionId: "s3" });
    const chatStateBefore = useChatStore.getState();

    // When
    resync(layoutApi);

    // Then
    expect(useChatStore.getState()).toBe(chatStateBefore);
  });
});
