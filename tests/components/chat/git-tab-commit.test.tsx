import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { GitStatusResult } from "@/types";

const stageMutate = vi.fn();
const unstageMutate = vi.fn();
const commitMutate = vi.fn();
const pushMutateAsync = vi.fn();
const pullMutateAsync = vi.fn();

let pushState: { mutateAsync: typeof pushMutateAsync; isPending: boolean } = {
  mutateAsync: pushMutateAsync,
  isPending: false,
};
let pullState: { mutateAsync: typeof pullMutateAsync; isPending: boolean } = {
  mutateAsync: pullMutateAsync,
  isPending: false,
};

vi.mock("@/hooks/use-git", () => ({
  useGitStatus: vi.fn(),
  useGitFileDiffs: vi.fn(),
  useGitStage: () => ({ mutate: stageMutate, isPending: false }),
  useGitUnstage: () => ({ mutate: unstageMutate, isPending: false }),
  useGitCommit: () => ({ mutate: commitMutate, isPending: false }),
  useGitPush: () => pushState,
  useGitPull: () => pullState,
  useGitDiscard: () => ({ mutate: vi.fn(), isPending: false }),
}));

const setGitTabSelection = vi.fn();
vi.mock("@/stores/side-panel-store", () => ({
  useSidePanelStore: (selector: (s: unknown) => unknown) =>
    selector({ setGitTabSelection, gitTabSelection: null }),
}));

vi.mock("@/components/chat/side-panel-diff-view", () => ({
  SidePanelDiffView: () => <div data-testid="side-panel-diff-view" />,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const result = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GitTabPanel workspaceId="ws-1" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...result, invalidateQueries };
}

beforeEach(() => {
  vi.clearAllMocks();
  pushMutateAsync.mockReset();
  pullMutateAsync.mockReset();
  pushMutateAsync.mockResolvedValue(undefined);
  pullMutateAsync.mockResolvedValue(undefined);
  pushState = { mutateAsync: pushMutateAsync, isPending: false };
  pullState = { mutateAsync: pullMutateAsync, isPending: false };
  mockUseGitFileDiffs.mockReturnValue(new Map() as DiffMap);
});

describe("GitTabPanel commit bar", () => {
  it("stages an unstaged (changes) row with files: [path]", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    await user.click(screen.getByTestId("git-stage-action"));

    expect(stageMutate).toHaveBeenCalledWith(
      { action: "stage", files: ["src/changed.ts"] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("unstages a staged row with files: [path]", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
      }),
    });

    renderPanel();

    await user.click(screen.getByTestId("git-unstage-action"));

    expect(unstageMutate).toHaveBeenCalledWith(
      { action: "unstage", files: ["src/staged.ts"] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("renders a stage button on a conflict row", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({ conflicted: ["src/conflict.ts"] }),
    });

    renderPanel();

    expect(screen.getByTestId("git-stage-action")).toBeInTheDocument();
  });

  it("disables Commit with empty message OR empty staged set", async () => {
    const user = userEvent.setup();

    // Staged present but empty message -> disabled
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
      }),
    });
    const { unmount } = renderPanel();
    expect(screen.getByTestId("git-commit-button")).toBeDisabled();
    unmount();

    // Message present but no staged files -> still disabled
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });
    renderPanel();
    await user.type(screen.getByTestId("git-commit-message"), "a message");
    expect(screen.getByTestId("git-commit-button")).toBeDisabled();
  });

  it("stage-all & commit sequences stage-all then commit with a trimmed message", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    await user.type(
      screen.getByTestId("git-commit-message"),
      "  hello world  ",
    );
    await user.click(screen.getByTestId("git-stage-all-commit-button"));

    expect(stageMutate).toHaveBeenCalledWith(
      { action: "stage-all", files: [] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    // Fire the stage-all success path -> chains into commit with trimmed message
    const stageOpts = stageMutate.mock.calls[0][1] as {
      onSuccess: () => void;
    };
    stageOpts.onSuccess();

    expect(commitMutate).toHaveBeenCalledWith(
      { action: "commit", message: "hello world" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("invalidates git-file-diffs + git-file-content on stage, unstage, stage-all, and commit success", async () => {
    const user = userEvent.setup();

    const expectFreshness = (spy: ReturnType<typeof vi.spyOn>) => {
      expect(spy).toHaveBeenCalledWith({
        queryKey: ["git-file-diffs", "ws-1"],
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: ["git-file-content", "ws-1"],
      });
    };

    // stage success
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });
    let harness = renderPanel();
    await user.click(screen.getByTestId("git-stage-action"));
    (stageMutate.mock.calls[0][1] as { onSuccess: () => void }).onSuccess();
    expectFreshness(harness.invalidateQueries);
    harness.unmount();
    vi.clearAllMocks();

    // unstage success
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
      }),
    });
    harness = renderPanel();
    await user.click(screen.getByTestId("git-unstage-action"));
    (unstageMutate.mock.calls[0][1] as { onSuccess: () => void }).onSuccess();
    expectFreshness(harness.invalidateQueries);
    harness.unmount();
    vi.clearAllMocks();

    // stage-all success (within stage-all & commit)
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });
    harness = renderPanel();
    await user.type(screen.getByTestId("git-commit-message"), "msg");
    await user.click(screen.getByTestId("git-stage-all-commit-button"));
    (stageMutate.mock.calls[0][1] as { onSuccess: () => void }).onSuccess();
    expectFreshness(harness.invalidateQueries);
    harness.unmount();
    vi.clearAllMocks();

    // commit success
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
      }),
    });
    harness = renderPanel();
    await user.type(screen.getByTestId("git-commit-message"), "msg");
    await user.click(screen.getByTestId("git-commit-button"));
    act(() => {
      (commitMutate.mock.calls[0][1] as { onSuccess: () => void }).onSuccess();
    });
    expectFreshness(harness.invalidateQueries);
  });

  it("clears the textarea after a successful commit", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
      }),
    });

    renderPanel();

    const textarea = screen.getByTestId(
      "git-commit-message",
    ) as HTMLTextAreaElement;
    await user.type(textarea, "my commit");
    await user.click(screen.getByTestId("git-commit-button"));

    expect(commitMutate).toHaveBeenCalledWith(
      { action: "commit", message: "my commit" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    act(() => {
      (commitMutate.mock.calls[0][1] as { onSuccess: () => void }).onSuccess();
    });

    expect(textarea.value).toBe("");
  });

  it("preserves the commit message when commit does not succeed", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
      }),
    });

    renderPanel();

    const textarea = screen.getByTestId(
      "git-commit-message",
    ) as HTMLTextAreaElement;
    await user.type(textarea, "keep me");
    await user.click(screen.getByTestId("git-commit-button"));

    // onSuccess NOT fired (commit failed) -> message must remain intact
    expect(textarea.value).toBe("keep me");
  });

  it("pushes with { action: 'push' } and stays interactive when push errors", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    const { unmount } = renderPanel();
    await user.click(screen.getByTestId("git-push-button"));
    expect(pushMutateAsync).toHaveBeenCalledWith({ action: "push" });
    unmount();

    // Error path: mutateAsync rejects -> local error surfaced, button still usable
    pushMutateAsync.mockReset();
    pushMutateAsync.mockRejectedValue(new Error("push failed"));
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });
    renderPanel();
    await user.click(screen.getByTestId("git-push-button"));
    expect(await screen.findByTestId("git-push-error")).toHaveTextContent(
      "push failed",
    );
    expect(screen.getByTestId("git-push-button")).not.toBeDisabled();
  });

  it("renders the ahead count when status.ahead > 0", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        ahead: 3,
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();

    expect(screen.getByTestId("git-ahead-count")).toHaveTextContent("3");
  });

  it("does not select the row on stage/unstage clicks and renders no nested native buttons", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
      }),
    });

    const { container } = renderPanel();

    await user.click(screen.getByTestId("git-stage-action"));
    await user.click(screen.getByTestId("git-unstage-action"));

    // Row selection (gitTabSelection) must NOT change from a stage/unstage click
    expect(setGitTabSelection).not.toHaveBeenCalled();
    // Rows use div/span[role=button] — never native buttons nested in buttons
    expect(container.querySelector("button button")).toBeNull();
  });

  it("stage-all on the Changes header stages all changes paths", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [
          { path: "src/a.ts", index: " ", workingDir: "M" },
          { path: "src/b.ts", index: " ", workingDir: "M" },
        ],
      }),
    });

    renderPanel();

    fireEvent.click(screen.getByTestId("git-stage-all-changes-action"));

    expect(stageMutate).toHaveBeenCalledWith(
      { action: "stage", files: ["src/a.ts", "src/b.ts"] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("stage-all on the Untracked header stages all untracked paths", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        untracked: ["src/new1.ts", "src/new2.ts"],
      }),
    });

    renderPanel();

    fireEvent.click(screen.getByTestId("git-stage-all-untracked-action"));

    expect(stageMutate).toHaveBeenCalledWith(
      { action: "stage", files: ["src/new1.ts", "src/new2.ts"] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("unstage-all on the Staged header unstages all staged paths", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [
          { path: "src/x.ts", index: "M", workingDir: " " },
          { path: "src/y.ts", index: "M", workingDir: " " },
        ],
      }),
    });

    renderPanel();

    fireEvent.click(screen.getByTestId("git-unstage-all-action"));

    expect(unstageMutate).toHaveBeenCalledWith(
      { action: "unstage", files: ["src/x.ts", "src/y.ts"] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("invalidates freshness on a bulk stage-all action", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/a.ts", index: " ", workingDir: "M" }],
      }),
    });

    const harness = renderPanel();
    fireEvent.click(screen.getByTestId("git-stage-all-changes-action"));
    (stageMutate.mock.calls[0][1] as { onSuccess: () => void }).onSuccess();

    expect(harness.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["git-file-diffs", "ws-1"],
    });
    expect(harness.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["git-file-content", "ws-1"],
    });
  });

  it("renders no bulk action on a conflicts-only fixture", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({ conflicted: ["src/conflict.ts"] }),
    });

    renderPanel();

    expect(screen.queryByTestId("git-stage-all-changes-action")).toBeNull();
    expect(screen.queryByTestId("git-stage-all-untracked-action")).toBeNull();
    expect(screen.queryByTestId("git-unstage-all-action")).toBeNull();
  });
});
