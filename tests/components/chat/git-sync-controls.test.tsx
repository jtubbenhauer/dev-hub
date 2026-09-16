import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TooltipProvider } from "@/components/ui/tooltip";

type MutationState = {
  mutateAsync: ReturnType<typeof vi.fn>;
  isPending: boolean;
};

let pullState: MutationState;
let pushState: MutationState;

vi.mock("@/hooks/use-git", () => ({
  useGitPull: () => pullState,
  useGitPush: () => pushState,
}));

import { GitSyncControls } from "@/components/chat/git-sync-controls";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type ControlProps = {
  hasDirtyTree: boolean;
  tracking: string | null;
  ahead: number;
  behind: number;
  onSuccess: () => void;
};

function renderControls(overrides: Partial<ControlProps> = {}) {
  const props: ControlProps = {
    hasDirtyTree: false,
    tracking: "origin/main",
    ahead: 0,
    behind: 0,
    onSuccess: vi.fn(),
    ...overrides,
  };
  const result = render(
    <TooltipProvider>
      <GitSyncControls workspaceId="ws-1" {...props} />
    </TooltipProvider>,
  );
  return { ...result, onSuccess: props.onSuccess };
}

beforeEach(() => {
  pullState = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  };
  pushState = {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  };
});

describe("GitSyncControls", () => {
  // (1)
  it("dispatches { action: 'pull' } on Pull click", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByTestId("git-pull-button"));

    expect(pullState.mutateAsync).toHaveBeenCalledWith({ action: "pull" });
    expect(pullState.mutateAsync).toHaveBeenCalledTimes(1);
  });

  // (2)
  it("disables Pull when tracking is null", () => {
    renderControls({ tracking: null });
    expect(screen.getByTestId("git-pull-button")).toBeDisabled();
  });

  // (3)
  it("disables Sync when dirty or untracked, enables when clean and tracked", () => {
    const dirty = renderControls({ hasDirtyTree: true });
    expect(screen.getByTestId("git-sync-button")).toBeDisabled();
    dirty.unmount();

    const untracked = renderControls({ tracking: null });
    expect(screen.getByTestId("git-sync-button")).toBeDisabled();
    untracked.unmount();

    renderControls({ hasDirtyTree: false, tracking: "origin/main" });
    expect(screen.getByTestId("git-sync-button")).not.toBeDisabled();
  });

  // (4)
  it("Sync calls pull THEN push in order", async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByTestId("git-sync-button"));

    expect(pullState.mutateAsync).toHaveBeenCalledWith({ action: "pull" });
    expect(pushState.mutateAsync).toHaveBeenCalledWith({ action: "push" });
    const pullOrder = pullState.mutateAsync.mock.invocationCallOrder[0];
    const pushOrder = pushState.mutateAsync.mock.invocationCallOrder[0];
    expect(pullOrder).toBeLessThan(pushOrder);
  });

  // (4)
  it("Sync skips push when pull rejects", async () => {
    const user = userEvent.setup();
    pullState.mutateAsync = vi.fn().mockRejectedValue(new Error("no net"));
    renderControls();

    await user.click(screen.getByTestId("git-sync-button"));

    expect(pushState.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("git-pull-error")).toHaveTextContent(
      "Pull failed",
    );
  });

  // (5)
  it("renders git-pull-error with a 'Pull failed' prefix and stays interactive", async () => {
    const user = userEvent.setup();
    pullState.mutateAsync = vi.fn().mockRejectedValue(new Error("boom"));
    renderControls();

    await user.click(screen.getByTestId("git-pull-button"));

    const err = await screen.findByTestId("git-pull-error");
    expect(err.textContent).toMatch(/^Pull failed/);
    expect(screen.getByTestId("git-pull-button")).not.toBeDisabled();

    // interactive: a subsequent click dispatches again
    await user.click(screen.getByTestId("git-pull-button"));
    expect(pullState.mutateAsync).toHaveBeenCalledTimes(2);
  });

  // (6)
  it("calls onSuccess after pull success and after push success", async () => {
    const user = userEvent.setup();
    const pullRun = renderControls();
    await user.click(screen.getByTestId("git-pull-button"));
    expect(pullRun.onSuccess).toHaveBeenCalledTimes(1);
    pullRun.unmount();

    const pushRun = renderControls();
    await user.click(screen.getByTestId("git-push-button"));
    expect(pushRun.onSuccess).toHaveBeenCalledTimes(1);
  });

  // (7)
  it("renders the behind badge only when behind > 0", () => {
    const zero = renderControls({ behind: 0 });
    expect(screen.queryByTestId("git-behind-count")).toBeNull();
    zero.unmount();

    renderControls({ behind: 2 });
    expect(screen.getByTestId("git-behind-count")).toHaveTextContent("2");
  });

  // (8)
  it("push regression: dispatches { action: 'push' }, renders ahead count and push error", async () => {
    const user = userEvent.setup();
    const withAhead = renderControls({ ahead: 3 });
    expect(screen.getByTestId("git-ahead-count")).toHaveTextContent("3");

    await user.click(screen.getByTestId("git-push-button"));
    expect(pushState.mutateAsync).toHaveBeenCalledWith({ action: "push" });
    withAhead.unmount();

    pushState.mutateAsync = vi.fn().mockRejectedValue(new Error("push failed"));
    renderControls();
    await user.click(screen.getByTestId("git-push-button"));

    const err = await screen.findByTestId("git-push-error");
    expect(err).toHaveTextContent("push failed");
    expect(screen.getByTestId("git-push-button")).not.toBeDisabled();
  });

  // (9) Pull
  it("Pull latch: two same-tick clicks dispatch once; releases after settle", async () => {
    const d = deferred<undefined>();
    pullState.mutateAsync = vi.fn().mockReturnValue(d.promise);
    renderControls();

    const btn = screen.getByTestId("git-pull-button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(pullState.mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve(undefined);
      await d.promise;
    });

    fireEvent.click(btn);
    expect(pullState.mutateAsync).toHaveBeenCalledTimes(2);
  });

  // (9) Push
  it("Push latch: two same-tick clicks dispatch once; releases after settle", async () => {
    const d = deferred<undefined>();
    pushState.mutateAsync = vi.fn().mockReturnValue(d.promise);
    renderControls();

    const btn = screen.getByTestId("git-push-button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(pushState.mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve(undefined);
      await d.promise;
    });

    fireEvent.click(btn);
    expect(pushState.mutateAsync).toHaveBeenCalledTimes(2);
  });

  // (9) Sync
  it("Sync latch: two same-tick clicks dispatch pull once; releases after settle", async () => {
    const d = deferred<undefined>();
    pullState.mutateAsync = vi.fn().mockReturnValue(d.promise);
    renderControls();

    const btn = screen.getByTestId("git-sync-button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(pullState.mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve(undefined);
      await d.promise;
    });

    fireEvent.click(btn);
    expect(pullState.mutateAsync).toHaveBeenCalledTimes(2);
  });

  // (10)
  it("disables Pull, Push and Sync while pull is pending", () => {
    pullState = { mutateAsync: vi.fn(), isPending: true };
    renderControls();
    expect(screen.getByTestId("git-pull-button")).toBeDisabled();
    expect(screen.getByTestId("git-push-button")).toBeDisabled();
    expect(screen.getByTestId("git-sync-button")).toBeDisabled();
  });

  // (11)
  it("keeps git-tab-panel.tsx at or under 689 lines", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/chat/git-tab-panel.tsx"),
      "utf8",
    );
    const lineCount = source.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(689);
  });
});
