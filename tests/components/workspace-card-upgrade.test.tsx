import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceCard } from "@/components/workspace/workspace-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Workspace } from "@/types";

const mockUpgrade = vi.fn();

vi.mock("@/hooks/use-workspace-upgrade", () => ({
  useWorkspaceUpgrade: vi.fn(() => ({
    canUpgrade: true,
    isUpgrading: false,
    upgrade: mockUpgrade,
  })),
}));

vi.mock("@/hooks/use-workspace-resume", () => ({
  useWorkspaceResume: vi.fn(() => ({ isResuming: false, resume: vi.fn() })),
}));

vi.mock("@/hooks/use-git", () => ({
  useAgentHealth: vi.fn(() => ({ data: "healthy" })),
  useGitStatus: vi.fn(() => ({ data: null })),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: vi.fn(() => ({ setActiveWorkspaceId: vi.fn() })),
}));

vi.mock("@/stores/command-store", () => ({
  useCommandStore: vi.fn(() => vi.fn()),
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

const remoteWorkspace: Workspace = {
  id: "ws-remote",
  userId: "user-1",
  name: "fix-invoices",
  path: "/home/dev/code",
  type: "repo",
  parentRepoPath: null,
  packageManager: null,
  quickCommands: null,
  backend: "remote",
  provider: "rig-cli",
  opencodeUrl: null,
  agentUrl: null,
  providerMeta: { providerId: "provider-rig" },
  shellCommand: null,
  sshTarget: null,
  sshPath: null,
  worktreeSymlinks: null,
  linkedTaskId: null,
  linkedTaskMeta: null,
  color: null,
  createdAt: new Date(),
  lastAccessedAt: new Date(),
};

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WorkspaceCard
          workspace={remoteWorkspace}
          onDelete={vi.fn()}
          isDeleting={false}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

async function openActionsMenu(user: ReturnType<typeof userEvent.setup>) {
  const menuButton = screen
    .getAllByRole("button")
    .find((button) => button.querySelector(".lucide-ellipsis"));
  if (!menuButton) throw new Error("actions menu button not found");
  await user.click(menuButton);
}

describe("WorkspaceCard upgrade action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upgrades the container after confirmation", async () => {
    const user = userEvent.setup();
    renderCard();

    await openActionsMenu(user);
    await user.click(
      await screen.findByRole("menuitem", { name: /Upgrade container/i }),
    );

    expect(
      await screen.findByRole("alertdialog", { name: /Upgrade fix-invoices/i }),
    ).toBeInTheDocument();
    expect(mockUpgrade).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Upgrade" }));
    expect(mockUpgrade).toHaveBeenCalledTimes(1);
  });

  it("does not upgrade when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    renderCard();

    await openActionsMenu(user);
    await user.click(
      await screen.findByRole("menuitem", { name: /Upgrade container/i }),
    );
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(mockUpgrade).not.toHaveBeenCalled();
  });

  it("hides the action when the provider has no upgrade command", async () => {
    const { useWorkspaceUpgrade } =
      await import("@/hooks/use-workspace-upgrade");
    vi.mocked(useWorkspaceUpgrade).mockReturnValue({
      canUpgrade: false,
      isUpgrading: false,
      upgrade: mockUpgrade,
    });
    const user = userEvent.setup();
    renderCard();

    await openActionsMenu(user);
    expect(
      await screen.findByRole("menuitem", { name: /Link Task/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /Upgrade container/i }),
    ).not.toBeInTheDocument();
  });
});
