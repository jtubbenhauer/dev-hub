import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeChatTarget } from "@/components/workbench/consume-chat-target";
import { WorkbenchSessionSidebar } from "@/components/workbench/session-sidebar/workbench-session-sidebar";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import { _resetModuleCaches, useChatStore } from "@/stores/chat-store";
import { useNewChatEngineStore } from "@/stores/new-chat-engine-store";
import { useSessionSidebarStore } from "@/stores/session-sidebar-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { createFakeLayoutApi } from "../../../lib/workbench/fake-layout-api";
import {
  chatStoreStubs,
  makeSession,
  renderWithProviders,
  seedSessionStores,
  sessionRow,
} from "./session-sidebar-fixtures";

const { pushMock, openNewChatInWorkbenchMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  openNewChatInWorkbenchMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));
vi.mock("@/hooks/use-git", () => ({
  useAgentHealth: () => ({ data: undefined }),
  useGitStatus: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: () => ({ engine: "opencode", isLoading: false }),
}));
vi.mock("@/lib/workbench/open-in-workbench", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/workbench/open-in-workbench")
  >()),
  openNewChatInWorkbench: openNewChatInWorkbenchMock,
}));

const initialChatState = useChatStore.getState();
const initialWorkspaceState = useWorkspaceStore.getState();

function chatParams(sessionId: string | null): WorkbenchTabParams {
  return { kind: "chat", workspaceId: "w1", sessionId };
}

function focusChatTab(panelId: string, sessionId: string | null) {
  useWorkbenchStore.getState().setFocusedPanel({
    workspaceId: "w1",
    panelId,
    params: chatParams(sessionId),
  });
}

function focusTerminalTab() {
  useWorkbenchStore.getState().setFocusedPanel({
    workspaceId: "w1",
    panelId: "terminal-1",
    params: {
      kind: "terminal",
      workspaceId: "w1",
      sessionId: "wb-term-1a2b3c4d",
      title: "Terminal 1",
    },
  });
}

function renderSidebar() {
  return renderWithProviders(<WorkbenchSessionSidebar workspaceId="w1" />);
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  seedSessionStores();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
  useChatStore.setState(initialChatState, true);
  useWorkspaceStore.setState(initialWorkspaceState, true);
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useSessionSidebarStore.setState(
    useSessionSidebarStore.getInitialState(),
    true,
  );
  useNewChatEngineStore.setState({ engineByWorkspace: {} });
  _resetModuleCaches();
});

describe("WorkbenchSessionSidebar", () => {
  it("shows the active workspace's sessions while a terminal tab is focused", () => {
    // Given
    focusTerminalTab();

    // When
    renderSidebar();

    // Then
    expect(screen.getByText("First chat")).toBeInTheDocument();
    expect(screen.getByText("Second chat")).toBeInTheDocument();
  });

  it("renders nothing while collapsed", () => {
    // Given
    useSessionSidebarStore.getState().setOpen(false);

    // When
    renderSidebar();

    // Then
    expect(screen.queryByLabelText("Session sidebar")).not.toBeInTheDocument();
    expect(screen.queryByText("First chat")).not.toBeInTheDocument();
  });

  it("highlights the last-focused chat tab's session, not the global one", () => {
    // Given
    useChatStore.setState({ activeSessionId: "s1" });
    focusChatTab("tab-1", "s2");

    // When
    renderSidebar();

    // Then
    expect(sessionRow("s2").classList).toContain("bg-muted");
    expect(sessionRow("s1").classList).not.toContain("bg-muted");
  });

  it("adds a tab for a picked chat instead of replacing the focused chat tab", () => {
    // Given
    focusChatTab("tab-1", "s1");
    renderSidebar();
    const layoutApi = createFakeLayoutApi({
      groups: [
        {
          id: "main",
          rect: { left: 0, top: 0, width: 1000, height: 1000 },
          panels: [{ id: "tab-1", params: chatParams("s1") }],
        },
      ],
      activeGroupId: "main",
    });

    // When
    fireEvent.click(sessionRow("s2"));
    const panelId = consumeChatTarget(
      layoutApi,
      useWorkbenchStore.getState(),
      "w1",
      () => "Second chat",
    );

    // Then
    expect(chatStoreStubs.setActiveSession).toHaveBeenCalledWith("s2");
    expect(panelId).not.toBe("tab-1");
    expect(layoutApi.getPanel("tab-1")?.params).toEqual(chatParams("s1"));
    expect(layoutApi.getPanel(panelId ?? "")?.params).toEqual(chatParams("s2"));
    expect(layoutApi.getActivePanelId()).toBe(panelId);
    expect(layoutApi.mutations).toEqual(["addPanel"]);
  });

  it("focuses the tab already showing the picked session instead of duplicating it", () => {
    // Given: another group's tab already shows s2.
    focusChatTab("tab-1", "s1");
    renderSidebar();
    const layoutApi = createFakeLayoutApi({
      groups: [
        {
          id: "left",
          rect: { left: 0, top: 0, width: 500, height: 1000 },
          panels: [{ id: "tab-1", params: chatParams("s1") }],
        },
        {
          id: "right",
          rect: { left: 500, top: 0, width: 500, height: 1000 },
          panels: [{ id: "tab-2", params: chatParams("s2") }],
        },
      ],
      activeGroupId: "left",
    });

    // When
    fireEvent.click(sessionRow("s2"));
    const panelId = consumeChatTarget(
      layoutApi,
      useWorkbenchStore.getState(),
      "w1",
      () => "Second chat",
    );

    // Then
    expect(panelId).toBe("tab-2");
    expect(layoutApi.getActivePanelId()).toBe("tab-2");
    expect(layoutApi.mutations).toEqual(["activatePanel"]);
  });

  it("switches the workspace and requests a chat tab on a unified cross-workspace pick", () => {
    // Given
    localStorage.setItem("dev-hub:chat-unified-mode", "true");
    const setActiveWorkspaceId = vi
      .spyOn(useWorkspaceStore.getState(), "setActiveWorkspaceId")
      .mockImplementation(() => {});
    focusChatTab("tab-1", "s1");
    renderSidebar();

    // When
    fireEvent.click(sessionRow("s5"));

    // Then
    expect(setActiveWorkspaceId).toHaveBeenCalledWith("w2");
    expect(chatStoreStubs.setActiveWorkspaceSession).toHaveBeenCalledWith(
      "w2",
      "s5",
    );
    expect(useWorkbenchStore.getState().pendingChatTarget).toEqual({
      workspaceId: "w2",
      sessionId: "s5",
      panelId: null,
    });
  });

  it("creates a session from + and opens it in a new tab", async () => {
    // Given
    focusChatTab("tab-1", "s1");
    const user = userEvent.setup();
    renderSidebar();

    // When
    await user.click(screen.getByRole("button", { name: "New chat" }));
    await user.click(await screen.findByRole("menuitem", { name: /OpenCode/ }));

    // Then
    await waitFor(() =>
      expect(useWorkbenchStore.getState().pendingChatTarget).toEqual({
        workspaceId: "w1",
        sessionId: "s3",
        panelId: null,
      }),
    );
    expect(chatStoreStubs.createSession).toHaveBeenCalledWith("w1", "opencode");
  });

  it("hands a cross-workspace new chat to the workbench opener and wakes the workspace", async () => {
    // Given
    localStorage.setItem("dev-hub:chat-unified-mode", "true");
    localStorage.setItem("dev-hub:chat-group-by-workspace", "true");
    seedSessionStores({ w2Backend: "remote" });
    const user = userEvent.setup();
    renderSidebar();

    // When
    await user.click(screen.getByTitle("New chat in w2"));
    await user.click(
      await screen.findByRole("menuitem", { name: /OMO Native/ }),
    );

    // Then
    expect(openNewChatInWorkbenchMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ workspaceId: "w2" }),
    );
    expect(useNewChatEngineStore.getState().engineByWorkspace["w2"]).toBe(
      "omo",
    );
    expect(chatStoreStubs.createSession).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("/api/workspaces/w2/start", {
      method: "POST",
    });
  });

  it("shows the permission icon on a chat whose sub-agent waits on a permission", () => {
    // Given
    const { workspaceStates } = useChatStore.getState();
    useChatStore.setState({
      workspaceStates: {
        ...workspaceStates,
        w1: {
          ...workspaceStates.w1,
          sessions: {
            ...workspaceStates.w1.sessions,
            "s2-sub-agent": {
              ...makeSession("s2-sub-agent", "Sub-agent", 11),
              parentID: "s2",
            },
          },
          permissions: [
            {
              id: "perm-1",
              sessionID: "s2-sub-agent",
              permission: "bash",
              patterns: [],
              metadata: {},
              always: [],
            },
          ],
        },
      },
    });

    // When
    renderSidebar();

    // Then
    expect(
      sessionRow("s2").querySelector("svg.lucide-shield-alert"),
    ).toBeInTheDocument();
    expect(
      sessionRow("s1").querySelector("svg.lucide-shield-alert"),
    ).not.toBeInTheDocument();
  });
});
