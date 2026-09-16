import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { GitStatusResult } from "@/types";

const stageMutate = vi.fn();
const unstageMutate = vi.fn();
const commitMutate = vi.fn();
const discardMutate = vi.fn();

let stagePending = false;
let unstagePending = false;
let discardPending = false;

vi.mock("@/hooks/use-git", () => ({
  useGitStatus: vi.fn(),
  useGitFileDiffs: vi.fn(),
  useGitStage: () => ({ mutate: stageMutate, isPending: stagePending }),
  useGitUnstage: () => ({ mutate: unstageMutate, isPending: unstagePending }),
  useGitCommit: () => ({ mutate: commitMutate, isPending: false }),
  useGitDiscard: () => ({ mutate: discardMutate, isPending: discardPending }),
}));

const setGitTabSelection = vi.fn();
vi.mock("@/stores/side-panel-store", () => ({
  useSidePanelStore: (selector: (s: unknown) => unknown) =>
    selector({ setGitTabSelection, gitTabSelection: null }),
}));

vi.mock("@/components/chat/side-panel-diff-view", () => ({
  SidePanelDiffView: () => <div data-testid="side-panel-diff-view" />,
}));

vi.mock("@/components/chat/git-sync-controls", () => ({
  GitSyncControls: () => <div data-testid="git-sync-controls" />,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Mock the dialog to capture its props so the panel-wiring tests can invoke
// onConfirm with crafted targets (poll-race + fail-closed proofs). The real
// dialog copy is verified separately below against the actual component.
interface CapturedTarget {
  workspaceId: string;
  path: string;
  isUntracked: boolean;
}
const dialogState = vi.hoisted(() => ({
  props: null as {
    target: CapturedTarget | null;
    onOpenChange: (open: boolean) => void;
    onConfirm: (target: CapturedTarget) => void;
  } | null,
}));
vi.mock("@/components/chat/git-revert-dialog", () => ({
  GitRevertDialog: (props: {
    target: CapturedTarget | null;
    onOpenChange: (open: boolean) => void;
    onConfirm: (target: CapturedTarget) => void;
  }) => {
    dialogState.props = props;
    return props.target ? <div data-testid="revert-dialog-open" /> : null;
  },
}));

import { GitTabPanel } from "@/components/chat/git-tab-panel";
import { useGitStatus, useGitFileDiffs } from "@/hooks/use-git";

const mockUseGitStatus = useGitStatus as unknown as ReturnType<typeof vi.fn>;
const mockUseGitFileDiffs = useGitFileDiffs as unknown as ReturnType<
  typeof vi.fn
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

function renderPanel(workspaceId = "ws-1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const result = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <GitTabPanel workspaceId={workspaceId} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...result, invalidateQueries, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  stagePending = false;
  unstagePending = false;
  discardPending = false;
  dialogState.props = null;
  mockUseGitFileDiffs.mockReturnValue(new Map());
});

describe("GitRevertDialog", () => {
  let RealGitRevertDialog: (typeof import("@/components/chat/git-revert-dialog"))["GitRevertDialog"];
  beforeAll(async () => {
    ({ GitRevertDialog: RealGitRevertDialog } = await vi.importActual<
      typeof import("@/components/chat/git-revert-dialog")
    >("@/components/chat/git-revert-dialog"));
  });

  it("shows Discard copy for tracked and Delete copy for untracked", () => {
    const { rerender } = render(
      <RealGitRevertDialog
        target={{ workspaceId: "ws-1", path: "src/foo.ts", isUntracked: false }}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByText("Discard changes to foo.ts?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This reverts the file to its last staged or committed state.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("git-revert-cancel")).toBeInTheDocument();
    expect(screen.getByTestId("git-revert-confirm")).toBeInTheDocument();

    rerender(
      <RealGitRevertDialog
        target={{ workspaceId: "ws-1", path: "src/new.ts", isUntracked: true }}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByText("Delete new.ts?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This file is untracked - deleting it cannot be undone.",
      ),
    ).toBeInTheDocument();
  });

  it("calls onConfirm with the target when confirm is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const target = {
      workspaceId: "ws-1",
      path: "src/foo.ts",
      isUntracked: false,
    };
    render(
      <RealGitRevertDialog
        target={target}
        onOpenChange={() => {}}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByTestId("git-revert-confirm"));

    expect(onConfirm).toHaveBeenCalledWith(target);
  });
});

describe("GitTabPanel revert action", () => {
  it("renders revert on changes + untracked rows, absent on staged + conflicts", () => {
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/staged.ts", index: "M", workingDir: " " }],
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
        untracked: ["src/new.ts"],
        conflicted: ["src/conflict.ts"],
      }),
    });

    renderPanel();

    // 1 changes row + 1 untracked row = 2 revert actions; staged/conflict have none
    expect(screen.getAllByTestId("git-revert-action")).toHaveLength(2);
  });

  it("confirm dispatches discard with files:[path] and expectedUntracked:[] for tracked", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();
    await user.click(screen.getByTestId("git-revert-action"));

    act(() => {
      dialogState.props!.onConfirm(dialogState.props!.target!);
    });

    expect(discardMutate).toHaveBeenCalledWith(
      { action: "discard", files: ["src/changed.ts"], expectedUntracked: [] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("confirm dispatches expectedUntracked:[path] for untracked rows", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({ untracked: ["src/new.ts"] }),
    });

    renderPanel();
    await user.click(screen.getByTestId("git-revert-action"));

    act(() => {
      dialogState.props!.onConfirm(dialogState.props!.target!);
    });

    expect(discardMutate).toHaveBeenCalledWith(
      {
        action: "discard",
        files: ["src/new.ts"],
        expectedUntracked: ["src/new.ts"],
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("cancel (onOpenChange false) dispatches no mutation", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();
    await user.click(screen.getByTestId("git-revert-action"));

    act(() => {
      dialogState.props!.onOpenChange(false);
    });

    expect(discardMutate).not.toHaveBeenCalled();
    expect(dialogState.props!.target).toBeNull();
  });

  it("revert click does not change selection and renders no nested native buttons", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    const { container } = renderPanel();
    await user.click(screen.getByTestId("git-revert-action"));

    expect(setGitTabSelection).not.toHaveBeenCalled();
    expect(container.querySelector("button button")).toBeNull();
  });

  it("fires invalidateFreshness on discard success", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    const harness = renderPanel();
    await user.click(screen.getByTestId("git-revert-action"));
    act(() => {
      dialogState.props!.onConfirm(dialogState.props!.target!);
    });
    act(() => {
      (discardMutate.mock.calls[0][1] as { onSuccess: () => void }).onSuccess();
    });

    expect(harness.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["git-file-diffs", "ws-1"],
    });
    expect(harness.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["git-file-content", "ws-1"],
    });
  });

  it("uses the originally captured target when status changes underneath (poll-race)", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/a.ts", index: " ", workingDir: "M" }],
      }),
    });

    const { rerender, queryClient } = renderPanel();
    await user.click(screen.getByTestId("git-revert-action"));
    const captured = dialogState.props!.target!;

    // Status poll reclassifies: a.ts is now staged, an unrelated untracked appears
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        staged: [{ path: "src/a.ts", index: "M", workingDir: " " }],
        untracked: ["src/b.ts"],
      }),
    });
    act(() => {
      rerender(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <GitTabPanel workspaceId="ws-1" />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });

    act(() => {
      dialogState.props!.onConfirm(captured);
    });

    expect(discardMutate).toHaveBeenCalledWith(
      { action: "discard", files: ["src/a.ts"], expectedUntracked: [] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("disables revert actions and dispatches nothing while a mutation is pending", async () => {
    const user = userEvent.setup();
    discardPending = true;
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    renderPanel();
    const action = screen.getByTestId("git-revert-action");
    expect(action).toHaveAttribute("aria-disabled", "true");

    await user.click(action);

    expect(dialogState.props!.target).toBeNull();
    expect(discardMutate).not.toHaveBeenCalled();
  });

  it("clears the dialog when the workspace changes, and fails closed on a mismatched target", async () => {
    const user = userEvent.setup();
    mockUseGitStatus.mockReturnValue({
      data: makeStatus({
        unstaged: [{ path: "src/changed.ts", index: " ", workingDir: "M" }],
      }),
    });

    const { rerender, queryClient } = renderPanel("ws-1");
    await user.click(screen.getByTestId("git-revert-action"));
    expect(dialogState.props!.target).not.toBeNull();

    // Workspace switch clears the pending target
    act(() => {
      rerender(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <GitTabPanel workspaceId="ws-2" />
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    expect(dialogState.props!.target).toBeNull();

    // Fail-closed: confirm a target whose workspaceId differs from the current prop
    act(() => {
      dialogState.props!.onConfirm({
        workspaceId: "ws-1",
        path: "src/changed.ts",
        isUntracked: false,
      });
    });

    expect(discardMutate).not.toHaveBeenCalled();
    expect(dialogState.props!.target).toBeNull();
  });
});
