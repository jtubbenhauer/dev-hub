import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LensSidebar } from "@/components/lens/lens-sidebar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Workspace } from "@/types";

const mockOnAction = vi.fn();

const mockWorkspaces: Workspace[] = [
  {
    id: "ws-1",
    userId: "user-1",
    name: "dev-hub",
    path: "/home/jack/dev/dev-hub",
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
    color: "#3b82f6",
    createdAt: new Date(),
    lastAccessedAt: new Date(),
  },
  {
    id: "ws-2",
    userId: "user-1",
    name: "my-project",
    path: "/home/jack/dev/my-project",
    type: "repo",
    parentRepoPath: null,
    packageManager: "npm",
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
  },
];

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({ workspaces: mockWorkspaces }),
  ),
}));

vi.mock("@/stores/chat-store", () => ({
  useChatStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({ workspaceStates: {} }),
  ),
}));

vi.mock("@/hooks/use-git", () => ({
  useGitStatus: vi.fn(() => ({
    data: {
      isRepo: true,
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      lastCommit: null,
    },
  })),
}));

vi.mock("@/hooks/use-github", () => ({
  useGitHubPrsCreatedByMe: vi.fn(() => ({ data: [] })),
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("LensSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the command center header", () => {
    renderWithProviders(
      <LensSidebar onAction={mockOnAction} isStreaming={false} />,
    );
    expect(screen.getByText("Command Center")).toBeInTheDocument();
  });

  it("renders workspace names", () => {
    renderWithProviders(
      <LensSidebar onAction={mockOnAction} isStreaming={false} />,
    );
    expect(screen.getByText("dev-hub")).toBeInTheDocument();
    expect(screen.getByText("my-project")).toBeInTheDocument();
  });

  it("renders workspaces section with count badge", () => {
    renderWithProviders(
      <LensSidebar onAction={mockOnAction} isStreaming={false} />,
    );
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("calls onAction with workspace prompt when clicking a workspace", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <LensSidebar onAction={mockOnAction} isStreaming={false} />,
    );

    await user.click(screen.getByText("dev-hub"));
    expect(mockOnAction).toHaveBeenCalledWith(
      expect.stringContaining("dev-hub"),
    );
  });

  it("renders quick actions in stack layout", () => {
    renderWithProviders(
      <LensSidebar onAction={mockOnAction} isStreaming={false} />,
    );
    expect(screen.getByText("Brief me")).toBeInTheDocument();
    expect(screen.getByText("Active sessions")).toBeInTheDocument();
  });

  it("disables quick actions when streaming", () => {
    renderWithProviders(
      <LensSidebar onAction={mockOnAction} isStreaming={true} />,
    );
    const briefMeButton = screen.getByText("Brief me").closest("button");
    expect(briefMeButton).toBeDisabled();
  });

  it("does not render active sessions section when all idle", () => {
    renderWithProviders(
      <LensSidebar onAction={mockOnAction} isStreaming={false} />,
    );
    expect(screen.queryByText("Active Sessions")).not.toBeInTheDocument();
  });

  it("does not render My PRs section when no PRs exist", () => {
    renderWithProviders(
      <LensSidebar onAction={mockOnAction} isStreaming={false} />,
    );
    expect(screen.queryByText("My PRs")).not.toBeInTheDocument();
  });

  it("renders My PRs section when PRs exist", async () => {
    const { useGitHubPrsCreatedByMe } = await import("@/hooks/use-github");
    vi.mocked(useGitHubPrsCreatedByMe).mockReturnValue({
      data: [
        {
          number: 42,
          node_id: "pr-42",
          title: "Add feature X",
          body: null,
          state: "open",
          draft: false,
          html_url: "https://github.com/test/repo/pull/42",
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
          user: { login: "jack", id: 1, avatar_url: "", node_id: "" },
          head: {
            label: "test:feature",
            ref: "feature",
            sha: "abc",
            repo: {
              full_name: "test/repo",
              name: "repo",
              owner: { login: "test" },
            },
          },
          base: {
            label: "test:main",
            ref: "main",
            sha: "def",
            repo: {
              full_name: "test/repo",
              name: "repo",
              owner: { login: "test" },
            },
          },
          labels: [],
          requested_reviewers: [],
          review_comments: 0,
          comments: 0,
          additions: 10,
          deletions: 5,
          changed_files: 2,
          mergeable: true,
          mergeable_state: "clean",
          merge_commit_sha: null,
        },
      ],
    } as unknown as ReturnType<typeof useGitHubPrsCreatedByMe>);

    renderWithProviders(
      <LensSidebar onAction={mockOnAction} isStreaming={false} />,
    );

    expect(screen.getByText("My PRs")).toBeInTheDocument();
    expect(screen.getByText("repo#42")).toBeInTheDocument();
    expect(screen.getByText("Add feature X")).toBeInTheDocument();
  });

  it("shows git branch info for workspaces", () => {
    renderWithProviders(
      <LensSidebar onAction={mockOnAction} isStreaming={false} />,
    );
    const branchLabels = screen.getAllByText("main");
    expect(branchLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("shows change count when files are modified", async () => {
    const { useGitStatus } = await import("@/hooks/use-git");
    vi.mocked(useGitStatus).mockReturnValue({
      data: {
        isRepo: true,
        branch: "feature-branch",
        ahead: 0,
        behind: 0,
        staged: [{ path: "a.ts", index: "M", workingDir: " " }],
        unstaged: [{ path: "b.ts", index: " ", workingDir: "M" }],
        untracked: ["c.ts"],
        lastCommit: null,
      },
    } as unknown as ReturnType<typeof useGitStatus>);

    renderWithProviders(
      <LensSidebar onAction={mockOnAction} isStreaming={false} />,
    );

    const changeCountElements = screen.getAllByText("3");
    expect(changeCountElements.length).toBeGreaterThanOrEqual(1);
  });

  it("collapses workspaces section when header is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <LensSidebar onAction={mockOnAction} isStreaming={false} />,
    );

    expect(screen.getByText("dev-hub")).toBeInTheDocument();

    await user.click(screen.getByText("Workspaces"));

    expect(screen.queryByText("dev-hub")).not.toBeInTheDocument();
  });
});
