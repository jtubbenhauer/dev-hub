import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownContent } from "@/components/chat/markdown-content";

vi.mock("@/hooks/use-github", () => ({
  useGitHubPr: vi.fn().mockReturnValue({
    data: {
      number: 42,
      title: "Fix bug",
      state: "open",
      draft: false,
      user: { login: "alice" },
      merge_commit_sha: null,
    },
    isLoading: false,
    isError: false,
  }),
}));

import { useGitHubPr } from "@/hooks/use-github";
const mockUseGitHubPr = useGitHubPr as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  mockUseGitHubPr.mockReturnValue({
    data: {
      number: 42,
      title: "Fix bug",
      state: "open",
      draft: false,
      user: { login: "alice" },
      merge_commit_sha: null,
    },
    isLoading: false,
    isError: false,
  });
});

describe("MarkdownContent PR badge rendering", () => {
  describe("no-op when owner/repo missing", () => {
    it("renders plain #NNN text when owner is not provided", () => {
      render(<MarkdownContent content="see #42 for details" repo="myrepo" />);
      expect(screen.getByText(/see #42 for details/)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("renders plain #NNN text when repo is not provided", () => {
      render(<MarkdownContent content="see #42 for details" owner="acme" />);
      expect(screen.getByText(/see #42 for details/)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("renders plain #NNN text when neither owner nor repo is provided", () => {
      render(<MarkdownContent content="check #100 for context" />);
      expect(screen.getByText(/check #100 for context/)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("#NNN replaced with badge", () => {
    it("renders PrBadge when owner and repo are provided", () => {
      render(
        <MarkdownContent
          content="see #42 for details"
          owner="acme"
          repo="myapp"
        />,
      );
      expect(mockUseGitHubPr).toHaveBeenCalledWith("acme", "myapp", 42);
    });

    it("renders the PR badge as a link with correct href", () => {
      render(
        <MarkdownContent
          content="see #42 for details"
          owner="acme"
          repo="myapp"
        />,
      );
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute(
        "href",
        "https://github.com/acme/myapp/pull/42",
      );
    });

    it("renders PR title inside the badge", () => {
      render(
        <MarkdownContent
          content="see #42 for details"
          owner="acme"
          repo="myapp"
        />,
      );
      expect(screen.getByText("Fix bug")).toBeInTheDocument();
    });
  });

  describe("multiple PRs in one paragraph", () => {
    it("renders multiple badges for multiple #NNN references", () => {
      mockUseGitHubPr
        .mockReturnValueOnce({
          data: {
            number: 10,
            title: "First PR",
            state: "open",
            draft: false,
            user: { login: "bob" },
            merge_commit_sha: null,
          },
          isLoading: false,
          isError: false,
        })
        .mockReturnValueOnce({
          data: {
            number: 20,
            title: "Second PR",
            state: "open",
            draft: false,
            user: { login: "carol" },
            merge_commit_sha: null,
          },
          isLoading: false,
          isError: false,
        });

      render(
        <MarkdownContent
          content="Fixes #10 and also #20 are related"
          owner="acme"
          repo="myapp"
        />,
      );

      expect(mockUseGitHubPr).toHaveBeenCalledWith("acme", "myapp", 10);
      expect(mockUseGitHubPr).toHaveBeenCalledWith("acme", "myapp", 20);
      expect(screen.getByText("First PR")).toBeInTheDocument();
      expect(screen.getByText("Second PR")).toBeInTheDocument();
    });
  });

  describe("no replacement inside inline code", () => {
    it("does not render PrBadge for #NNN inside backtick inline code", () => {
      render(
        <MarkdownContent
          content="use `#42` as the reference"
          owner="acme"
          repo="myapp"
        />,
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByText("#42")).toBeInTheDocument();
    });
  });

  describe("non-PR # patterns not replaced", () => {
    it("does not replace #abc (non-digit) with a badge", () => {
      render(
        <MarkdownContent
          content="see #abc for details"
          owner="acme"
          repo="myapp"
        />,
      );
      expect(mockUseGitHubPr).not.toHaveBeenCalled();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("does not replace a lone # with a badge", () => {
      render(
        <MarkdownContent
          content="the # symbol appears here"
          owner="acme"
          repo="myapp"
        />,
      );
      expect(mockUseGitHubPr).not.toHaveBeenCalled();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("does not process markdown headings as PR badges", () => {
      render(
        <MarkdownContent content="# Heading text" owner="acme" repo="myapp" />,
      );
      expect(mockUseGitHubPr).not.toHaveBeenCalled();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("PR at start of text", () => {
    it("renders a badge for #NNN at the start of a paragraph", () => {
      render(
        <MarkdownContent
          content="#42 is the issue"
          owner="acme"
          repo="myapp"
        />,
      );
      expect(mockUseGitHubPr).toHaveBeenCalledWith("acme", "myapp", 42);
      expect(screen.getByRole("link")).toBeInTheDocument();
    });
  });
});
