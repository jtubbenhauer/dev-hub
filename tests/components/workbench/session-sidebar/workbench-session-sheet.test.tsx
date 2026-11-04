import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchSessionSheet } from "@/components/workbench/session-sidebar/workbench-session-sheet";
import { _resetModuleCaches, useChatStore } from "@/stores/chat-store";
import { useSessionSidebarStore } from "@/stores/session-sidebar-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import {
  chatStoreStubs,
  renderWithProviders,
  seedSessionStores,
  sessionRow,
} from "./session-sidebar-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/use-git", () => ({
  useAgentHealth: () => ({ data: undefined }),
  useGitStatus: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-workspace-engine", () => ({
  useWorkspaceEngine: () => ({ engine: "opencode", isLoading: false }),
}));

const initialChatState = useChatStore.getState();
const initialWorkspaceState = useWorkspaceStore.getState();

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
  _resetModuleCaches();
});

describe("WorkbenchSessionSheet", () => {
  it("stays closed until the store opens it", () => {
    // When
    renderWithProviders(<WorkbenchSessionSheet workspaceId="w1" />);

    // Then
    expect(screen.queryByText("First chat")).not.toBeInTheDocument();
  });

  it("shows the session list once the store opens it", () => {
    // Given
    useSessionSidebarStore.getState().setMobileSheetOpen(true);

    // When
    renderWithProviders(<WorkbenchSessionSheet workspaceId="w1" />);

    // Then
    expect(screen.getByText("First chat")).toBeInTheDocument();
    expect(screen.getByText("Second chat")).toBeInTheDocument();
  });

  it("closes on a pick and requests the picked session", () => {
    // Given
    useSessionSidebarStore.getState().setMobileSheetOpen(true);
    renderWithProviders(<WorkbenchSessionSheet workspaceId="w1" />);

    // When
    fireEvent.click(sessionRow("s2"));

    // Then
    expect(useSessionSidebarStore.getState().isMobileSheetOpen).toBe(false);
    expect(useWorkbenchStore.getState().pendingChatTarget).toEqual({
      workspaceId: "w1",
      sessionId: "s2",
      panelId: null,
      shouldActivate: true,
    });
  });

  it("closes after creating a new chat from the list", async () => {
    // Given
    useSessionSidebarStore.getState().setMobileSheetOpen(true);
    const user = userEvent.setup();
    renderWithProviders(<WorkbenchSessionSheet workspaceId="w1" />);

    // When
    await user.click(screen.getByRole("button", { name: "New chat" }));
    await user.click(await screen.findByRole("menuitem", { name: /OpenCode/ }));

    // Then
    expect(useSessionSidebarStore.getState().isMobileSheetOpen).toBe(false);
    await waitFor(() =>
      expect(chatStoreStubs.createSession).toHaveBeenCalledWith(
        "w1",
        "opencode",
      ),
    );
  });
});
