import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

const setGitTabSelection = vi.fn();
const setActivePanelTab = vi.fn();
const openFile = vi.fn();
const setIsLoading = vi.fn();
const clearError = vi.fn();

interface MockStore {
  gitTabSelection: {
    workspaceId: string;
    path: string;
    staged: boolean;
  } | null;
  setGitTabSelection: typeof setGitTabSelection;
  setActivePanelTab: typeof setActivePanelTab;
  openFile: typeof openFile;
  setIsLoading: typeof setIsLoading;
  clearError: typeof clearError;
  activePanelTab: string;
}

let storeState: MockStore;

function resetStore() {
  storeState = {
    gitTabSelection: null,
    setGitTabSelection,
    setActivePanelTab,
    openFile,
    setIsLoading,
    clearError,
    activePanelTab: "git",
  };
}
resetStore();

vi.mock("@/stores/side-panel-store", () => {
  const useSidePanelStore = Object.assign(
    (selector: (s: MockStore) => unknown) => selector(storeState),
    { getState: () => storeState },
  );
  return { useSidePanelStore };
});

vi.mock("@/components/chat/side-panel-diff-view", () => ({
  SidePanelDiffView: (props: {
    workspaceId: string;
    filePath: string;
    staged?: boolean;
  }) => (
    <div
      data-testid="side-panel-diff-view"
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
import { toast } from "sonner";

const mockUseGitStatus = useGitStatus as unknown as ReturnType<typeof vi.fn>;
const mockUseGitFileDiffs = useGitFileDiffs as unknown as ReturnType<
  typeof vi.fn
>;
const mockToastError = toast.error as unknown as ReturnType<typeof vi.fn>;

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

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GitTabPanel workspaceId="ws-1" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  sidebarTabsOpenMode = "sidebar";
  mockUseGitFileDiffs.mockReturnValue(new Map() as DiffMap);
  mockUseGitStatus.mockReturnValue({ data: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("sets gitTabSelection with staged=true when clicking a staged row", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
      }),
    });

    renderPanel();

    await user.click(screen.getByText("src/staged.ts"));

    expect(setGitTabSelection).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      path: "src/staged.ts",
      staged: true,
    });
  });

  it("sets gitTabSelection with staged=false when clicking a changes row", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    await user.click(screen.getByText("src/changed.ts"));

    expect(setGitTabSelection).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      path: "src/changed.ts",
      staged: false,
    });
  });

  it("opens the diff in a dialog instead of inline when dialog mode is set", async () => {
    const user = userEvent.setup();
    sidebarTabsOpenMode = "dialog";
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
      }),
    });

    renderPanel();

    await user.click(screen.getByText("src/staged.ts"));

    expect(setGitTabSelection).not.toHaveBeenCalled();
    const dialog = await screen.findByTestId("git-diff-dialog");
    const diffView = screen.getByTestId("side-panel-diff-view");
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

  // ---- Inline diff screen (TODO 11) ----

  it("renders the diff screen with SidePanelDiffView receiving the selection path + staged", () => {
    storeState.gitTabSelection = {
      workspaceId: "ws-1",
      path: "src/foo.ts",
      staged: false,
    };
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/foo.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    expect(screen.getByTestId("git-tab-diff-screen")).toBeInTheDocument();
    const diff = screen.getByTestId("side-panel-diff-view");
    expect(diff).toHaveAttribute("data-file-path", "src/foo.ts");
    expect(diff).toHaveAttribute("data-staged", "false");
  });

  it("closes the diff when the close button is clicked", async () => {
    const user = userEvent.setup();
    storeState.gitTabSelection = {
      workspaceId: "ws-1",
      path: "src/foo.ts",
      staged: false,
    };
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/foo.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    await user.click(screen.getByTestId("git-diff-close"));

    expect(setGitTabSelection).toHaveBeenCalledWith(null);
  });

  it("open-in-Files-tab success runs the store openFile path and clears the selection", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: "hello", language: "typescript" }),
      }),
    );
    storeState.gitTabSelection = {
      workspaceId: "ws-1",
      path: "src/foo.ts",
      staged: false,
    };
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/foo.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    await user.click(screen.getByTestId("git-diff-open-in-files"));

    await waitFor(() => {
      expect(openFile).toHaveBeenCalledWith(
        "src/foo.ts",
        "hello",
        "typescript",
      );
    });
    expect(setActivePanelTab).toHaveBeenCalledWith("files");
    expect(setGitTabSelection).toHaveBeenCalledWith(null);
  });

  it("open-in-Files-tab failure keeps the selection and shows the diff screen", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    storeState.gitTabSelection = {
      workspaceId: "ws-1",
      path: "src/foo.ts",
      staged: false,
    };
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/foo.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    await user.click(screen.getByTestId("git-diff-open-in-files"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Could not open file");
    });
    // Fallback fired → selection must NOT be cleared, diff screen stays
    expect(setGitTabSelection).not.toHaveBeenCalledWith(null);
    expect(screen.getByTestId("git-tab-diff-screen")).toBeInTheDocument();
  });

  it("ignores and clears a stale cross-workspace selection, showing the list", () => {
    storeState.gitTabSelection = {
      workspaceId: "other-ws",
      path: "src/foo.ts",
      staged: false,
    };
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    // List view shown (not the diff screen), stale selection cleared via effect
    expect(screen.queryByTestId("git-tab-diff-screen")).not.toBeInTheDocument();
    expect(screen.getByText("Changes")).toBeInTheDocument();
    expect(setGitTabSelection).toHaveBeenCalledWith(null);
  });

  it("auto-returns to the list when the selected path leaves every bucket", () => {
    storeState.gitTabSelection = {
      workspaceId: "ws-1",
      path: "src/gone.ts",
      staged: false,
    };
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/other.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    expect(setGitTabSelection).toHaveBeenCalledWith(null);
  });

  it("passes staged: true to SidePanelDiffView for a staged selection", () => {
    storeState.gitTabSelection = {
      workspaceId: "ws-1",
      path: "src/foo.ts",
      staged: true,
    };
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/foo.ts", index: "M", workingDir: " " }],
      }),
    });

    renderPanel();

    expect(screen.getByTestId("side-panel-diff-view")).toHaveAttribute(
      "data-staged",
      "true",
    );
  });

  it("Escape on the diff screen returns to the list without invoking the panel onEscape", () => {
    const onEscape = vi.fn();
    storeState.gitTabSelection = {
      workspaceId: "ws-1",
      path: "src/foo.ts",
      staged: false,
    };
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/foo.ts", index: " ", workingDir: "M" }],
      }),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div
            onKeyDown={(e) => {
              if (e.key === "Escape") onEscape();
            }}
          >
            <GitTabPanel workspaceId="ws-1" />
          </div>
        </TooltipProvider>
      </QueryClientProvider>,
    );

    fireEvent.keyDown(screen.getByTestId("git-tab-diff-screen"), {
      key: "Escape",
    });

    expect(setGitTabSelection).toHaveBeenCalledWith(null);
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("highlights the row matching the current selection with bg-accent", () => {
    storeState.gitTabSelection = {
      workspaceId: "ws-1",
      path: "src/changed.ts",
      staged: false,
    };
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    // The path appears both in the row and the diff header; find the row
    // (the only match with a role=button ancestor).
    const row = screen
      .getAllByText("src/changed.ts")
      .map((el) => el.closest('[role="button"]'))
      .find((el): el is HTMLElement => el !== null);
    expect(row).toBeDefined();
    expect(row?.className).toContain("bg-accent");
  });

  it("shows the resize handle only when a selection is active", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    const { unmount } = renderPanel();
    expect(
      screen.queryByTestId("git-list-resize-handle"),
    ).not.toBeInTheDocument();
    unmount();

    storeState.gitTabSelection = {
      workspaceId: "ws-1",
      path: "src/changed.ts",
      staged: false,
    };
    renderPanel();
    expect(screen.getByTestId("git-list-resize-handle")).toBeInTheDocument();
  });
});
