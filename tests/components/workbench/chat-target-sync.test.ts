import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  startChatTargetSync,
  syncGlobalChatSessionToTab,
} from "@/components/workbench/chat-target-sync";
import type { Session } from "@/lib/opencode/types";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

import {
  createFakeLayoutApi,
  type FakeLayoutApi,
} from "../../lib/workbench/fake-layout-api";

const WORKSPACE_ID = "w1";
const OTHER_WORKSPACE_ID = "w2";

function chatParams(sessionId: string | null): WorkbenchTabParams {
  return { kind: "chat", workspaceId: WORKSPACE_ID, sessionId };
}

// "tab-focused" (s1) is the active panel of the left group; "tab-new" (no
// session yet) sits in the right group.
function createTwoChatLayout(): FakeLayoutApi {
  return createFakeLayoutApi({
    groups: [
      {
        id: "left",
        rect: { left: 0, top: 0, width: 500, height: 1000 },
        panels: [{ id: "tab-focused", params: chatParams("s1") }],
      },
      {
        id: "right",
        rect: { left: 500, top: 0, width: 500, height: 1000 },
        panels: [{ id: "tab-new", params: chatParams(null) }],
      },
    ],
    activeGroupId: "left",
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

const stopSyncs: (() => void)[] = [];

function startSync(layoutApi: FakeLayoutApi): () => void {
  const stopSync = startChatTargetSync({
    layoutApi,
    workspaceId: WORKSPACE_ID,
  });
  stopSyncs.push(stopSync);
  return stopSync;
}

function panelIdsShowing(layoutApi: FakeLayoutApi, sessionId: string) {
  return layoutApi
    .getPanels()
    .filter(
      (panel) =>
        panel.params.kind === "chat" && panel.params.sessionId === sessionId,
    )
    .map((panel) => panel.id);
}

beforeEach(() => {
  localStorage.clear();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkspaceStore.setState({ activeWorkspaceId: WORKSPACE_ID });
  useChatStore.setState({
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: "s1",
    streamingError: null,
    workspaceStates: {
      [WORKSPACE_ID]: loadedWorkspaceState(["s1", "s2", "s3"]),
    },
  });
});

afterEach(() => {
  for (const stopSync of stopSyncs.splice(0)) stopSync();
});

describe("startChatTargetSync", () => {
  it("opens a target queued before the layout became ready", () => {
    // Given
    const layoutApi = createTwoChatLayout();
    useWorkbenchStore.getState().requestChatTarget({
      workspaceId: WORKSPACE_ID,
      sessionId: "s2",
      panelId: null,
    });
    useWorkbenchStore.getState().setLayoutReadyWorkspaceId(WORKSPACE_ID);

    // When
    startSync(layoutApi);

    // Then
    const [openedPanelId] = panelIdsShowing(layoutApi, "s2");
    expect(layoutApi.getActivePanelId()).toBe(openedPanelId);
    expect(useWorkbenchStore.getState().pendingChatTarget).toBeNull();
  });

  it("applies a target requested while the layout is ready", () => {
    // Given
    const layoutApi = createTwoChatLayout();
    useWorkbenchStore.getState().setLayoutReadyWorkspaceId(WORKSPACE_ID);
    startSync(layoutApi);

    // When
    useWorkbenchStore.getState().requestChatTarget({
      workspaceId: WORKSPACE_ID,
      sessionId: "s2",
      panelId: "tab-new",
    });

    // Then
    expect(layoutApi.getPanel("tab-new")?.params).toEqual(chatParams("s2"));
    expect(useWorkbenchStore.getState().pendingChatTarget).toBeNull();
  });

  it("keeps a target for another workspace queued", () => {
    // Given
    const layoutApi = createTwoChatLayout();
    useWorkbenchStore.getState().setLayoutReadyWorkspaceId(WORKSPACE_ID);
    startSync(layoutApi);
    const otherWorkspaceTarget = {
      workspaceId: OTHER_WORKSPACE_ID,
      sessionId: "s7",
      panelId: null,
    };

    // When
    useWorkbenchStore.getState().requestChatTarget(otherWorkspaceTarget);

    // Then
    expect(layoutApi.mutations).toEqual([]);
    expect(useWorkbenchStore.getState().pendingChatTarget).toEqual(
      otherWorkspaceTarget,
    );
  });

  it("waits for its layout to be ready before applying a target", () => {
    // Given
    const layoutApi = createTwoChatLayout();
    startSync(layoutApi);
    useWorkbenchStore.getState().requestChatTarget({
      workspaceId: WORKSPACE_ID,
      sessionId: "s2",
      panelId: null,
    });
    expect(layoutApi.mutations).toEqual([]);

    // When
    useWorkbenchStore.getState().setLayoutReadyWorkspaceId(WORKSPACE_ID);

    // Then
    expect(panelIdsShowing(layoutApi, "s2")).toHaveLength(1);
    expect(useWorkbenchStore.getState().pendingChatTarget).toBeNull();
  });

  it("points the global session back at the focused tab after a background tab's createSession", () => {
    // Given: createSession made the background tab's new session global.
    const layoutApi = createTwoChatLayout();
    useWorkbenchStore.getState().setLayoutReadyWorkspaceId(WORKSPACE_ID);
    startSync(layoutApi);
    useChatStore.setState({ activeSessionId: "s3" });

    // When
    useWorkbenchStore.getState().requestChatTarget({
      workspaceId: WORKSPACE_ID,
      sessionId: "s3",
      panelId: "tab-new",
    });

    // Then
    expect(layoutApi.getPanel("tab-new")?.params).toEqual(chatParams("s3"));
    expect(layoutApi.getActivePanelId()).toBe("tab-focused");
    expect(useChatStore.getState().activeSessionId).toBe("s1");
  });

  it("stops applying targets once disposed", () => {
    // Given
    const layoutApi = createTwoChatLayout();
    useWorkbenchStore.getState().setLayoutReadyWorkspaceId(WORKSPACE_ID);
    const stopSync = startSync(layoutApi);
    stopSync();
    const target = {
      workspaceId: WORKSPACE_ID,
      sessionId: "s2",
      panelId: null,
    };

    // When
    useWorkbenchStore.getState().requestChatTarget(target);

    // Then
    expect(layoutApi.mutations).toEqual([]);
    expect(useWorkbenchStore.getState().pendingChatTarget).toEqual(target);
  });
});

describe("syncGlobalChatSessionToTab", () => {
  it("makes the tab's session and workspace the global chat session", () => {
    // Given
    useChatStore.setState({
      activeWorkspaceId: OTHER_WORKSPACE_ID,
      activeSessionId: "s9",
    });

    // When
    syncGlobalChatSessionToTab(WORKSPACE_ID, "s2");

    // Then
    expect(useChatStore.getState().activeWorkspaceId).toBe(WORKSPACE_ID);
    expect(useChatStore.getState().activeSessionId).toBe("s2");
  });

  it("clears the global session and the previous chat's error for a new-chat tab", () => {
    // Given
    useChatStore.setState({ streamingError: "previous chat failed" });

    // When
    syncGlobalChatSessionToTab(WORKSPACE_ID, null);

    // Then
    expect(useChatStore.getState().activeSessionId).toBeNull();
    expect(useChatStore.getState().streamingError).toBeNull();
  });

  it("treats a session the loaded list lacks as no session", () => {
    // When
    syncGlobalChatSessionToTab(WORKSPACE_ID, "s-deleted");

    // Then
    expect(useChatStore.getState().activeSessionId).toBeNull();
  });

  it("leaves the global session alone while another workspace is active", () => {
    // Given
    useWorkspaceStore.setState({ activeWorkspaceId: OTHER_WORKSPACE_ID });
    const chatStateBefore = useChatStore.getState();

    // When
    syncGlobalChatSessionToTab(WORKSPACE_ID, "s2");

    // Then
    expect(useChatStore.getState()).toBe(chatStateBefore);
  });
});
