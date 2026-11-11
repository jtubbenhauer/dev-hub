import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspacePrActions } from "@/components/git/workspace-pr/workspace-pr-actions";
import type {
  BranchPullRequest,
  RepositoryMergeSettings,
} from "@/lib/github/branch-pull-request";
import type { PullRequestAction } from "@/lib/github/pull-request-actions";
import { makePullRequest, makeRepository } from "./workspace-pr-fixtures";

interface MutateOptions {
  onSuccess?: () => void;
}

const actionMutation = vi.hoisted(() => ({
  mutate: vi.fn<(action: PullRequestAction, options?: MutateOptions) => void>(),
  isPending: false,
  variables: undefined as PullRequestAction | undefined,
}));

vi.mock("@/hooks/use-branch-pull-request", () => ({
  usePullRequestAction: () => actionMutation,
}));

function renderActions(
  pullRequest: BranchPullRequest,
  repository: RepositoryMergeSettings = makeRepository(),
) {
  return render(
    <WorkspacePrActions
      owner="acme"
      repo="widgets"
      branch="feat-x"
      pullRequest={pullRequest}
      repository={repository}
    />,
  );
}

function lastMutateCall() {
  const call = actionMutation.mutate.mock.lastCall;
  if (!call) throw new Error("mutate was never called");
  return call;
}

describe("WorkspacePrActions", () => {
  beforeEach(() => {
    actionMutation.mutate.mockReset();
    actionMutation.isPending = false;
    actionMutation.variables = undefined;
  });

  it("disables Merge and explains why when the PR is blocked", () => {
    renderActions(
      makePullRequest({
        mergeStateStatus: "BLOCKED",
        reviewDecision: "REVIEW_REQUIRED",
      }),
    );

    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
    expect(
      screen.getByText("An approving review is required"),
    ).toBeInTheDocument();
  });

  it("merges with the picked method after confirmation, offering only allowed methods", async () => {
    const user = userEvent.setup();
    renderActions(
      makePullRequest(),
      makeRepository({
        allowedMergeMethods: ["SQUASH", "REBASE"],
        defaultMergeMethod: "REBASE",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Merge" }));
    expect(actionMutation.mutate).not.toHaveBeenCalled();

    const methodGroup = screen.getByRole("group", { name: "Merge method" });
    const methodNames = within(methodGroup)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(methodNames).toEqual(["Squash and merge", "Rebase and merge"]);
    expect(
      within(methodGroup).getByRole("button", { name: "Rebase and merge" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(
      within(methodGroup).getByRole("button", { name: "Squash and merge" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm merge" }));

    const [action, options] = lastMutateCall();
    expect(action).toEqual({ type: "merge", mergeMethod: "SQUASH" });

    options?.onSuccess?.();
    expect(
      await screen.findByRole("button", { name: "Merge" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Confirm merge" }),
    ).not.toBeInTheDocument();
  });

  it("enables auto-merge with the chosen method", async () => {
    const user = userEvent.setup();
    renderActions(
      makePullRequest({
        mergeStateStatus: "BLOCKED",
        viewerCanEnableAutoMerge: true,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Enable auto-merge" }));
    await user.click(screen.getByRole("button", { name: "Rebase and merge" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm auto-merge" }),
    );

    expect(lastMutateCall()[0]).toEqual({
      type: "enable-auto-merge",
      mergeMethod: "REBASE",
    });
  });

  it("disables auto-merge directly when it is enabled", async () => {
    const user = userEvent.setup();
    renderActions(
      makePullRequest({
        autoMerge: {
          enabledAt: "2026-11-10T10:00:00Z",
          mergeMethod: "SQUASH",
          enabledByLogin: "octocat",
        },
        viewerCanDisableAutoMerge: true,
        viewerCanEnableAutoMerge: true,
      }),
    );

    expect(
      screen.queryByRole("button", { name: "Enable auto-merge" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Disable auto-merge" }),
    );

    expect(lastMutateCall()[0]).toEqual({ type: "disable-auto-merge" });
  });

  it("closes only after the inline confirmation", async () => {
    const user = userEvent.setup();
    renderActions(makePullRequest({ viewerCanClose: true }));

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(actionMutation.mutate).not.toHaveBeenCalled();
    expect(
      screen.getByText("Close pull request #12 without merging?"),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Close pull request" }),
    );

    expect(lastMutateCall()[0]).toEqual({ type: "close" });
  });

  it("reopens a closed pull request", async () => {
    const user = userEvent.setup();
    renderActions(makePullRequest({ state: "CLOSED", viewerCanReopen: true }));

    expect(
      screen.queryByRole("button", { name: "Merge" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reopen" }));

    expect(lastMutateCall()[0]).toEqual({ type: "reopen" });
  });

  it.each([
    { isDraft: true, label: "Ready for review", type: "mark-ready-for-review" },
    { isDraft: false, label: "Convert to draft", type: "convert-to-draft" },
  ] as const)(
    "toggles draft state with $label",
    async ({ isDraft, label, type }) => {
      const user = userEvent.setup();
      renderActions(makePullRequest({ isDraft, viewerCanUpdate: true }));

      await user.click(screen.getByRole("button", { name: label }));

      expect(lastMutateCall()[0]).toEqual({ type });
    },
  );

  it("updates the branch directly", async () => {
    const user = userEvent.setup();
    renderActions(makePullRequest({ viewerCanUpdateBranch: true }));

    const updateButton = screen.getByRole("button", { name: "Update branch" });
    expect(updateButton).toHaveAttribute(
      "title",
      "Merge the latest base branch into this branch",
    );
    await user.click(updateButton);

    expect(lastMutateCall()[0]).toEqual({ type: "update-branch" });
  });

  it("disables every action while one is pending", () => {
    actionMutation.isPending = true;
    actionMutation.variables = { type: "update-branch" };
    renderActions(
      makePullRequest({
        viewerCanUpdate: true,
        viewerCanUpdateBranch: true,
        viewerCanClose: true,
        viewerCanEnableAutoMerge: true,
      }),
    );

    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("renders nothing for a merged pull request", () => {
    const { container } = renderActions(
      makePullRequest({ state: "MERGED", viewerCanReopen: true }),
    );

    expect(container).toBeEmptyDOMElement();
  });
});
