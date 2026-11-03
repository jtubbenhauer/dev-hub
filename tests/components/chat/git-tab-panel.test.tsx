import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { GitStatusResult } from "@/types";

vi.mock("@/hooks/use-git", () => ({
  useGitStatus: vi.fn(),
  useGitFileDiffs: vi.fn(),
  useGitStage: () => ({ mutate: vi.fn(), isPending: false }),
  useGitUnstage: () => ({ mutate: vi.fn(), isPending: false }),
  useGitCommit: () => ({ mutate: vi.fn(), isPending: false }),
  useGitPush: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useGitPull: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useGitDiscard: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/components/workbench/workbench-diff-view", () => ({
  WorkbenchDiffView: (props: {
    workspaceId: string;
    filePath: string;
    staged?: boolean;
  }) => (
    <div
      data-testid="workbench-diff-view"
      data-file-path={props.filePath}
      data-staged={String(props.staged)}
    />
  ),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

let sidebarTabsOpenMode: "sidebar" | "dialog" = "sidebar";
vi.mock("@/hooks/use-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-settings")>()),
  useChatSidebarTabsOpenSetting: () => ({
    sidebarTabsOpenMode,
    isLoading: false,
  }),
}));

const openChatFileDialog = vi.fn();
vi.mock("@/stores/chat-file-dialog-store", () => ({
  useChatFileDialogStore: {
    getState: () => ({ openFile: openChatFileDialog }),
  },
}));

import { GitTabPanel } from "@/components/chat/git-tab-panel";
import { useGitStatus, useGitFileDiffs } from "@/hooks/use-git";

const mockUseGitStatus = useGitStatus as unknown as ReturnType<typeof vi.fn>;
const mockUseGitFileDiffs = useGitFileDiffs as unknown as ReturnType<
  typeof vi.fn
>;

type DiffMap = Map<
  string,
  { additions: number; deletions: number; staged: boolean }
>;

function makeStatus(overrides: Partial<GitStatusResult>): GitStatusResult {
  return {
    isRepo: true,
    branch: "main",
    tracking: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    lastCommit: null,
    ...overrides,
  };
}

interface GitTabFileSelection {
  path: string;
  staged: boolean;
}

function renderPanel(
  onSelectFile: (selection: GitTabFileSelection) => void = vi.fn(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GitTabPanel workspaceId="ws-1" onSelectFile={onSelectFile} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sidebarTabsOpenMode = "sidebar";
  mockUseGitFileDiffs.mockReturnValue(new Map() as DiffMap);
  mockUseGitStatus.mockReturnValue({ data: undefined });
});

describe("GitTabPanel", () => {
  it("renders all four sections with correct status chars and does not throw on string buckets", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
        untracked: ["src/new.ts"],
        conflicted: ["src/conflict.ts"],
      }),
    });

    renderPanel();

    expect(screen.getByText("Staged")).toBeInTheDocument();
    expect(screen.getByText("Changes")).toBeInTheDocument();
    expect(screen.getByText("Untracked")).toBeInTheDocument();
    expect(screen.getByText("Conflicts")).toBeInTheDocument();

    expect(screen.getByText("src/staged.ts")).toBeInTheDocument();
    expect(screen.getByText("src/changed.ts")).toBeInTheDocument();
    expect(screen.getByText("src/new.ts")).toBeInTheDocument();
    expect(screen.getByText("src/conflict.ts")).toBeInTheDocument();

    // Untracked → "?" char, Conflicts → "!" char
    expect(screen.getByText("?")).toBeInTheDocument();
    expect(screen.getByText("!")).toBeInTheDocument();
    // Both staged + changes rows show "M"
    expect(screen.getAllByText("M")).toHaveLength(2);
  });

  it("renders a staged+conflicted path only under Conflicts, once", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/both.ts", index: "M", workingDir: " " }],
        unstaged: [{ path: "src/both.ts", index: "M", workingDir: "M" }],
        conflicted: ["src/both.ts"],
      }),
    });

    renderPanel();

    // Only rendered once (the conflict row), not in staged/changes
    expect(screen.getAllByText("src/both.ts")).toHaveLength(1);
    expect(screen.getByText("Conflicts")).toBeInTheDocument();
    expect(screen.queryByText("Staged")).not.toBeInTheDocument();
    expect(screen.queryByText("Changes")).not.toBeInTheDocument();
    // Conflict char present, no leftover "M"
    expect(screen.getByText("!")).toBeInTheDocument();
    expect(screen.queryByText("M")).not.toBeInTheDocument();
  });

  it.each([
    {
      section: "staged",
      path: "src/staged.ts",
      expected: { path: "src/staged.ts", staged: true },
    },
    {
      section: "changes",
      path: "src/changed.ts",
      expected: { path: "src/changed.ts", staged: false },
    },
    {
      section: "untracked",
      path: "src/new.ts",
      expected: { path: "src/new.ts", staged: false },
    },
    {
      section: "conflicts",
      path: "src/conflict.ts",
      expected: { path: "src/conflict.ts", staged: false },
    },
  ])(
    "hands a clicked $section row to onSelectFile",
    async ({ path, expected }) => {
      // Given
      const onSelectFile = vi.fn<(selection: GitTabFileSelection) => void>();
      mockUseGitStatus.mockReturnValue({
        data: makeStatus({
          staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
          unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
          untracked: ["src/new.ts"],
          conflicted: ["src/conflict.ts"],
        }),
      });
      renderPanel(onSelectFile);

      // When
      await userEvent.setup().click(screen.getByText(path));

      // Then
      expect(onSelectFile).toHaveBeenCalledExactlyOnceWith(expected);
    },
  );

  it("opens the diff in a dialog instead of a tab when dialog mode is set", async () => {
    // Given
    sidebarTabsOpenMode = "dialog";
    const onSelectFile = vi.fn<(selection: GitTabFileSelection) => void>();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
      }),
    });
    renderPanel(onSelectFile);

    // When
    await userEvent.setup().click(screen.getByText("src/staged.ts"));

    // Then
    expect(onSelectFile).not.toHaveBeenCalled();
    const dialog = await screen.findByTestId("git-diff-dialog");
    const diffView = screen.getByTestId("workbench-diff-view");
    expect(dialog).toContainElement(diffView);
    expect(diffView).toHaveAttribute("data-file-path", "src/staged.ts");
    expect(diffView).toHaveAttribute("data-staged", "true");
  });

  it("opens the file in the chat file dialog from the diff dialog", async () => {
    const user = userEvent.setup();
    sidebarTabsOpenMode = "dialog";
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    await user.click(screen.getByText("src/changed.ts"));
    await user.click(await screen.findByTestId("git-diff-dialog-open-file"));

    expect(openChatFileDialog).toHaveBeenCalledWith(
      "ws-1",
      "src/changed.ts",
      expect.any(Function),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("git-diff-dialog")).not.toBeInTheDocument(),
    );
  });

  it("renders not-a-repo state when isRepo is false", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({ isRepo: false, branch: "" }),
    });

    renderPanel();

    expect(screen.getByText("Not a git repository")).toBeInTheDocument();
  });

  it("renders +/- counts from the file-diffs map", () => {
    const diffs: DiffMap = new Map();
    diffs.set("staged:src/staged.ts", {
      additions: 5,
      deletions: 2,
      staged: true,
    });
    diffs.set("unstaged:src/changed.ts", {
      additions: 3,
      deletions: 0,
      staged: false,
    });
    mockUseGitFileDiffs.mockReturnValue(diffs);
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    expect(screen.getByText("+5")).toBeInTheDocument();
    expect(screen.getByText("-2")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
  });

  it("renders a loading placeholder without throwing when status is undefined", () => {
    mockUseGitStatus.mockReturnValue({ data: undefined });

    expect(() => renderPanel()).not.toThrow();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders empty 'No changes' state with branch name when clean", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({ branch: "feature/x" }),
    });

    renderPanel();

    expect(screen.getByText("No changes")).toBeInTheDocument();
    expect(screen.getByText("feature/x")).toBeInTheDocument();
  });
});
