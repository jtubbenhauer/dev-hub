import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkbenchDockview } from "@/components/workbench/workbench-dockview";
import { getWorkbenchController } from "@/lib/workbench/workbench-controller-registry";
import { _resetModuleCaches, useChatStore } from "@/stores/chat-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

vi.mock("@/components/chat/chat-interface", () => ({
  ChatInterface: () => <div data-testid="chat-interface" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/file-picker/file-picker", () => ({
  useFilePicker: () => ({
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
  }),
}));

const WORKSPACE_ID = "w1";
const OTHER_WORKSPACE_ID = "w2";

const initialChatState = useChatStore.getState();
const initialWorkspaceState = useWorkspaceStore.getState();

function renderWorkbench() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StrictMode>
        <WorkbenchDockview workspaceId={WORKSPACE_ID} isMobile={false} />
      </StrictMode>
    </QueryClientProvider>,
  );
}

function requireController() {
  const controller = getWorkbenchController();
  if (!controller) throw new Error("expected a registered controller");
  return controller;
}

beforeEach(() => {
  localStorage.clear();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useEditorStore.getState().closeAllFiles();
  useWorkspaceStore.setState({ activeWorkspaceId: WORKSPACE_ID });
  useChatStore.setState({
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: "s1",
    streamingError: null,
    workspaceStates: {},
  });
});

afterEach(() => {
  cleanup();
  useChatStore.setState(initialChatState, true);
  useWorkspaceStore.setState(initialWorkspaceState, true);
  _resetModuleCaches();
});

describe("WorkbenchDockview chat sync", () => {
  it("makes the session of a chat tab that gains focus the global session", () => {
    // Given
    renderWorkbench();
    useChatStore.setState({ activeWorkspaceId: OTHER_WORKSPACE_ID });

    // When
    act(() => {
      requireController().openTab({
        kind: "chat",
        workspaceId: WORKSPACE_ID,
        sessionId: "s2",
      });
    });

    // Then
    expect(useChatStore.getState().activeWorkspaceId).toBe(WORKSPACE_ID);
    expect(useChatStore.getState().activeSessionId).toBe("s2");
  });

  it("clears the global session and its error when a new-chat tab gains focus", () => {
    // Given
    renderWorkbench();
    useChatStore.setState({ streamingError: "s1 failed" });

    // When
    act(() => {
      requireController().openNewChat();
    });

    // Then
    expect(useChatStore.getState().activeSessionId).toBeNull();
    expect(useChatStore.getState().streamingError).toBeNull();
  });

  it("clears the previous chat's error when a chat target focuses another open chat tab", () => {
    // Given: the default tab shows s1; the focused tab shows s2 with an error.
    renderWorkbench();
    act(() => {
      requireController().openTab({
        kind: "chat",
        workspaceId: WORKSPACE_ID,
        sessionId: "s2",
      });
    });
    useChatStore.setState({ streamingError: "s2 failed" });

    // When
    act(() => {
      useWorkbenchStore.getState().requestChatTarget({
        workspaceId: WORKSPACE_ID,
        sessionId: "s1",
        panelId: null,
      });
    });

    // Then
    expect(useChatStore.getState().activeSessionId).toBe("s1");
    expect(useChatStore.getState().streamingError).toBeNull();
  });

  it("leaves the global session alone while another workspace is active", () => {
    // Given: the workspace switch is about to replace this layout.
    renderWorkbench();
    useWorkspaceStore.setState({ activeWorkspaceId: OTHER_WORKSPACE_ID });

    // When
    act(() => {
      requireController().openTab({
        kind: "chat",
        workspaceId: WORKSPACE_ID,
        sessionId: "s2",
      });
    });

    // Then
    expect(useChatStore.getState().activeSessionId).toBe("s1");
  });

  it("opens the tab of a chat target queued before the layout mounted", () => {
    // Given
    useWorkbenchStore.getState().requestChatTarget({
      workspaceId: WORKSPACE_ID,
      sessionId: "s3",
      panelId: null,
    });

    // When
    renderWorkbench();

    // Then
    expect(useWorkbenchStore.getState().pendingChatTarget).toBeNull();
    expect(useWorkbenchStore.getState().focusedPanel?.params).toEqual({
      kind: "chat",
      workspaceId: WORKSPACE_ID,
      sessionId: "s3",
    });
  });

  it("opens the tab of a chat target requested while mounted", () => {
    // Given
    renderWorkbench();

    // When
    act(() => {
      useWorkbenchStore.getState().requestChatTarget({
        workspaceId: WORKSPACE_ID,
        sessionId: "s4",
        panelId: null,
      });
    });

    // Then
    expect(useWorkbenchStore.getState().focusedPanel?.params).toEqual({
      kind: "chat",
      workspaceId: WORKSPACE_ID,
      sessionId: "s4",
    });
    expect(useChatStore.getState().activeSessionId).toBe("s4");
  });

  it("stops applying chat targets once unmounted", () => {
    // Given
    const { unmount } = renderWorkbench();
    unmount();
    const target = {
      workspaceId: WORKSPACE_ID,
      sessionId: "s5",
      panelId: null,
    };

    // When
    useWorkbenchStore.getState().requestChatTarget(target);

    // Then
    expect(useWorkbenchStore.getState().pendingChatTarget).toEqual(target);
  });
});
