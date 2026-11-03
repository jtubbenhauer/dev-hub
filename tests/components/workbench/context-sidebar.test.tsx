import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ContextSidebar } from "@/components/workbench/context-sidebar/context-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkbenchModeProvider } from "@/components/workbench/workbench-mode-context";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { useWorkbenchStore } from "@/stores/workbench-store";
import type { GitStatusResult } from "@/types";
import { createWorkspace } from "./workspace-fixture";

const gitStatus = vi.hoisted(() => ({
  useGitStatus:
    vi.fn<
      (workspaceId: string | null) => { data: GitStatusResult | undefined }
    >(),
}));

vi.mock("@/hooks/use-git", () => ({ useGitStatus: gitStatus.useGitStatus }));

// The explorer has its own tests; here it only marks where the view renders.
vi.mock("@/components/workbench/context-sidebar/explorer-view", () => ({
  ExplorerView: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="explorer-view">explorer:{workspaceId}</div>
  ),
}));

vi.mock("@/components/workbench/context-sidebar/changes-view", () => ({
  ChangesView: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="changes-view">changes:{workspaceId}</div>
  ),
}));

vi.mock("@/components/workbench/context-sidebar/compare-view", () => ({
  CompareView: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="compare-view">compare:{workspaceId}</div>
  ),
}));

vi.mock("@/components/workbench/context-sidebar/status-view", () => ({
  StatusView: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="status-view">status:{workspaceId}</div>
  ),
}));

const WORKSPACE_ID = "ws-1";
const VIEW_LABELS = ["Explorer", "Changes", "Compare", "Status"];

function makeStatus(overrides: Partial<GitStatusResult>): GitStatusResult {
  return {
    isRepo: true,
    branch: "main",
    tracking: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    lastCommit: null,
    ...overrides,
  };
}

function renderContextSidebar({ isMobile }: { readonly isMobile: boolean }) {
  return render(
    <TooltipProvider>
      <WorkbenchModeProvider isMobile={isMobile}>
        <ContextSidebar
          workspaceId={WORKSPACE_ID}
          workspace={createWorkspace(WORKSPACE_ID)}
        />
      </WorkbenchModeProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  gitStatus.useGitStatus.mockReset();
  gitStatus.useGitStatus.mockReturnValue({ data: makeStatus({}) });
  useContextSidebarStore.setState(
    useContextSidebarStore.getInitialState(),
    true,
  );
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
});

afterEach(() => {
  cleanup();
});

describe("ContextSidebar on desktop", () => {
  it("shows a rail button for each view", () => {
    // When
    renderContextSidebar({ isMobile: false });

    // Then
    for (const label of VIEW_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("shows the open view left of the rail", () => {
    // Given
    useContextSidebarStore.setState({ isOpen: true, view: "explorer" });

    // When
    renderContextSidebar({ isMobile: false });

    // Then
    const content = screen.getByTestId("explorer-view");
    expect(content).toHaveTextContent(`explorer:${WORKSPACE_ID}`);
    expect(
      content.compareDocumentPosition(
        screen.getByRole("button", { name: "Explorer" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides the sidebar when the active view is clicked while open", async () => {
    // Given
    useContextSidebarStore.setState({ isOpen: true, view: "explorer" });
    renderContextSidebar({ isMobile: false });

    // When
    await userEvent.click(screen.getByRole("button", { name: "Explorer" }));

    // Then
    expect(useContextSidebarStore.getState().isOpen).toBe(false);
    expect(screen.queryByTestId("explorer-view")).not.toBeInTheDocument();
  });

  it("switches to another view when it is clicked while open", async () => {
    // Given
    useContextSidebarStore.setState({ isOpen: true, view: "explorer" });
    renderContextSidebar({ isMobile: false });

    // When
    await userEvent.click(screen.getByRole("button", { name: "Changes" }));

    // Then
    expect(useContextSidebarStore.getState()).toMatchObject({
      isOpen: true,
      view: "changes",
    });
    expect(screen.queryByTestId("explorer-view")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Changes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens the hidden sidebar on the clicked view", async () => {
    // Given
    useContextSidebarStore.setState({ isOpen: false, view: "explorer" });
    renderContextSidebar({ isMobile: false });

    // When
    await userEvent.click(screen.getByRole("button", { name: "Compare" }));

    // Then
    expect(useContextSidebarStore.getState()).toMatchObject({
      isOpen: true,
      view: "compare",
    });
  });

  it("counts each changed path once on the Changes button", () => {
    // Given
    gitStatus.useGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "a.ts", index: "M", workingDir: " " }],
        unstaged: [
          { path: "a.ts", index: "M", workingDir: "M" },
          { path: "b.ts", index: " ", workingDir: "M" },
        ],
        untracked: ["c.ts"],
        conflicted: ["a.ts"],
      }),
    });

    // When
    renderContextSidebar({ isMobile: false });

    // Then
    expect(screen.getByRole("button", { name: "Changes" })).toHaveTextContent(
      "3",
    );
    expect(gitStatus.useGitStatus).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("shows no Changes badge without changes", () => {
    // When
    renderContextSidebar({ isMobile: false });

    // Then
    expect(screen.getByRole("button", { name: "Changes" })).toHaveTextContent(
      /^$/,
    );
  });

  it("shows no Changes badge outside a git repository", () => {
    // Given
    gitStatus.useGitStatus.mockReturnValue({
      data: makeStatus({
        isRepo: false,
        staged: [{ path: "a.ts", index: "M", workingDir: " " }],
      }),
    });

    // When
    renderContextSidebar({ isMobile: false });

    // Then
    expect(screen.getByRole("button", { name: "Changes" })).toHaveTextContent(
      /^$/,
    );
  });

  it("widens the panel when its handle is dragged left", () => {
    // Given
    useContextSidebarStore.setState({ isOpen: true, view: "explorer" });
    renderContextSidebar({ isMobile: false });
    const handle = screen.getByRole("separator", {
      name: "Resize context sidebar",
    });

    // When
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 400 });
    fireEvent.mouseUp(document);

    // Then
    expect(screen.getByTestId("context-sidebar-content")).toHaveStyle({
      width: "420px",
    });
    expect(localStorage.getItem("dev-hub:context-sidebar-width")).toBe("420");
  });
});

describe("ContextSidebar on mobile", () => {
  it("keeps the sheet closed on first render even when the sidebar is persisted open", () => {
    // Given
    useContextSidebarStore.setState({ isOpen: true, view: "explorer" });

    // When
    renderContextSidebar({ isMobile: true });

    // Then
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("explorer-view")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Explorer" }),
    ).not.toBeInTheDocument();
  });

  it("opens the sheet on the current view when asked to", () => {
    // Given
    renderContextSidebar({ isMobile: true });

    // When
    act(() => useContextSidebarStore.getState().setMobileSheetOpen(true));

    // Then
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByTestId("explorer-view")).toBeInTheDocument();
    for (const label of VIEW_LABELS) {
      expect(
        within(sheet).getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
  });

  it("switches the view from the sheet's switcher row", async () => {
    // Given
    renderContextSidebar({ isMobile: true });
    act(() => useContextSidebarStore.getState().setMobileSheetOpen(true));

    // When
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Status",
      }),
    );

    // Then
    expect(useContextSidebarStore.getState()).toMatchObject({
      view: "status",
      isOpen: true,
      isMobileSheetOpen: true,
    });
    expect(
      within(screen.getByRole("dialog")).getByTestId("status-view"),
    ).toHaveTextContent(`status:${WORKSPACE_ID}`);
  });

  it("closes the sheet from its close button", async () => {
    // Given
    renderContextSidebar({ isMobile: true });
    act(() => useContextSidebarStore.getState().setMobileSheetOpen(true));

    // When
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Close panels",
      }),
    );

    // Then
    expect(useContextSidebarStore.getState().isMobileSheetOpen).toBe(false);
  });

  it("closes the sheet when another tab takes focus", () => {
    // Given
    renderContextSidebar({ isMobile: true });
    act(() => useContextSidebarStore.getState().setMobileSheetOpen(true));

    // When
    act(() =>
      useWorkbenchStore.getState().setFocusedPanel({
        workspaceId: WORKSPACE_ID,
        panelId: "tab-a",
        params: { kind: "file", workspaceId: WORKSPACE_ID, path: "a.ts" },
      }),
    );

    // Then
    expect(useContextSidebarStore.getState().isMobileSheetOpen).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
