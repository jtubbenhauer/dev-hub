import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { Orientation, type SerializedDockview } from "dockview-react";
import type { ComponentProps } from "react";

import type { WorkspaceChatEffectsHost } from "@/components/chat/workspace-chat-effects-host";
import type { ContextSidebar } from "@/components/workbench/context-sidebar/context-sidebar";

import { getLspOpenFileHandler } from "@/lib/lsp/client/navigation-registry";
import { getWorkbenchController } from "@/lib/workbench/workbench-controller-registry";
import { WORKBENCH_PATH } from "@/lib/workbench/workbench-href";
import type { Session } from "@/lib/opencode/types";
import { useChatStore } from "@/stores/chat-store";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  createLoadedChatWorkspaceState,
  createWorkspace,
  renderWorkbenchView,
  terminalCloseButtons,
} from "./workbench-view-fixtures";

// A tiny URL store: the mocked router writes it, useSearchParams reads it.
const fakeUrl = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  const setSearch = (nextSearch: string) => {
    search = nextSearch;
    for (const listener of listeners) listener();
  };
  const navigateTo = (href: string) =>
    setSearch(new URL(href, "http://localhost").search.slice(1));
  return {
    setSearch,
    getSearch: () => search,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    router: { replace: vi.fn(navigateTo), push: vi.fn(navigateTo) },
  };
});

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useRouter: () => fakeUrl.router,
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(fakeUrl.subscribe, fakeUrl.getSearch),
      ),
  };
});

vi.mock("@/components/file-picker/file-picker", () => ({
  useFilePicker: () => ({
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
  }),
}));

const chatEffectsHost = vi.hoisted(() => ({
  latestProps: null as ComponentProps<typeof WorkspaceChatEffectsHost> | null,
}));

// Each chat tab's body is covered by its own tests.
vi.mock("@/components/chat/chat-interface", () => ({
  ChatInterface: () => <div data-testid="chat-interface" />,
}));

vi.mock("@/components/chat/workspace-chat-effects-host", () => ({
  WorkspaceChatEffectsHost: (
    props: ComponentProps<typeof WorkspaceChatEffectsHost>,
  ) => {
    chatEffectsHost.latestProps = props;
    return <div data-testid="workspace-chat-effects" />;
  },
}));

const contextSidebarDouble = vi.hoisted(() => ({
  latestProps: null as ComponentProps<typeof ContextSidebar> | null,
}));

// The sidebar has its own tests; this stub reports what the view hands it.
vi.mock("@/components/workbench/context-sidebar/context-sidebar", async () => {
  const { useIsWorkbenchMobile } =
    await import("@/components/workbench/workbench-mode-context");
  return {
    ContextSidebar: (props: ComponentProps<typeof ContextSidebar>) => {
      contextSidebarDouble.latestProps = props;
      return (
        <div
          data-testid="context-sidebar"
          data-mobile={String(useIsWorkbenchMobile())}
        />
      );
    },
  };
});

const initialChatState = useChatStore.getState();
const initialWorkspaceState = useWorkspaceStore.getState();

function makeSession(id: string): Session {
  return {
    id,
    projectID: "project",
    directory: "/workspaces/w1",
    title: `Session ${id}`,
    version: "1",
    time: { created: 1, updated: 1 },
  };
}

beforeEach(() => {
  localStorage.clear();
  // Terminal tabs resolve their pty over fetch; a pending answer keeps them quiet.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
  fakeUrl.setSearch("");
  fakeUrl.router.replace.mockClear();
  fakeUrl.router.push.mockClear();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useContextSidebarStore.setState(
    useContextSidebarStore.getInitialState(),
    true,
  );
  useEditorStore.getState().closeAllFiles();
  useWorkspaceStore.setState({
    workspaces: [createWorkspace("w1"), createWorkspace("w2")],
    activeWorkspaceId: "w1",
  });
  useChatStore.setState({
    activeWorkspaceId: "w1",
    activeSessionId: null,
    workspaceStates: {},
  });
});

afterEach(() => {
  // Unmount first: resetting stores under a mounted view re-renders it.
  cleanup();
  chatEffectsHost.latestProps = null;
  contextSidebarDouble.latestProps = null;
  vi.unstubAllGlobals();
  useChatStore.setState(initialChatState, true);
  useWorkspaceStore.setState(initialWorkspaceState, true);
});

describe("WorkbenchView", () => {
  it("asks for a workspace when none is active", () => {
    // Given
    useWorkspaceStore.setState({ activeWorkspaceId: null });

    // When
    renderWorkbenchView();

    // Then
    expect(screen.getByText("Select a workspace to start")).toBeInTheDocument();
    expect(getWorkbenchController()).toBeNull();
  });

  it("mounts the active workspace's layout", () => {
    // When
    renderWorkbenchView();

    // Then
    expect(getWorkbenchController()?.workspaceId).toBe("w1");
    expect(
      screen.getByRole("button", { name: "Close New chat" }),
    ).toBeInTheDocument();
  });

  it("runs the workspace chat effects once next to the layout", () => {
    // When
    renderWorkbenchView();

    // Then
    expect(screen.getAllByTestId("workspace-chat-effects")).toHaveLength(1);
  });

  it("renders the context sidebar for the active workspace", () => {
    // When
    renderWorkbenchView();

    // Then
    expect(contextSidebarDouble.latestProps).toEqual({
      workspaceId: "w1",
      workspace: expect.objectContaining({ id: "w1" }),
    });
    expect(screen.getByTestId("context-sidebar")).toHaveAttribute(
      "data-mobile",
      "false",
    );
  });

  it("tells the context sidebar when it runs on a phone", () => {
    // Given
    vi.stubGlobal("innerWidth", 390);

    // When
    renderWorkbenchView();

    // Then
    expect(screen.getByTestId("context-sidebar")).toHaveAttribute(
      "data-mobile",
      "true",
    );
  });

  it("hides the context sidebar on Cmd+Backslash", () => {
    // Given
    renderWorkbenchView();

    // When
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Backslash",
          metaKey: true,
          cancelable: true,
        }),
      );
    });

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(false);
  });

  it("opens the context sidebar sheet on Cmd+Backslash on a phone", () => {
    // Given
    vi.stubGlobal("innerWidth", 390);
    renderWorkbenchView();

    // When
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Backslash",
          metaKey: true,
          cancelable: true,
        }),
      );
    });

    // Then
    expect(useContextSidebarStore.getState()).toMatchObject({
      isOpen: true,
      isMobileSheetOpen: true,
    });
  });

  it("routes go-to-definition from file tab editors while mounted", () => {
    // Given
    const view = renderWorkbenchView();
    expect(getLspOpenFileHandler("files-page")).toBeDefined();

    // When
    view.unmount();

    // Then
    expect(getLspOpenFileHandler("files-page")).toBeUndefined();
  });

  it("opens a chat tab for a session the workspace chat effects started", () => {
    // Given
    renderWorkbenchView();
    const onSessionStarted = chatEffectsHost.latestProps?.onSessionStarted;
    if (!onSessionStarted) throw new Error("expected an onSessionStarted prop");

    // When
    act(() => onSessionStarted("w1", "s7"));

    // Then
    expect(useWorkbenchStore.getState().pendingChatTarget).toBeNull();
    expect(useWorkbenchStore.getState().focusedPanel?.params).toEqual({
      kind: "chat",
      workspaceId: "w1",
      sessionId: "s7",
    });
  });

  it("drops saved layouts of workspaces that no longer exist", () => {
    // Given
    const savedLayout: SerializedDockview = {
      grid: {
        root: { type: "branch", data: [] },
        width: 0,
        height: 0,
        orientation: Orientation.HORIZONTAL,
      },
      panels: {},
    };
    useWorkbenchStore.setState({
      layoutsByKey: { "w-deleted": savedLayout, w2: savedLayout },
    });

    // When
    renderWorkbenchView();

    // Then
    const { layoutsByKey } = useWorkbenchStore.getState();
    expect(layoutsByKey).not.toHaveProperty("w-deleted");
    expect(layoutsByKey).toHaveProperty("w2");
  });

  it("hands a clean editor tab of another workspace back to its owner", () => {
    // Given
    useEditorStore.setState({
      openFiles: [
        {
          workspaceId: "w2",
          path: "TWO.md",
          name: "TWO.md",
          content: "# Two",
          originalContent: "# Two",
          language: "markdown",
          isDirty: false,
          instanceId: 1,
        },
      ],
      activeFilePath: "TWO.md",
    });

    // When
    renderWorkbenchView();

    // Then
    expect(useEditorStore.getState().openFiles).toEqual([]);
  });

  describe("URL intents", () => {
    it("applies an intent once the layout is ready and clears the URL", () => {
      // Given
      fakeUrl.setSearch("open=terminal");

      // When
      renderWorkbenchView();

      // Then
      expect(terminalCloseButtons()).toHaveLength(1);
      expect(fakeUrl.router.replace).toHaveBeenCalledWith(WORKBENCH_PATH);
      expect(fakeUrl.getSearch()).toBe("");
    });

    it("switches to the linked workspace and applies the intent once its layout is ready", () => {
      // Given
      fakeUrl.setSearch("workspaceId=w2&open=terminal");

      // When
      renderWorkbenchView();

      // Then
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("w2");
      expect(getWorkbenchController()?.workspaceId).toBe("w2");
      expect(terminalCloseButtons()).toHaveLength(1);
      expect(fakeUrl.router.replace).toHaveBeenCalledTimes(1);
      expect(fakeUrl.router.replace).toHaveBeenCalledWith(WORKBENCH_PATH);
    });

    it("drops a link to an unknown workspace without acting", () => {
      // Given
      fakeUrl.setSearch("workspaceId=w-deleted&open=terminal");

      // When
      renderWorkbenchView();

      // Then
      expect(fakeUrl.router.replace).toHaveBeenCalledWith(WORKBENCH_PATH);
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe("w1");
      expect(terminalCloseButtons()).toHaveLength(0);
    });

    it("waits for the workspace list before judging a linked workspace", () => {
      // Given
      useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
      fakeUrl.setSearch("workspaceId=w2&open=terminal");
      renderWorkbenchView();
      expect(fakeUrl.router.replace).not.toHaveBeenCalled();

      // When
      act(() => {
        useWorkspaceStore
          .getState()
          .setWorkspaces([createWorkspace("w1"), createWorkspace("w2")]);
      });

      // Then
      expect(getWorkbenchController()?.workspaceId).toBe("w2");
      expect(terminalCloseButtons()).toHaveLength(1);
    });

    it("acts again when the same link is followed twice", () => {
      // Given
      fakeUrl.setSearch("open=terminal");
      renderWorkbenchView();

      // When
      act(() => fakeUrl.setSearch("open=terminal"));

      // Then
      expect(terminalCloseButtons()).toHaveLength(2);
      expect(fakeUrl.router.replace).toHaveBeenCalledTimes(2);
    });

    it("drops an invalid intent without opening a tab", () => {
      // Given
      fakeUrl.setSearch("open=file");

      // When
      renderWorkbenchView();

      // Then
      expect(fakeUrl.router.replace).toHaveBeenCalledWith(WORKBENCH_PATH);
      expect(screen.getAllByRole("button", { name: /^Close / })).toHaveLength(
        1,
      );
    });

    it("waits for the session list before opening a linked session's tab", () => {
      // Given
      fakeUrl.setSearch("open=chat&sessionId=s1");
      renderWorkbenchView();
      expect(useChatStore.getState().activeSessionId).toBeNull();
      expect(fakeUrl.router.replace).not.toHaveBeenCalled();

      // When
      act(() => {
        useChatStore.setState({
          workspaceStates: {
            w1: {
              ...createLoadedChatWorkspaceState(),
              sessions: { s1: makeSession("s1") },
            },
          },
        });
      });

      // Then
      expect(useChatStore.getState().activeSessionId).toBe("s1");
      expect(useWorkbenchStore.getState().pendingChatTarget).toBeNull();
      expect(useWorkbenchStore.getState().focusedPanel?.params).toEqual({
        kind: "chat",
        workspaceId: "w1",
        sessionId: "s1",
      });
      expect(fakeUrl.router.replace).toHaveBeenCalledWith(WORKBENCH_PATH);
    });

    it("drops a linked session the session list turns out to lack", () => {
      // Given
      fakeUrl.setSearch("open=chat&sessionId=does-not-exist");
      renderWorkbenchView();

      // When
      act(() => {
        useChatStore.setState({
          workspaceStates: { w1: createLoadedChatWorkspaceState() },
        });
      });

      // Then
      expect(useChatStore.getState().activeSessionId).toBeNull();
      expect(fakeUrl.router.replace).toHaveBeenCalledWith(WORKBENCH_PATH);
      expect(useWorkbenchStore.getState().focusedPanel?.params).toEqual({
        kind: "chat",
        workspaceId: "w1",
        sessionId: null,
      });
      expect(screen.getAllByRole("button", { name: /^Close / })).toHaveLength(
        1,
      );
    });

    it("does not bind a session the loaded session list lacks", () => {
      // Given
      useChatStore.setState({
        workspaceStates: { w1: createLoadedChatWorkspaceState() },
      });
      fakeUrl.setSearch("open=chat&sessionId=s-deleted");

      // When
      renderWorkbenchView();

      // Then
      expect(useChatStore.getState().activeSessionId).toBeNull();
      expect(useWorkbenchStore.getState().pendingChatTarget).toBeNull();
      expect(fakeUrl.router.replace).toHaveBeenCalledWith(WORKBENCH_PATH);
      expect(useWorkbenchStore.getState().focusedPanel?.params).toEqual({
        kind: "chat",
        workspaceId: "w1",
        sessionId: null,
      });
    });
  });
});
