import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceCard } from "@/components/workspace/workspace-card";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Workspace } from "@/types";

import { TooltipProvider } from "@/components/ui/tooltip";

const mockResume = vi.fn();
const mockSetActiveWorkspaceId = vi.fn();
const mockRunCommand = vi.fn();
const mockSetDrawerOpen = vi.fn();

vi.mock("@/hooks/use-workspace-resume", () => ({
  useWorkspaceResume: vi.fn(() => ({
    isResuming: false,
    resume: mockResume,
  })),
}));

vi.mock("@/hooks/use-git", () => ({
  useAgentHealth: vi.fn(() => ({ data: "healthy" })),
  useGitStatus: vi.fn(() => ({ data: null })),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: vi.fn(() => ({
    setActiveWorkspaceId: mockSetActiveWorkspaceId,
  })),
}));

vi.mock("@/stores/command-store", () => ({
  useCommandStore: vi.fn(() => ({
    runCommand: mockRunCommand,
    setDrawerOpen: mockSetDrawerOpen,
  })),
}));

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

HTMLElement.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
HTMLElement.prototype.releasePointerCapture = vi.fn();

if (typeof window !== "undefined") {
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;

    constructor(type: string, props: PointerEventInit) {
      super(type, props);
      this.button = props.button || 0;
      this.ctrlKey = props.ctrlKey || false;
      this.pointerType = props.pointerType || "mouse";
    }
  }
  window.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;
}

const mockWorkspace = {
  id: "ws-1",
  name: "Test Workspace",
  path: "/test/path",
  type: "repo",
  backend: "remote",
  createdAt: new Date(),
} as Workspace;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("WorkspaceCard Status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders amber dot when suspended", async () => {
    const { useAgentHealth } = await import("@/hooks/use-git");
    vi.mocked(useAgentHealth).mockReturnValue({
      data: "suspended",
    } as ReturnType<typeof useAgentHealth>);

    renderWithProviders(
      <WorkspaceCard
        workspace={mockWorkspace}
        onDelete={vi.fn()}
        isDeleting={false}
      />,
    );

    const badge = screen.getByText("suspended");
    expect(badge).toBeInTheDocument();

    const dot = badge.parentElement?.querySelector(".bg-amber-500");
    expect(dot).toBeInTheDocument();
  });

  it("renders spinner when resuming", async () => {
    const { useWorkspaceResume } = await import("@/hooks/use-workspace-resume");
    vi.mocked(useWorkspaceResume).mockReturnValue({
      isResuming: true,
      resume: mockResume,
    });

    renderWithProviders(
      <WorkspaceCard
        workspace={mockWorkspace}
        onDelete={vi.fn()}
        isDeleting={false}
      />,
    );

    const badge = screen.getByText("resuming");
    expect(badge).toBeInTheDocument();

    const spinner = badge.parentElement?.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("calls resume() when clicking Chat on suspended workspace", async () => {
    const { useAgentHealth } = await import("@/hooks/use-git");
    vi.mocked(useAgentHealth).mockReturnValue({
      data: "suspended",
    } as ReturnType<typeof useAgentHealth>);

    const { useWorkspaceResume } = await import("@/hooks/use-workspace-resume");
    vi.mocked(useWorkspaceResume).mockReturnValue({
      isResuming: false,
      resume: mockResume,
    });

    const user = userEvent.setup();
    renderWithProviders(
      <WorkspaceCard
        workspace={mockWorkspace}
        onDelete={vi.fn()}
        isDeleting={false}
      />,
    );

    const chatLink = screen.getByRole("link", { name: /Chat/i });
    await user.click(chatLink);

    expect(mockResume).toHaveBeenCalledTimes(1);
    expect(mockSetActiveWorkspaceId).toHaveBeenCalledWith("ws-1");
  });

  it("does not call resume() when clicking Chat on healthy workspace", async () => {
    const { useAgentHealth } = await import("@/hooks/use-git");
    vi.mocked(useAgentHealth).mockReturnValue({ data: "healthy" } as ReturnType<
      typeof useAgentHealth
    >);

    const { useWorkspaceResume } = await import("@/hooks/use-workspace-resume");
    vi.mocked(useWorkspaceResume).mockReturnValue({
      isResuming: false,
      resume: mockResume,
    });

    const user = userEvent.setup();
    renderWithProviders(
      <WorkspaceCard
        workspace={mockWorkspace}
        onDelete={vi.fn()}
        isDeleting={false}
      />,
    );

    const chatLink = screen.getByRole("link", { name: /Chat/i });
    await user.click(chatLink);

    expect(mockResume).not.toHaveBeenCalled();
    expect(mockSetActiveWorkspaceId).toHaveBeenCalledWith("ws-1");
  });
});
