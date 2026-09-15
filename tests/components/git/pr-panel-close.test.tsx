import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { GitHubPullRequest } from "@/types";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

vi.mock("@/hooks/use-resizable-panel", () => ({
  useResizablePanel: vi.fn(() => ({
    width: 280,
    handleDragStart: vi.fn(),
  })),
}));

vi.mock("@/components/git/pr-diff-editor", () => ({
  PrDiffEditor: () => null,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const emptyQuery = { data: [], isLoading: false };
const emptyMutation = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
};

vi.mock("@/hooks/use-github", () => ({
  useGitHubPrsAwaitingReview: vi.fn(() => ({ data: [], isLoading: false })),
  useGitHubPrsCreatedByMe: vi.fn(() => ({ data: [], isLoading: false })),
  useGitHubPr: vi.fn(() => ({ data: undefined, isLoading: false })),
  useGitHubPrFiles: vi.fn(() => emptyQuery),
  useGitHubPrComments: vi.fn(() => ({ data: [] })),
  useGitHubPrReviewThreads: vi.fn(() => ({ data: [] })),
  useGitHubPrReviews: vi.fn(() => ({ data: [] })),
  useGitHubPrChecks: vi.fn(() => ({ data: [] })),
  useGitHubPrFileContent: vi.fn(() => ({ data: undefined, isLoading: false })),
  useGitHubAddComment: vi.fn(() => emptyMutation),
  useGitHubReplyToComment: vi.fn(() => emptyMutation),
  useGitHubEditComment: vi.fn(() => emptyMutation),
  useGitHubDeleteComment: vi.fn(() => emptyMutation),
  useGitHubSubmitReview: vi.fn(() => emptyMutation),
  useGitHubToggleThreadResolved: vi.fn(() => emptyMutation),
  useGitHubMergePr: vi.fn(() => emptyMutation),
  useGitHubCurrentUser: vi.fn(() => ({ data: null })),
  useGitHubPrViewedFiles: vi.fn(() => ({ data: [] })),
  useGitHubToggleFileViewed: vi.fn(() => emptyMutation),
}));

import { useGitHubPr } from "@/hooks/use-github";
import { PrPanel } from "@/components/git/pr-panel";

const mockUseGitHubPr = useGitHubPr as ReturnType<typeof vi.fn>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    );
  };
}

function makePr(): GitHubPullRequest {
  return {
    number: 5,
    title: "Add feature",
    body: "",
    html_url: "https://github.com/acme/web/pull/5",
    node_id: "PR_node_5",
    draft: false,
    state: "open",
    created_at: "2024-01-15T10:00:00Z",
    review_comments: 0,
    additions: 10,
    deletions: 2,
    mergeable: true,
    mergeable_state: "clean",
    requested_reviewers: [],
    user: { login: "alice", id: 1, avatar_url: "" },
    base: {
      sha: "basesha",
      ref: "main",
      repo: {
        name: "web",
        full_name: "acme/web",
        owner: { login: "acme", id: 2, avatar_url: "" },
      },
    },
    head: { sha: "headsha", ref: "feature" },
  } as unknown as GitHubPullRequest;
}

describe("PrPanel close button", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseGitHubPr.mockReturnValue({ data: undefined, isLoading: false });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  describe("list view", () => {
    it("hides the close button when onClose is not provided", () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <PrPanel />
        </Wrapper>,
      );

      expect(
        screen.queryByRole("button", { name: "Close PR review" }),
      ).toBeNull();
    });

    it("renders and fires the close button when onClose is provided", () => {
      const onClose = vi.fn();
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <PrPanel onClose={onClose} />
        </Wrapper>,
      );

      const closeButton = screen.getByRole("button", {
        name: "Close PR review",
      });
      expect(closeButton).toBeInTheDocument();
      fireEvent.click(closeButton);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("detail view", () => {
    beforeEach(() => {
      localStorage.setItem("dev-hub:git-selected-pr", "acme/web/5");
      mockUseGitHubPr.mockReturnValue({ data: makePr(), isLoading: false });
    });

    it("hides the close button when onClose is not provided", () => {
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <PrPanel />
        </Wrapper>,
      );

      expect(screen.getByText("Add feature")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Close PR review" }),
      ).toBeNull();
    });

    it("renders and fires the close button when onClose is provided", () => {
      const onClose = vi.fn();
      const Wrapper = createWrapper();
      render(
        <Wrapper>
          <PrPanel onClose={onClose} />
        </Wrapper>,
      );

      expect(screen.getByText("Add feature")).toBeInTheDocument();
      const closeButton = screen.getByRole("button", {
        name: "Close PR review",
      });
      expect(closeButton).toBeInTheDocument();
      fireEvent.click(closeButton);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
