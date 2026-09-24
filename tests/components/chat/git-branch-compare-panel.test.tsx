import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { GitBranch, ReviewChangedFile } from "@/types";

const useGitBranchesMock = vi.fn();
const useGitChangedFilesMock = vi.fn();
vi.mock("@/hooks/use-git", () => ({
  useGitBranches: (...args: unknown[]) => useGitBranchesMock(...args),
  useGitChangedFiles: (...args: unknown[]) => useGitChangedFilesMock(...args),
}));

vi.mock("@/components/chat/side-panel-diff-view", () => ({
  SidePanelDiffView: (props: {
    workspaceId: string;
    filePath: string;
    baseRef?: string | null;
  }) => (
    <div data-testid="side-panel-diff-view">
      {props.workspaceId}:{props.filePath}:{props.baseRef}
    </div>
  ),
}));

const openDiffDialog = vi.fn();
let isDialogMode = false;
vi.mock("@/components/chat/git-diff-dialog", () => ({
  useGitDiffDialog: () => ({
    isDialogMode,
    openDiffDialog,
    diffDialog: null,
  }),
}));

import {
  GitBranchComparePanel,
  getDefaultCompareBranch,
} from "@/components/chat/git-branch-compare-panel";
import { useGitReviewStore } from "@/stores/git-review-store";
import { useSidePanelStore } from "@/stores/side-panel-store";

function makeBranch(name: string, current = false): GitBranch {
  return { name, current, commit: "abc", label: "", linkedWorkTree: false };
}

const refetch = vi.fn();

function mockChangedFiles(
  files: ReviewChangedFile[] | undefined,
  overrides: Record<string, unknown> = {},
) {
  useGitChangedFilesMock.mockReturnValue({
    data: files,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch,
    ...overrides,
  });
}

function renderPanel() {
  return render(
    <TooltipProvider>
      <GitBranchComparePanel workspaceId="ws-1" />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isDialogMode = false;
  localStorage.clear();
  useSidePanelStore.setState({ branchCompareBaseRefs: {} });
  useGitReviewStore.setState({ reviewedFiles: {} });
  useGitBranchesMock.mockReturnValue({
    data: [makeBranch("feature", true), makeBranch("main"), makeBranch("dev")],
    isLoading: false,
  });
  mockChangedFiles([
    { path: "src/a.ts", status: "modified", additions: 3, deletions: 1 },
    { path: "src/new.ts", status: "added", additions: 10, deletions: 0 },
  ]);
});

describe("getDefaultCompareBranch", () => {
  it("prefers main or master", () => {
    expect(
      getDefaultCompareBranch([makeBranch("dev"), makeBranch("master")]),
    ).toBe("master");
  });

  it("returns null when neither main nor master exists", () => {
    expect(getDefaultCompareBranch([makeBranch("dev")])).toBeNull();
  });
});

describe("GitBranchComparePanel", () => {
  it("defaults the base to main and lists changed files with totals", () => {
    renderPanel();

    expect(useGitChangedFilesMock).toHaveBeenCalledWith("ws-1", "main");
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("new.ts")).toBeInTheDocument();
    const summary = screen.getByTestId("compare-summary");
    expect(summary).toHaveTextContent("2 files");
    expect(summary).toHaveTextContent("+13");
    expect(summary).toHaveTextContent("-1");
    expect(screen.getByText(/feature/)).toBeInTheDocument();
  });

  it("uses the stored base branch for the workspace when it still exists", () => {
    useSidePanelStore.setState({ branchCompareBaseRefs: { "ws-1": "dev" } });
    renderPanel();

    expect(useGitChangedFilesMock).toHaveBeenCalledWith("ws-1", "dev");
  });

  it("falls back to the default when the stored base branch is gone", () => {
    useSidePanelStore.setState({
      branchCompareBaseRefs: { "ws-1": "deleted-branch" },
    });
    renderPanel();

    expect(useGitChangedFilesMock).toHaveBeenCalledWith("ws-1", "main");
  });

  it("opens the branch diff for a file and closes it again", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText("a.ts"));

    expect(screen.getByTestId("side-panel-diff-view")).toHaveTextContent(
      "ws-1:src/a.ts:main",
    );

    await user.click(screen.getByTestId("compare-diff-close"));
    expect(
      screen.queryByTestId("side-panel-diff-view"),
    ).not.toBeInTheDocument();
  });

  it("opens the diff dialog with the base ref in dialog mode", async () => {
    isDialogMode = true;
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText("new.ts"));

    expect(openDiffDialog).toHaveBeenCalledWith("src/new.ts", false, "main");
    expect(
      screen.queryByTestId("side-panel-diff-view"),
    ).not.toBeInTheDocument();
  });

  it("refetches when refresh is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByTestId("compare-refresh"));

    expect(refetch).toHaveBeenCalled();
  });

  it("shows an empty state when there are no differences", () => {
    mockChangedFiles([]);
    renderPanel();

    expect(screen.getByText("No differences from main")).toBeInTheDocument();
  });

  it("shows the error message when loading changed files fails", () => {
    mockChangedFiles(undefined, { error: new Error("bad ref") });
    renderPanel();

    expect(screen.getByTestId("compare-error")).toHaveTextContent("bad ref");
  });

  it("shows a message when there are no other branches", () => {
    useGitBranchesMock.mockReturnValue({
      data: [makeBranch("main", true)],
      isLoading: false,
    });
    renderPanel();

    expect(screen.getByTestId("compare-no-branches")).toBeInTheDocument();
  });

  it("prompts to pick a branch when no default exists", () => {
    useGitBranchesMock.mockReturnValue({
      data: [makeBranch("feature", true), makeBranch("dev")],
      isLoading: false,
    });
    renderPanel();

    expect(useGitChangedFilesMock).toHaveBeenCalledWith("ws-1", null);
    expect(
      screen.getByText("Select a branch to compare against"),
    ).toBeInTheDocument();
  });

  it("groups by folder by default and toggles to a flat list", async () => {
    const user = userEvent.setup();
    renderPanel();

    const groupToggle = screen.getByTestId("compare-group-toggle");
    expect(groupToggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /src/ })).toBeInTheDocument();

    await user.click(groupToggle);

    expect(groupToggle).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem("dev-hub:git-group-by-folder")).toBe("false");
    expect(screen.getAllByText("src")).toHaveLength(2);
  });

  it("cycles the sort order like the git page", async () => {
    const user = userEvent.setup();
    renderPanel();

    const sortToggle = screen.getByTestId("compare-sort-toggle");
    expect(sortToggle).toHaveTextContent("Full path");
    await user.click(sortToggle);
    expect(sortToggle).toHaveTextContent("Name A-Z");
    await user.click(sortToggle);
    expect(sortToggle).toHaveTextContent("Name Z-A");
    await user.click(sortToggle);
    expect(sortToggle).toHaveTextContent("Status");
  });

  it("orders the flat list by the chosen sort mode", async () => {
    mockChangedFiles([
      { path: "z/alpha.ts", status: "modified" },
      { path: "a/zeta.ts", status: "added" },
    ]);
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId("compare-group-toggle"));

    const namesInOrder = () =>
      screen
        .getAllByText(/^(alpha|zeta)\.ts/)
        .map((element) => element.firstChild?.textContent);

    expect(namesInOrder()).toEqual(["zeta.ts", "alpha.ts"]);
    await user.click(screen.getByTestId("compare-sort-toggle"));
    expect(namesInOrder()).toEqual(["alpha.ts", "zeta.ts"]);
  });

  it("shares reviewed marks with the git page's branch view key", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getAllByRole("button", { name: "" })[0]);

    expect(
      useGitReviewStore.getState().reviewedFiles["ws-1:branch:main"],
    ).toHaveLength(1);
  });
});
