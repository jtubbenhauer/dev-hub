import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
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

vi.mock("@/components/workbench/tabs/terminal-tab-panel", () => ({
  TerminalTabPanel: () => <div data-testid="terminal-tab" />,
  TerminalTabRunningIndicator: () => null,
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

function tabHeaderOf(title: string): HTMLElement {
  const tab = [...document.querySelectorAll<HTMLElement>(".dv-tab")].find(
    (candidate) => candidate.textContent?.includes(title),
  );
  if (!tab) throw new Error(`no tab header titled ${title}`);
  return tab;
}

// Replaces the synchronous rAF shim from tests/setup.ts with a manual queue,
// so dockview's deferred tab activation and the focus-recording frame run in
// real browser order (registration order, one frame later).
function stubAnimationFrameQueue() {
  const frames: (FrameRequestCallback | null)[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    frames[handle - 1] = null;
  });
  return {
    flush: () => {
      while (frames.length > 0) {
        const frame = frames.shift();
        frame?.(performance.now());
      }
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
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
  vi.unstubAllGlobals();
  useChatStore.setState(initialChatState, true);
  useWorkspaceStore.setState(initialWorkspaceState, true);
  _resetModuleCaches();
});

describe("WorkbenchDockview focus coalescing", () => {
  it("keeps the last-focused chat on B when a terminal tab behind chat A is clicked", () => {
    // Given: left group [chat A (shown), terminal T behind it]; chat B focused
    // in the right group.
    renderWorkbench();
    const chatAPanelId = useWorkbenchStore.getState().focusedPanel?.panelId;
    if (!chatAPanelId) throw new Error("expected the default chat tab");
    act(() => {
      requireController().openNewTerminal();
    });
    act(() => {
      requireController().runCommand({ type: "focus-number", n: 1 });
    });
    let chatBPanelId = "";
    act(() => {
      requireController().runCommand({ type: "split", direction: "right" });
    });
    act(() => {
      chatBPanelId = requireController().openTab({
        kind: "chat",
        workspaceId: WORKSPACE_ID,
        sessionId: "s2",
      });
    });
    expect(
      useWorkbenchStore.getState().lastFocusedPanelByWorkspace[WORKSPACE_ID]
        ?.chat?.panelId,
    ).toBe(chatBPanelId);
    expect(useChatStore.getState().activeSessionId).toBe("s2");

    // When: T's tab header is clicked the way a real pointer does it — the
    // group activates synchronously (replaying chat A as its active panel) and
    // dockview's html5 dnd backend activates T one animation frame later.
    const frameQueue = stubAnimationFrameQueue();
    act(() => {
      fireEvent.pointerDown(tabHeaderOf("Terminal 1"), { button: 0 });
    });
    act(() => {
      frameQueue.flush();
    });

    // Then: the transient chat-A activation is never recorded.
    const workbench = useWorkbenchStore.getState();
    expect(
      workbench.lastFocusedPanelByWorkspace[WORKSPACE_ID]?.chat?.panelId,
    ).toBe(chatBPanelId);
    expect(workbench.focusedPanel?.params.kind).toBe("terminal");
    expect(workbench.focusedPanel?.panelId).not.toBe(chatAPanelId);
    expect(useChatStore.getState().activeSessionId).toBe("s2");
  });

  it("records a plain same-group tab switch", () => {
    // Given: one group [chat A, terminal T], T active.
    renderWorkbench();
    const chatAPanelId = useWorkbenchStore.getState().focusedPanel?.panelId;
    act(() => {
      requireController().openNewTerminal();
    });

    // When: A's tab is clicked (same group — no transient group activation).
    const frameQueue = stubAnimationFrameQueue();
    act(() => {
      fireEvent.pointerDown(tabHeaderOf("New chat"), { button: 0 });
    });
    act(() => {
      frameQueue.flush();
    });

    // Then
    expect(useWorkbenchStore.getState().focusedPanel?.panelId).toBe(
      chatAPanelId,
    );
  });
});
