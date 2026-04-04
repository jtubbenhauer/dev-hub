import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrBadge } from "@/components/chat/pr-badge";

vi.mock("@/hooks/use-github", () => ({
  useGitHubPr: vi.fn(),
}));

import { useGitHubPr } from "@/hooks/use-github";
const mockUseGitHubPr = useGitHubPr as ReturnType<typeof vi.fn>;

const openPr = {
  number: 123,
  title: "Add new feature",
  state: "open" as const,
  draft: false,
  merge_commit_sha: null,
  html_url: "https://github.com/owner/repo/pull/123",
  user: { login: "alice", avatar_url: "" },
  head: { ref: "feature-branch" },
  base: { ref: "main" },
};

const mergedPr = {
  ...openPr,
  state: "closed" as const,
  merge_commit_sha: "abc123def456",
};

const closedPr = {
  ...openPr,
  state: "closed" as const,
  merge_commit_sha: null,
};

const draftPr = {
  ...openPr,
  draft: true,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PrBadge", () => {
  describe("loading state", () => {
    it("renders plain #number text when isLoading is true", () => {
      mockUseGitHubPr.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      expect(screen.getByText("#123")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders plain #number text when data is null (PR not found)", () => {
      mockUseGitHubPr.mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      expect(screen.getByText("#123")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("renders plain #number text when isError is true", () => {
      mockUseGitHubPr.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      expect(screen.getByText("#123")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("open PR", () => {
    it("renders badge with green status dot for open PR", () => {
      mockUseGitHubPr.mockReturnValue({
        data: openPr,
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      const statusDot = document.querySelector(".bg-green-500");
      expect(statusDot).toBeInTheDocument();
    });

    it("renders PR number in badge", () => {
      mockUseGitHubPr.mockReturnValue({
        data: openPr,
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      expect(screen.getByText("#123")).toBeInTheDocument();
    });

    it("renders PR title in badge", () => {
      mockUseGitHubPr.mockReturnValue({
        data: openPr,
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      expect(screen.getByText("Add new feature")).toBeInTheDocument();
    });

    it("renders author login in badge", () => {
      mockUseGitHubPr.mockReturnValue({
        data: openPr,
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      expect(screen.getByText(/alice/)).toBeInTheDocument();
    });
  });

  describe("merged PR", () => {
    it("renders badge with purple status dot when merge_commit_sha is truthy", () => {
      mockUseGitHubPr.mockReturnValue({
        data: mergedPr,
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      const statusDot = document.querySelector(".bg-purple-500");
      expect(statusDot).toBeInTheDocument();
    });
  });

  describe("closed PR", () => {
    it("renders badge with red status dot for closed PR without merge_commit_sha", () => {
      mockUseGitHubPr.mockReturnValue({
        data: closedPr,
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      const statusDot = document.querySelector(".bg-red-500");
      expect(statusDot).toBeInTheDocument();
    });
  });

  describe("draft PR", () => {
    it("renders badge with grey status dot for draft PR", () => {
      mockUseGitHubPr.mockReturnValue({
        data: draftPr,
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      const statusDot = document.querySelector(".bg-gray-400");
      expect(statusDot).toBeInTheDocument();
    });
  });

  describe("title truncation", () => {
    it("truncates title longer than 60 chars with '...'", () => {
      const longTitle = "A".repeat(61);
      mockUseGitHubPr.mockReturnValue({
        data: { ...openPr, title: longTitle },
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      expect(screen.getByText(`${"A".repeat(60)}...`)).toBeInTheDocument();
    });

    it("does not truncate title with exactly 60 chars", () => {
      const title60 = "B".repeat(60);
      mockUseGitHubPr.mockReturnValue({
        data: { ...openPr, title: title60 },
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      expect(screen.getByText(title60)).toBeInTheDocument();
      expect(screen.queryByText(`${title60}...`)).not.toBeInTheDocument();
    });
  });

  describe("click behavior", () => {
    it("renders as a link with correct GitHub URL", () => {
      mockUseGitHubPr.mockReturnValue({
        data: openPr,
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      const link = screen.getByRole("link");
      expect(link).toHaveAttribute(
        "href",
        "https://github.com/owner/repo/pull/123",
      );
    });

    it("opens in new tab", () => {
      mockUseGitHubPr.mockReturnValue({
        data: openPr,
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("target", "_blank");
    });

    it("has rel=noopener for security", () => {
      mockUseGitHubPr.mockReturnValue({
        data: openPr,
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={123} owner="owner" repo="repo" />);

      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  describe("hook call", () => {
    it("calls useGitHubPr with correct owner, repo, prNumber", () => {
      mockUseGitHubPr.mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
      });

      render(<PrBadge prNumber={42} owner="myorg" repo="myrepo" />);

      expect(mockUseGitHubPr).toHaveBeenCalledWith("myorg", "myrepo", 42);
    });
  });
});
