import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkbenchDockview } from "@/components/workbench/workbench-dockview";
import { getWorkbenchController } from "@/lib/workbench/workbench-controller-registry";
import { useChatStore } from "@/stores/chat-store";
import { useEditorStore } from "@/stores/editor-store";
import { layoutStorageKey, useWorkbenchStore } from "@/stores/workbench-store";

vi.mock("@/components/file-picker/file-picker", () => ({
  useFilePicker: () => ({
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
  }),
}));

// Every layout opens a chat tab; its chat body is covered by its own tests.
vi.mock("@/components/chat/chat-interface", () => ({
  ChatInterface: () => <div data-testid="chat-interface" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const WORKSPACE_ID = "w1";

const activeChatParams = {
  kind: "chat",
  workspaceId: WORKSPACE_ID,
  sessionId: "s1",
};

function renderStrictWorkbench(isMobile = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <StrictMode>
        <WorkbenchDockview workspaceId={WORKSPACE_ID} isMobile={isMobile} />
      </StrictMode>
    </QueryClientProvider>,
  );
}

function requireController() {
  const controller = getWorkbenchController();
  if (!controller) throw new Error("expected a registered controller");
  return controller;
}

function savedPanelKinds(layoutKey: string): (string | undefined)[] {
  const savedLayout = useWorkbenchStore.getState().getLayout(layoutKey);
  return Object.values(savedLayout?.panels ?? {}).map(
    (panel) => panel.params?.kind,
  );
}

beforeEach(() => {
  localStorage.clear();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useEditorStore.getState().closeAllFiles();
  useChatStore.setState({
    activeWorkspaceId: WORKSPACE_ID,
    activeSessionId: "s1",
    workspaceStates: {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WorkbenchDockview under React.StrictMode", () => {
  it("registers the controller and marks the layout ready after mount", () => {
    // When
    renderStrictWorkbench();

    // Then
    expect(getWorkbenchController()?.workspaceId).toBe(WORKSPACE_ID);
    expect(useWorkbenchStore.getState().layoutReadyWorkspaceId).toBe(
      WORKSPACE_ID,
    );
  });

  it("unregisters the controller and clears the ready workspace on unmount", () => {
    // Given
    const { unmount } = renderStrictWorkbench();

    // When
    unmount();

    // Then
    expect(getWorkbenchController()).toBeNull();
    expect(useWorkbenchStore.getState().layoutReadyWorkspaceId).toBeNull();
  });

  it("focuses the default chat panel of the active chat session", () => {
    // When
    renderStrictWorkbench();

    // Then
    expect(useWorkbenchStore.getState().focusedPanel).toEqual({
      workspaceId: WORKSPACE_ID,
      panelId: expect.any(String),
      params: activeChatParams,
    });
  });

  it("clears the focused panel on unmount", () => {
    // Given
    const { unmount } = renderStrictWorkbench();

    // When
    unmount();

    // Then
    expect(useWorkbenchStore.getState().focusedPanel).toBeNull();
  });

  it("saves the layout under the desktop key on unmount", () => {
    // Given
    const { unmount } = renderStrictWorkbench();

    // When
    unmount();

    // Then
    expect(Object.keys(useWorkbenchStore.getState().layoutsByKey)).toEqual([
      layoutStorageKey(WORKSPACE_ID, false),
    ]);
    expect(savedPanelKinds(layoutStorageKey(WORKSPACE_ID, false))).toEqual([
      "chat",
    ]);
  });

  it("saves a mobile layout only under the mobile key", () => {
    // Given
    const { unmount } = renderStrictWorkbench(true);

    // When
    unmount();

    // Then
    expect(Object.keys(useWorkbenchStore.getState().layoutsByKey)).toEqual([
      layoutStorageKey(WORKSPACE_ID, true),
    ]);
  });

  it("saves a layout change only after the 300 ms debounce", async () => {
    // Given
    renderStrictWorkbench();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => {
      requireController().openNewTerminal();
    });
    // dockview batches layout-change events in a microtask.
    await act(async () => {
      await Promise.resolve();
    });
    const layoutKey = layoutStorageKey(WORKSPACE_ID, false);
    act(() => vi.advanceTimersByTime(299));
    expect(useWorkbenchStore.getState().getLayout(layoutKey)).toBeNull();

    // When
    act(() => vi.advanceTimersByTime(1));

    // Then
    expect(savedPanelKinds(layoutKey)).toEqual(["chat", "terminal"]);
  });

  it("makes a focused file tab the editor's active file", () => {
    // Given
    renderStrictWorkbench();

    // When
    act(() => {
      requireController().openTab({
        kind: "file",
        workspaceId: WORKSPACE_ID,
        path: "src/a.ts",
      });
    });

    // Then
    expect(useEditorStore.getState().activeFilePath).toBe("src/a.ts");
    expect(useWorkbenchStore.getState().focusedPanel?.params).toEqual({
      kind: "file",
      workspaceId: WORKSPACE_ID,
      path: "src/a.ts",
    });
  });

  it("closes the last tab from its close button and shows the launcher", async () => {
    // Given
    renderStrictWorkbench();

    // When
    await userEvent.click(
      screen.getByRole("button", { name: "Close New chat" }),
    );

    // Then
    expect(screen.getByRole("group", { name: "New tab" })).toBeInTheDocument();
    expect(useWorkbenchStore.getState().focusedPanel).toBeNull();
  });

  it("opens a new chat from the launcher shown once every tab is closed", async () => {
    // Given
    renderStrictWorkbench();
    await userEvent.click(
      screen.getByRole("button", { name: "Close New chat" }),
    );

    // When
    await userEvent.click(screen.getByRole("button", { name: "New chat" }));

    // Then
    expect(useWorkbenchStore.getState().focusedPanel?.params).toEqual({
      kind: "chat",
      workspaceId: WORKSPACE_ID,
      sessionId: null,
    });
  });

  it("opens a new terminal in the menu's group from the group menu", async () => {
    // Given
    renderStrictWorkbench();
    await userEvent.click(
      screen.getByRole("button", { name: "Group actions" }),
    );

    // When
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "New terminal" }),
    );

    // Then
    expect(useWorkbenchStore.getState().focusedPanel?.params).toEqual({
      kind: "terminal",
      workspaceId: WORKSPACE_ID,
      sessionId: expect.stringMatching(/^wb-term-[0-9a-f]{8}$/),
      title: "Terminal 1",
    });
    expect(
      screen.getAllByRole("button", { name: "Group actions" }),
    ).toHaveLength(1);
  });

  it("splits the group to the right with a launcher from the group menu", async () => {
    // Given
    renderStrictWorkbench();
    await userEvent.click(
      screen.getByRole("button", { name: "Group actions" }),
    );

    // When
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Split right" }),
    );

    // Then
    expect(
      screen.getAllByRole("button", { name: "Group actions" }),
    ).toHaveLength(2);
    expect(useWorkbenchStore.getState().focusedPanel?.params).toEqual({
      kind: "launcher",
      workspaceId: WORKSPACE_ID,
    });
  });

  it("offers no split items in the mobile group menu", async () => {
    // Given
    renderStrictWorkbench(true);

    // When
    await userEvent.click(
      screen.getByRole("button", { name: "Group actions" }),
    );

    // Then
    expect(
      await screen.findByRole("menuitem", { name: "New terminal" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Split right" }),
    ).not.toBeInTheDocument();
  });
});
