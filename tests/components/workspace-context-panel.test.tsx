import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceContextPanel } from "@/components/chat/workspace-context-panel";
import { useFirebasePreview } from "@/hooks/use-firebase-preview";
import type { Workspace } from "@/types";

vi.mock("@/hooks/use-firebase-preview");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

const mockWorkspace: Workspace = {
  id: "ws-1",
  userId: "user-1",
  name: "Test Workspace",
  path: "/test/path",
  type: "repo",
  parentRepoPath: null,
  packageManager: "pnpm",
  quickCommands: null,
  backend: "local",
  provider: null,
  opencodeUrl: null,
  agentUrl: null,
  providerMeta: null,
  shellCommand: null,
  worktreeSymlinks: null,
  linkedTaskId: null,
  linkedTaskMeta: null,
  color: null,
  createdAt: new Date(),
  lastAccessedAt: new Date(),
};

describe("WorkspaceContextPanel", () => {
  it("renders nothing when no data is available", () => {
    vi.mocked(useFirebasePreview).mockReturnValue({
      previews: [],
      pr: null,
      isLoading: false,
      owner: null,
      repo: null,
      branch: null,
    });

    render(
      <WorkspaceContextPanel workspaceId="ws-1" workspace={mockWorkspace} />,
      { wrapper: Wrapper },
    );

    expect(screen.queryByText("No linked task")).not.toBeInTheDocument();
  });

  it("renders ClickUp link when linkedTaskMeta is present", () => {
    vi.mocked(useFirebasePreview).mockReturnValue({
      previews: [],
      pr: null,
      isLoading: false,
      owner: null,
      repo: null,
      branch: null,
    });

    const workspaceWithTask: Workspace = {
      ...mockWorkspace,
      linkedTaskMeta: {
        name: "Test Task",
        customId: "DEV-123",
        url: "https://app.clickup.com/t/DEV-123",
        status: "in progress",
        provider: "clickup",
      },
    };

    render(
      <WorkspaceContextPanel
        workspaceId="ws-1"
        workspace={workspaceWithTask}
      />,
      { wrapper: Wrapper },
    );

    const link = screen.getByRole("link", { name: "DEV-123 · Test Task" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://app.clickup.com/t/DEV-123");
    expect(screen.getByText("in progress")).toBeInTheDocument();
  });
});
