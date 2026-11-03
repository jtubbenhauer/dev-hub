import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionBridge } from "@/components/layout/attention-bridge";
import { visibleSessionKey } from "@/lib/chat/session-scoped-selectors";
import {
  navigateToNotificationTarget,
  setNotificationNavigator,
} from "@/lib/notifications";
import { WORKBENCH_PATH } from "@/lib/workbench/workbench-href";
import { attentionKey, useAttentionStore } from "@/stores/attention-store";
import { useChatStore, type WorkspaceState } from "@/stores/chat-store";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: "/chat",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => navigation.pathname,
}));

const TARGET_HREF = "/chat?workspaceId=ws-1&sessionId=s-1";

function makeSession(id: string, parentID?: string) {
  return {
    id,
    title: `Session ${id}`,
    parentID,
    projectID: "project-1",
    directory: "/tmp",
    version: "1",
    time: { created: 1, updated: 1 },
  };
}

function makeWorkspaceState(
  sessions: WorkspaceState["sessions"],
): WorkspaceState {
  return {
    sessionsLoaded: true,
    sessions,
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
    pinnedSessionIds: new Set<string>(),
    sessionNotes: {},
  };
}

function seedUnseen(...sessionIds: string[]) {
  useAttentionStore.setState({
    unseenFinishedKeys: sessionIds.map((sessionId) =>
      attentionKey("ws-1", sessionId),
    ),
  });
}

function unseenKeys(): readonly string[] {
  return useAttentionStore.getState().unseenFinishedKeys;
}

beforeEach(() => {
  navigation.push.mockReset();
  navigation.pathname = "/chat";
  window.history.replaceState({}, "", "/chat");
  useAttentionStore.setState({ unseenFinishedKeys: [] });
  useChatStore.setState({
    visibleSessionKeys: {},
    activeWorkspaceId: "ws-1",
    activeSessionId: "s-1",
    workspaceStates: {
      "ws-1": makeWorkspaceState({
        "s-1": makeSession("s-1"),
        "s-2": makeSession("s-2"),
        "child-1": makeSession("child-1", "s-1"),
      }),
    },
  });
});

afterEach(() => {
  cleanup();
  setNotificationNavigator(null);
  useChatStore.setState({
    visibleSessionKeys: {},
    activeWorkspaceId: null,
    activeSessionId: null,
    workspaceStates: {},
  });
  vi.restoreAllMocks();
});

describe("AttentionBridge navigator", () => {
  it("routes notification targets through the Next router while mounted", () => {
    const assignSpy = vi.fn();
    render(<AttentionBridge />);

    navigateToNotificationTarget(TARGET_HREF, assignSpy);

    expect(navigation.push).toHaveBeenCalledWith(TARGET_HREF);
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("falls back to location assignment after unmount", () => {
    const assignSpy = vi.fn();
    const { unmount } = render(<AttentionBridge />);
    unmount();

    navigateToNotificationTarget(TARGET_HREF, assignSpy);

    expect(assignSpy).toHaveBeenCalledWith(TARGET_HREF);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("renders nothing", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    const { container } = render(<AttentionBridge />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("AttentionBridge unseen clearing", () => {
  it("clears the active root's unseen key on render when focused", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    seedUnseen("s-1");

    render(<AttentionBridge />);

    expect(unseenKeys()).toEqual([]);
  });

  it("keeps the unseen key when the document is not focused", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    seedUnseen("s-1");

    render(<AttentionBridge />);

    expect(unseenKeys()).toEqual([attentionKey("ws-1", "s-1")]);
  });

  it("clears the newly active session's key when activeSessionId changes", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    render(<AttentionBridge />);
    seedUnseen("s-2");

    act(() => {
      useChatStore.setState({ activeSessionId: "s-2" });
    });

    expect(unseenKeys()).toEqual([]);
  });

  it("clears on window focus once the document gains focus", () => {
    const hasFocusSpy = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    seedUnseen("s-1");
    render(<AttentionBridge />);
    hasFocusSpy.mockReturnValue(true);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(unseenKeys()).toEqual([]);
  });

  it("clears nothing when the current path is not /chat", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    window.history.replaceState({}, "", "/git");
    seedUnseen("s-1", "s-2");
    render(<AttentionBridge />);

    act(() => {
      useChatStore.setState({ activeSessionId: "s-2" });
    });

    expect(unseenKeys()).toEqual([
      attentionKey("ws-1", "s-1"),
      attentionKey("ws-1", "s-2"),
    ]);
  });

  it("clears the root key when the active session is a child", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    useChatStore.setState({ activeSessionId: "child-1" });
    seedUnseen("s-1", "child-1", "s-2");

    render(<AttentionBridge />);

    expect(unseenKeys()).toEqual([attentionKey("ws-1", "s-2")]);
  });

  it("stops clearing after unmount", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { unmount } = render(<AttentionBridge />);
    unmount();
    seedUnseen("s-2");

    useChatStore.setState({ activeSessionId: "s-2" });
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(unseenKeys()).toEqual([attentionKey("ws-1", "s-2")]);
  });

  it("clears a visible session's unseen key on the workbench", () => {
    // Given
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    window.history.replaceState({}, "", WORKBENCH_PATH);
    useChatStore.setState({
      visibleSessionKeys: { [visibleSessionKey("ws-1", "s-2")]: 1 },
    });
    seedUnseen("s-2");

    // When
    render(<AttentionBridge />);

    // Then
    expect(unseenKeys()).toEqual([]);
  });

  it("clears the root key of a visible child session", () => {
    // Given
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    window.history.replaceState({}, "", WORKBENCH_PATH);
    useChatStore.setState({
      activeSessionId: "s-2",
      visibleSessionKeys: { [visibleSessionKey("ws-1", "child-1")]: 1 },
    });
    seedUnseen("s-1", "child-1");

    // When
    render(<AttentionBridge />);

    // Then
    expect(unseenKeys()).toEqual([]);
  });

  it("clears visible sessions of a workspace other than the active one", () => {
    // Given
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    window.history.replaceState({}, "", WORKBENCH_PATH);
    useChatStore.setState({
      visibleSessionKeys: { [visibleSessionKey("ws-2", "s-9")]: 1 },
    });
    useAttentionStore.setState({
      unseenFinishedKeys: [attentionKey("ws-2", "s-9")],
    });

    // When
    render(<AttentionBridge />);

    // Then
    expect(unseenKeys()).toEqual([]);
  });

  it("clears a session's unseen key once it becomes visible", () => {
    // Given
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    window.history.replaceState({}, "", WORKBENCH_PATH);
    render(<AttentionBridge />);
    seedUnseen("s-2");

    // When
    act(() => {
      useChatStore.getState().registerVisibleSession("ws-1", "s-2");
    });

    // Then
    expect(unseenKeys()).toEqual([]);
  });

  it("keeps a visible session's unseen key outside the chat views", () => {
    // Given
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    window.history.replaceState({}, "", "/git");
    render(<AttentionBridge />);
    seedUnseen("s-2");

    // When
    act(() => {
      useChatStore.getState().registerVisibleSession("ws-1", "s-2");
    });

    // Then
    expect(unseenKeys()).toEqual([attentionKey("ws-1", "s-2")]);
  });
});
