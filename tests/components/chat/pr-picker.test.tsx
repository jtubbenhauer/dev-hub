import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/use-github-repo-prs", () => ({
  useGitHubRepoPrs: vi.fn(),
}));

import { useGitHubRepoPrs } from "@/hooks/use-github-repo-prs";
import { PrPicker } from "@/components/chat/pr-picker";

const mockUseGitHubRepoPrs = useGitHubRepoPrs as ReturnType<typeof vi.fn>;

interface RepoPr {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merged_at: string | null;
  user: { login: string; avatar_url: string };
  head: { ref: string };
}

const openPr: RepoPr = {
  number: 42,
  title: "Add dark mode",
  state: "open",
  draft: false,
  merged_at: null,
  user: { login: "alice", avatar_url: "" },
  head: { ref: "feature/dark-mode" },
};

const draftPr: RepoPr = {
  number: 55,
  title: "WIP: refactor auth",
  state: "open",
  draft: true,
  merged_at: null,
  user: { login: "bob", avatar_url: "" },
  head: { ref: "feature/auth-refactor" },
};

const mergedPr: RepoPr = {
  number: 12,
  title: "Fix login bug",
  state: "closed",
  draft: false,
  merged_at: "2024-01-15T10:00:00Z",
  user: { login: "carol", avatar_url: "" },
  head: { ref: "fix/login-bug" },
};

const closedPr: RepoPr = {
  number: 7,
  title: "Old feature",
  state: "closed",
  draft: false,
  merged_at: null,
  user: { login: "dave", avatar_url: "" },
  head: { ref: "feature/old" },
};

const baseProps = {
  query: "",
  owner: "acme",
  repo: "web",
  onSelect: vi.fn(),
  onDismiss: vi.fn(),
};

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  mockUseGitHubRepoPrs.mockReturnValue({ data: [], isLoading: false });
});

afterEach(() => {
  cleanup();
});

describe("PrPicker", () => {
  describe("rendering PR list", () => {
    it("renders PR number and title for each PR", () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr],
        isLoading: false,
      });

      render(<PrPicker {...baseProps} />);

      expect(screen.getByText("#42")).toBeInTheDocument();
      expect(screen.getByText("Add dark mode")).toBeInTheDocument();
    });

    it("renders multiple PRs", () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr, draftPr, mergedPr],
        isLoading: false,
      });

      render(<PrPicker {...baseProps} />);

      expect(screen.getByText("#42")).toBeInTheDocument();
      expect(screen.getByText("#55")).toBeInTheDocument();
      expect(screen.getByText("#12")).toBeInTheDocument();
      expect(screen.getByText("Add dark mode")).toBeInTheDocument();
      expect(screen.getByText("WIP: refactor auth")).toBeInTheDocument();
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    it("passes owner, repo, and search query to useGitHubRepoPrs", () => {
      render(<PrPicker {...baseProps} query="dark" />);

      expect(mockUseGitHubRepoPrs).toHaveBeenCalledWith("acme", "web", {
        search: "dark",
      });
    });
  });

  describe("search input", () => {
    it("renders a search input", () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr, draftPr],
        isLoading: false,
      });

      const { container } = render(<PrPicker {...baseProps} />);

      const searchInput = container.querySelector("[data-pr-search]");
      expect(searchInput).toBeInTheDocument();
    });

    it("filters PRs by title when typing in search input", async () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr, draftPr, mergedPr],
        isLoading: false,
      });

      const { container } = render(<PrPicker {...baseProps} />);
      const searchInput = container.querySelector(
        "[data-pr-search]",
      ) as HTMLInputElement;

      await userEvent.type(searchInput, "dark");

      expect(screen.getByText("Add dark mode")).toBeInTheDocument();
      expect(screen.queryByText("WIP: refactor auth")).not.toBeInTheDocument();
      expect(screen.queryByText("Fix login bug")).not.toBeInTheDocument();
    });

    it("filters PRs by number when typing digits in search input", async () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr, draftPr, mergedPr],
        isLoading: false,
      });

      const { container } = render(<PrPicker {...baseProps} />);
      const searchInput = container.querySelector(
        "[data-pr-search]",
      ) as HTMLInputElement;

      await userEvent.type(searchInput, "42");

      expect(screen.getByText("Add dark mode")).toBeInTheDocument();
      expect(screen.queryByText("WIP: refactor auth")).not.toBeInTheDocument();
    });

    it("filters PRs by author login", async () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr, draftPr, mergedPr],
        isLoading: false,
      });

      const { container } = render(<PrPicker {...baseProps} />);
      const searchInput = container.querySelector(
        "[data-pr-search]",
      ) as HTMLInputElement;

      await userEvent.type(searchInput, "carol");

      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
      expect(screen.queryByText("Add dark mode")).not.toBeInTheDocument();
    });

    it("shows 'No PRs found' when search matches nothing", async () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr, draftPr],
        isLoading: false,
      });

      const { container } = render(<PrPicker {...baseProps} />);
      const searchInput = container.querySelector(
        "[data-pr-search]",
      ) as HTMLInputElement;

      await userEvent.type(searchInput, "zzzznonexistent");

      expect(screen.getByText("No PRs found")).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("shows 'Loading...' when isLoading is true", () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      render(<PrPicker {...baseProps} />);

      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("does not show PR list when loading", () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: undefined,
        isLoading: true,
      });

      render(<PrPicker {...baseProps} />);

      expect(screen.queryByText("#42")).not.toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows 'No PRs found' when data is empty", () => {
      mockUseGitHubRepoPrs.mockReturnValue({ data: [], isLoading: false });

      render(<PrPicker {...baseProps} />);

      expect(screen.getByText("No PRs found")).toBeInTheDocument();
    });

    it("does not show 'No PRs found' when there are PRs", () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr],
        isLoading: false,
      });

      render(<PrPicker {...baseProps} />);

      expect(screen.queryByText("No PRs found")).not.toBeInTheDocument();
    });
  });

  describe("status dot colors", () => {
    it("shows green dot for open non-draft PR", () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr],
        isLoading: false,
      });

      const { container } = render(<PrPicker {...baseProps} />);

      const greenDots = container.querySelectorAll(".bg-green-500");
      expect(greenDots.length).toBeGreaterThan(0);
    });

    it("shows grey dot for draft PR", () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [draftPr],
        isLoading: false,
      });

      const { container } = render(<PrPicker {...baseProps} />);

      const greyDots = container.querySelectorAll(".bg-gray-400");
      expect(greyDots.length).toBeGreaterThan(0);
    });

    it("shows purple dot for merged PR (merged_at not null)", () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [mergedPr],
        isLoading: false,
      });

      const { container } = render(<PrPicker {...baseProps} />);

      const purpleDots = container.querySelectorAll(".bg-purple-500");
      expect(purpleDots.length).toBeGreaterThan(0);
    });

    it("shows red dot for closed non-merged PR", () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [closedPr],
        isLoading: false,
      });

      const { container } = render(<PrPicker {...baseProps} />);

      const redDots = container.querySelectorAll(".bg-red-500");
      expect(redDots.length).toBeGreaterThan(0);
    });
  });

  describe("keyboard navigation", () => {
    it("calls onSelect with PR number on Enter key for highlighted item", async () => {
      const onSelect = vi.fn();
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr, draftPr],
        isLoading: false,
      });

      render(<PrPicker {...baseProps} onSelect={onSelect} />);

      await userEvent.keyboard("{Enter}");

      expect(onSelect).toHaveBeenCalledWith(42);
    });

    it("calls onDismiss on Escape key", async () => {
      const onDismiss = vi.fn();
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr],
        isLoading: false,
      });

      render(<PrPicker {...baseProps} onDismiss={onDismiss} />);

      await userEvent.keyboard("{Escape}");

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("ArrowDown advances highlighted index and Enter selects second item", async () => {
      const onSelect = vi.fn();
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr, draftPr],
        isLoading: false,
      });

      render(<PrPicker {...baseProps} onSelect={onSelect} />);

      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{Enter}");

      expect(onSelect).toHaveBeenCalledWith(55);
    });

    it("ArrowUp decreases highlighted index (stays at 0 at top)", async () => {
      const onSelect = vi.fn();
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr, draftPr],
        isLoading: false,
      });

      render(<PrPicker {...baseProps} onSelect={onSelect} />);

      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{ArrowUp}");
      await userEvent.keyboard("{Enter}");

      expect(onSelect).toHaveBeenCalledWith(42);
    });

    it("ArrowUp does not go below 0 index", async () => {
      const onSelect = vi.fn();
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr, draftPr],
        isLoading: false,
      });

      render(<PrPicker {...baseProps} onSelect={onSelect} />);

      await userEvent.keyboard("{ArrowUp}");
      await userEvent.keyboard("{ArrowUp}");
      await userEvent.keyboard("{Enter}");

      expect(onSelect).toHaveBeenCalledWith(42);
    });

    it("ArrowDown does not exceed last item index", async () => {
      const onSelect = vi.fn();
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr, draftPr],
        isLoading: false,
      });

      render(<PrPicker {...baseProps} onSelect={onSelect} />);

      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{Enter}");

      expect(onSelect).toHaveBeenCalledWith(55);
    });
  });

  describe("click to select", () => {
    it("calls onSelect with PR number when PR item is clicked", async () => {
      const onSelect = vi.fn();
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr],
        isLoading: false,
      });

      render(<PrPicker {...baseProps} onSelect={onSelect} />);

      await userEvent.click(screen.getByText("Add dark mode"));

      expect(onSelect).toHaveBeenCalledWith(42);
    });
  });

  describe("highlight styling", () => {
    it("first item is highlighted by default", () => {
      mockUseGitHubRepoPrs.mockReturnValue({
        data: [openPr, draftPr],
        isLoading: false,
      });

      const { container } = render(<PrPicker {...baseProps} />);

      const items = container.querySelectorAll("[data-pr-item]");
      expect(items[0].classList.contains("bg-accent")).toBe(true);
      expect(items[1].classList.contains("bg-accent")).toBe(false);
    });
  });
});
