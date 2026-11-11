import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UseQueryResult } from "@tanstack/react-query";
import { PullRequestView } from "@/components/workbench/context-sidebar/pull-request-view";
import type { WorkspacePrPanelProps } from "@/components/git/workspace-pr/workspace-pr-panel";
import type { WorkspacePullRequest } from "@/hooks/use-branch-pull-request";
import type { BranchPullRequestResult } from "@/lib/github/branch-pull-request";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";
import { createWorkspace } from "./workspace-fixture";

const workspacePullRequest = vi.hoisted(() => ({
  useWorkspacePullRequest:
    vi.fn<(workspaceId: string | null) => WorkspacePullRequest>(),
}));

vi.mock("@/hooks/use-branch-pull-request", () => ({
  useWorkspacePullRequest: workspacePullRequest.useWorkspacePullRequest,
}));

// The panel has its own tests; here it shows what the view handed it.
vi.mock("@/components/git/workspace-pr/workspace-pr-panel", () => ({
  WorkspacePrPanel: ({
    workspaceId,
    owner,
    repo,
    branch,
    onRequestClose,
  }: WorkspacePrPanelProps) => (
    <div data-testid="workspace-pr-panel">
      {`${workspaceId} ${owner}/${repo} ${branch}`}
      <button type="button" onClick={onRequestClose}>
        Leave panel
      </button>
    </div>
  ),
}));

const WORKSPACE_ID = "ws-1";

function makeWorkspacePullRequest(
  lookup: WorkspacePullRequest["lookup"],
): WorkspacePullRequest {
  return {
    owner: lookup === "no-github-remote" ? null : "acme",
    repo: lookup === "no-github-remote" ? null : "widgets",
    branch: lookup === "detached-head" ? null : "feat-x",
    lookup,
    query: {
      data: undefined,
      isError: false,
    } as unknown as UseQueryResult<BranchPullRequestResult>,
  };
}

function renderView() {
  return render(
    <PullRequestView
      workspaceId={WORKSPACE_ID}
      workspace={createWorkspace(WORKSPACE_ID)}
    />,
  );
}

beforeEach(() => {
  workspacePullRequest.useWorkspacePullRequest.mockReset();
  useContextSidebarStore.setState(
    useContextSidebarStore.getInitialState(),
    true,
  );
});

afterEach(() => {
  cleanup();
});

describe("PullRequestView", () => {
  it("shows the pull request panel for the workspace's branch", () => {
    workspacePullRequest.useWorkspacePullRequest.mockReturnValue(
      makeWorkspacePullRequest("ready"),
    );

    renderView();

    expect(screen.getByTestId("workspace-pr-panel")).toHaveTextContent(
      "ws-1 acme/widgets feat-x",
    );
    expect(workspacePullRequest.useWorkspacePullRequest).toHaveBeenCalledWith(
      WORKSPACE_ID,
    );
  });

  it("closes the phone sheet once the panel sends the user elsewhere", async () => {
    workspacePullRequest.useWorkspacePullRequest.mockReturnValue(
      makeWorkspacePullRequest("ready"),
    );
    useContextSidebarStore.setState({ isMobileSheetOpen: true });
    renderView();

    await userEvent.click(screen.getByRole("button", { name: "Leave panel" }));

    expect(useContextSidebarStore.getState().isMobileSheetOpen).toBe(false);
  });

  it("shows a placeholder while the workspace's git details load", () => {
    workspacePullRequest.useWorkspacePullRequest.mockReturnValue(
      makeWorkspacePullRequest("loading"),
    );

    renderView();

    expect(screen.getByLabelText("Loading pull request")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-pr-panel")).toBeNull();
  });

  it.each([
    ["not-a-repository", /not a git repository/],
    ["no-github-remote", /no GitHub remote/],
    ["detached-head", /Check out a branch/],
    ["unavailable", /Can't read this workspace's git status/],
  ] as const)(
    "explains why there is no pull request when the lookup is %s",
    (lookup, message) => {
      workspacePullRequest.useWorkspacePullRequest.mockReturnValue(
        makeWorkspacePullRequest(lookup),
      );

      renderView();

      expect(
        screen.getByRole("region", { name: "Pull request" }),
      ).toHaveTextContent(message);
      expect(screen.queryByTestId("workspace-pr-panel")).toBeNull();
    },
  );
});
