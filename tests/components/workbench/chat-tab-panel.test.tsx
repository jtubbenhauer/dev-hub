import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { DockviewReact, type DockviewApi } from "dockview-react";

import type { ChatInterfaceProps } from "@/components/chat/chat-interface";
import { ChatTabPanel } from "@/components/workbench/tabs/chat-tab-panel";
import type { Session } from "@/lib/opencode/types";
import type { OpenWorkspaceTabInWorkbenchInput } from "@/lib/workbench/open-in-workbench";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import { WORKBENCH_PATH } from "@/lib/workbench/workbench-href";
import {
  _resetModuleCaches,
  useChatStore,
  type WorkspaceState,
} from "@/stores/chat-store";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const { latestChatProps, openNewChatInWorkbenchMock, routerPushMock } =
  vi.hoisted(() => ({
    latestChatProps: new Map<string, ChatInterfaceProps>(),
    openNewChatInWorkbenchMock:
      vi.fn<(input: OpenWorkspaceTabInWorkbenchInput) => void>(),
    routerPushMock: vi.fn<(href: string) => void>(),
  }));

vi.mock("@/components/chat/chat-interface", () => ({
  ChatInterface: (props: ChatInterfaceProps) => {
    latestChatProps.set(props.tabId, props);
    return <div data-testid={`chat-${props.tabId}`} />;
  },
}));

vi.mock("@/lib/workbench/open-in-workbench", () => ({
  openNewChatInWorkbench: openNewChatInWorkbenchMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
}));

const WORKSPACE_ID = "w1";
const OTHER_WORKSPACE_ID = "w2";
const LEFT_TAB = "tab-left";
const RIGHT_TAB = "tab-right";

const initialChatState = useChatStore.getState();
const initialWorkspaceState = useWorkspaceStore.getState();

function chatParams(sessionId: string | null): WorkbenchTabParams {
  return { kind: "chat", workspaceId: WORKSPACE_ID, sessionId };
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

function setLoadedSessions(sessionIds: readonly string[]): void {
  useChatStore.setState({
    workspaceStates: { [WORKSPACE_ID]: loadedWorkspaceState(sessionIds) },
  });
}

interface ChatTabsSetup {
  readonly leftSessionId: string | null;
  readonly rightSessionId: string | null;
}

// Two chat tabs side by side; the right one is added last, so it is focused.
function renderChatTabs(setup: ChatTabsSetup) {
  const readyApis: DockviewApi[] = [];
  const updateParametersSpies: MockInstance[] = [];
  render(
    <div style={{ width: 800, height: 600 }}>
      <DockviewReact
        components={{ chat: ChatTabPanel }}
        onReady={(event) => {
          const leftPanel = event.api.addPanel({
            id: LEFT_TAB,
            component: "chat",
            params: chatParams(setup.leftSessionId),
            title: LEFT_TAB,
          });
          const rightPanel = event.api.addPanel({
            id: RIGHT_TAB,
            component: "chat",
            params: chatParams(setup.rightSessionId),
            title: RIGHT_TAB,
            position: { referencePanel: LEFT_TAB, direction: "right" },
          });
          // Spied before the panel bodies mount, so a mount-time rewrite counts.
          for (const panel of [leftPanel, rightPanel]) {
            updateParametersSpies.push(vi.spyOn(panel.api, "updateParameters"));
          }
          readyApis.push(event.api);
        }}
      />
    </div>,
  );
  const [api] = readyApis;
  if (!api) throw new Error("DockviewReact never fired onReady");
  return { api, updateParametersSpies };
}

function chatPropsOf(tabId: string): ChatInterfaceProps {
  const props = latestChatProps.get(tabId);
  if (!props) throw new Error(`ChatInterface never rendered for ${tabId}`);
  return props;
}

function panelSessionId(api: DockviewApi, tabId: string): unknown {
  const params: unknown = api.getPanel(tabId)?.params;
  if (typeof params !== "object" || params === null) return undefined;
  return "sessionId" in params ? params.sessionId : undefined;
}

beforeEach(() => {
  localStorage.clear();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useNewChatEngineStore.setState({ engineByWorkspace: {} });
  useWorkspaceStore.setState({ activeWorkspaceId: WORKSPACE_ID });
  useChatStore.setState({
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: null,
    workspaceStates: {},
  });
});

afterEach(() => {
  cleanup();
  latestChatProps.clear();
  openNewChatInWorkbenchMock.mockClear();
  routerPushMock.mockClear();
  useChatStore.setState(initialChatState, true);
  useWorkspaceStore.setState(initialWorkspaceState, true);
  _resetModuleCaches();
});

describe("ChatTabPanel", () => {
  it("gives each chat its own panel focus, visibility and last-focused state", () => {
    // Given
    useWorkbenchStore.getState().setFocusedPanel({
      workspaceId: WORKSPACE_ID,
      panelId: LEFT_TAB,
      params: chatParams("s1"),
    });

    // When
    renderChatTabs({ leftSessionId: "s1", rightSessionId: "s2" });

    // Then
    expect(chatPropsOf(LEFT_TAB)).toMatchObject({
      tabId: LEFT_TAB,
      workspaceId: WORKSPACE_ID,
      sessionId: "s1",
      isFocused: false,
      isVisible: true,
      isLastFocusedChat: true,
    });
    expect(chatPropsOf(RIGHT_TAB)).toMatchObject({
      tabId: RIGHT_TAB,
      sessionId: "s2",
      isFocused: true,
      isVisible: true,
      isLastFocusedChat: false,
    });
  });

  it("moves the focused state to the tab that becomes active", () => {
    // Given
    const { api } = renderChatTabs({
      leftSessionId: "s1",
      rightSessionId: "s2",
    });

    // When
    act(() => api.getPanel(LEFT_TAB)?.api.setActive());

    // Then
    expect(chatPropsOf(LEFT_TAB).isFocused).toBe(true);
    expect(chatPropsOf(RIGHT_TAB).isFocused).toBe(false);
  });

  it("asks to show a session picked in a tab in that same tab", () => {
    // Given
    renderChatTabs({ leftSessionId: "s1", rightSessionId: "s2" });

    // When
    act(() => chatPropsOf(LEFT_TAB).onSessionChosen?.(WORKSPACE_ID, "s5"));

    // Then
    expect(useWorkbenchStore.getState().pendingChatTarget).toEqual({
      workspaceId: WORKSPACE_ID,
      sessionId: "s5",
      panelId: LEFT_TAB,
    });
  });

  it("never retargets the tab for a session of another workspace", () => {
    // Given
    renderChatTabs({ leftSessionId: "s1", rightSessionId: "s2" });

    // When
    act(() =>
      chatPropsOf(LEFT_TAB).onSessionChosen?.(OTHER_WORKSPACE_ID, "s6"),
    );

    // Then
    expect(useWorkbenchStore.getState().pendingChatTarget).toEqual({
      workspaceId: OTHER_WORKSPACE_ID,
      sessionId: "s6",
      panelId: null,
    });
  });

  it("shows an empty chat for a session the loaded list lacks, without rewriting the tab", () => {
    // Given
    setLoadedSessions(["s1"]);

    // When
    const { api, updateParametersSpies } = renderChatTabs({
      leftSessionId: "s1",
      rightSessionId: "s9",
    });

    // Then
    expect(chatPropsOf(RIGHT_TAB).sessionId).toBeNull();
    expect(panelSessionId(api, RIGHT_TAB)).toBe("s9");
    for (const spy of updateParametersSpies) expect(spy).not.toHaveBeenCalled();
  });

  it("shows the session again when an undone delete restores it", () => {
    // Given
    setLoadedSessions(["s1", "s9"]);
    const snapshot = useChatStore
      .getState()
      .removeSessionLocal("s9", WORKSPACE_ID);
    if (!snapshot) throw new Error("expected a delete snapshot for s9");
    renderChatTabs({ leftSessionId: "s1", rightSessionId: "s9" });
    expect(chatPropsOf(RIGHT_TAB).sessionId).toBeNull();

    // When
    act(() => useChatStore.getState().restoreSessionLocal(snapshot));

    // Then
    expect(chatPropsOf(RIGHT_TAB).sessionId).toBe("s9");
  });

  it("shows the session once the live list includes it after a cached one", () => {
    // Given
    setLoadedSessions(["s1"]);
    const { updateParametersSpies } = renderChatTabs({
      leftSessionId: "s1",
      rightSessionId: "s9",
    });

    // When
    act(() => setLoadedSessions(["s1", "s9"]));

    // Then
    expect(chatPropsOf(RIGHT_TAB).sessionId).toBe("s9");
    for (const spy of updateParametersSpies) expect(spy).not.toHaveBeenCalled();
  });

  it("makes the focused tab's reappearing session the global session", () => {
    // Given
    setLoadedSessions(["s1"]);
    renderChatTabs({ leftSessionId: "s1", rightSessionId: "s9" });

    // When
    act(() => setLoadedSessions(["s1", "s9"]));

    // Then
    expect(useChatStore.getState().activeWorkspaceId).toBe(WORKSPACE_ID);
    expect(useChatStore.getState().activeSessionId).toBe("s9");
  });

  it("leaves the global session alone when an unfocused tab's session reappears", () => {
    // Given
    setLoadedSessions(["s2"]);
    useChatStore.setState({ activeSessionId: "s2" });
    renderChatTabs({ leftSessionId: "s1", rightSessionId: "s2" });

    // When
    act(() => setLoadedSessions(["s1", "s2"]));

    // Then
    expect(chatPropsOf(LEFT_TAB).sessionId).toBe("s1");
    expect(useChatStore.getState().activeSessionId).toBe("s2");
  });

  it("opens a new chat in another workspace with the picked engine", () => {
    // Given
    renderChatTabs({ leftSessionId: "s1", rightSessionId: "s2" });

    // When
    act(() =>
      chatPropsOf(RIGHT_TAB).onNewChatInWorkspace?.(OTHER_WORKSPACE_ID, "omo"),
    );

    // Then
    expect(
      useNewChatEngineStore.getState().engineByWorkspace[OTHER_WORKSPACE_ID],
    ).toBe("omo");
    expect(openNewChatInWorkbenchMock).toHaveBeenCalledExactlyOnceWith({
      workspaceId: OTHER_WORKSPACE_ID,
      navigate: expect.any(Function),
    });
  });

  it("navigates with the router when the new chat opens in another workspace's layout", () => {
    // Given
    renderChatTabs({ leftSessionId: "s1", rightSessionId: "s2" });
    act(() =>
      chatPropsOf(RIGHT_TAB).onNewChatInWorkspace?.(OTHER_WORKSPACE_ID),
    );
    const [openerInput] = openNewChatInWorkbenchMock.mock.lastCall ?? [];
    if (!openerInput) throw new Error("expected the new-chat opener call");

    // When
    openerInput.navigate(`${WORKBENCH_PATH}?workspaceId=w2&open=new-chat`);

    // Then
    expect(routerPushMock).toHaveBeenCalledExactlyOnceWith(
      `${WORKBENCH_PATH}?workspaceId=w2&open=new-chat`,
    );
    expect(useNewChatEngineStore.getState().engineByWorkspace).toEqual({});
  });
});
