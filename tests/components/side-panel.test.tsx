import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/components/chat/workspace-context-panel", () => ({
  WorkspaceContextPanel: (props: Record<string, unknown>) => (
    <div
      data-testid="workspace-context-panel"
      data-workspace-id={props.workspaceId}
    />
  ),
}));

vi.mock("@/components/chat/task-progress", () => ({
  TaskProgressPanel: (props: Record<string, unknown>) => (
    <div
      data-testid="task-progress-panel"
      data-todos={JSON.stringify(props.todos)}
    />
  ),
}));

vi.mock("@/components/chat/mcp-status", () => ({
  McpStatusPanel: () => <div data-testid="mcp-status-panel" />,
}));

vi.mock("@/components/chat/session-files-panel", () => ({
  SessionFilesPanel: (props: Record<string, unknown>) => (
    <div
      data-testid="session-files-panel"
      data-workspace-path={props.workspacePath}
    />
  ),
}));

vi.mock("@/components/chat/split-panel-files", () => ({
  SplitPanelFiles: (props: Record<string, unknown>) => (
    <div
      data-testid="split-panel-files"
      data-workspace-id={props.workspaceId}
    />
  ),
}));

const mockSetActivePanelTab = vi.fn();
const mockClosePanel = vi.fn();

vi.mock("@/stores/side-panel-store", () => ({
  useSidePanelStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        activePanelTab: currentTab,
        setActivePanelTab: mockSetActivePanelTab,
        closePanel: mockClosePanel,
      }),
    {
      getState: () => ({
        activePanelTab: currentTab,
        setActivePanelTab: mockSetActivePanelTab,
        closePanel: mockClosePanel,
      }),
    },
  ),
}));

let currentTab: "status" | "files" = "status";

import type { SidePanelProps } from "@/components/chat/side-panel";
import { SidePanel } from "@/components/chat/side-panel";

const defaultProps = {
  width: 400,
  handleDragStart: vi.fn(),
  workspaceId: "ws-123",
  onEscape: vi.fn(),
  workspace: { id: "ws-123", name: "test" },
  activeTodos: [],
  messages: [],
  workspacePath: "/path/to/workspace",
} as unknown as SidePanelProps;

describe("SidePanel", () => {
  beforeEach(() => {
    currentTab = "status";
    mockSetActivePanelTab.mockClear();
    mockClosePanel.mockClear();
  });

  it("renders Status and Files tab labels", () => {
    render(<SidePanel {...defaultProps} />);
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Files")).toBeInTheDocument();
  });

  it("clicking Files tab calls setActivePanelTab('files')", async () => {
    const user = userEvent.setup();
    render(<SidePanel {...defaultProps} />);
    await user.click(screen.getByText("Files"));
    expect(mockSetActivePanelTab).toHaveBeenCalledWith("files");
  });

  it("clicking Status tab calls setActivePanelTab('status')", async () => {
    currentTab = "files";
    const user = userEvent.setup();
    render(<SidePanel {...defaultProps} />);
    await user.click(screen.getByText("Status"));
    expect(mockSetActivePanelTab).toHaveBeenCalledWith("status");
  });

  it("renders Status content when activePanelTab is status", () => {
    render(<SidePanel {...defaultProps} />);
    expect(screen.getByTestId("workspace-context-panel")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-status-panel")).toBeInTheDocument();
    expect(screen.getByTestId("session-files-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("split-panel-files")).not.toBeInTheDocument();
  });

  it("renders SplitPanelFiles when activePanelTab is files", () => {
    currentTab = "files";
    render(<SidePanel {...defaultProps} />);
    expect(screen.getByTestId("split-panel-files")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-context-panel"),
    ).not.toBeInTheDocument();
  });

  it("close button calls closePanel", async () => {
    const user = userEvent.setup();
    render(<SidePanel {...defaultProps} />);
    await user.click(screen.getByTestId("side-panel-close"));
    expect(mockClosePanel).toHaveBeenCalled();
  });

  it("renders resize handle", () => {
    render(<SidePanel {...defaultProps} />);
    expect(screen.getByTestId("side-panel-resize-handle")).toBeInTheDocument();
  });

  it("renders TaskProgressPanel when activeTodos has items", () => {
    const propsWithTodos = {
      ...defaultProps,
      activeTodos: [{ id: "1", content: "todo" }],
    } as unknown as SidePanelProps;
    render(<SidePanel {...propsWithTodos} />);
    expect(screen.getByTestId("task-progress-panel")).toBeInTheDocument();
  });

  it("does not render TaskProgressPanel when activeTodos is empty", () => {
    render(<SidePanel {...defaultProps} />);
    expect(screen.queryByTestId("task-progress-panel")).not.toBeInTheDocument();
  });

  it("highlights active tab with font-medium", () => {
    render(<SidePanel {...defaultProps} />);
    const statusTab = screen.getByText("Status");
    expect(statusTab.className).toContain("font-medium");
    expect(statusTab.className).toContain("text-foreground");
  });
});
