import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { WorkspacePrPanel } from "@/components/git/workspace-pr/workspace-pr-panel";
import type {
  BranchPullRequest,
  BranchPullRequestResult,
} from "@/lib/github/branch-pull-request";
import type { OpenPullRequestInDevHubInput } from "@/lib/github/pr-panel-selection";
import { makePullRequest, makeRepository } from "./workspace-pr-fixtures";

const panelMocks = vi.hoisted(() => ({
  openPullRequestInDevHub:
    vi.fn<(input: OpenPullRequestInDevHubInput) => void>(),
  pushMock: vi.fn(),
}));

vi.mock("@/lib/github/pr-panel-selection", () => ({
  openPullRequestInDevHub: panelMocks.openPullRequestInDevHub,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: panelMocks.pushMock }),
  usePathname: () => "/",
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-branch-pull-request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-branch-pull-request")>()),
  usePullRequestAction: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
  usePullRequestFeedback: () => ({
    data: { unresolvedThreads: [], resolvedThreads: [], conversation: [] },
    error: null,
  }),
}));

function renderPanel(loadResult: () => Promise<BranchPullRequestResult>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onRequestClose = vi.fn();
  function PanelHarness() {
    const query = useQuery({
      queryKey: ["test-branch-pr"],
      queryFn: loadResult,
    });
    return (
      <WorkspacePrPanel
        workspaceId="ws-1"
        owner="acme"
        repo="widgets"
        branch="feat-x"
        query={query}
        onRequestClose={onRequestClose}
      />
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <PanelHarness />
    </QueryClientProvider>,
  );
  return { onRequestClose, queryClient };
}

function resolveWith(pullRequest: BranchPullRequest | null) {
  return () => Promise.resolve({ repository: makeRepository(), pullRequest });
}

describe("WorkspacePrPanel", () => {
  beforeEach(() => {
    panelMocks.openPullRequestInDevHub.mockReset();
  });

  it("links to GitHub's compare page when the branch has no PR", async () => {
    renderPanel(resolveWith(null));

    const createLink = await screen.findByRole("link", {
      name: "Create pull request",
    });
    expect(createLink).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/compare/feat-x?expand=1",
    );
    expect(createLink).toHaveAttribute("target", "_blank");
  });

  it("explains that the default branch has no PR of its own", async () => {
    renderPanel(() =>
      Promise.resolve({
        repository: makeRepository({ defaultBranchName: "feat-x" }),
        pullRequest: null,
      }),
    );

    expect(
      await screen.findByText(/Switch to a feature branch/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Create pull request" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    { message: "GitHub token is missing", hasSettingsLink: true },
    { message: "GraphQL rate limit exceeded", hasSettingsLink: false },
  ])(
    "shows the error '$message' (settings link: $hasSettingsLink)",
    async ({ message, hasSettingsLink }) => {
      renderPanel(() => Promise.reject(new Error(message)));

      expect(await screen.findByText(message)).toBeInTheDocument();
      const settingsLink = screen.queryByRole("link", {
        name: "Open Settings",
      });
      if (hasSettingsLink) {
        expect(settingsLink).toHaveAttribute("href", "/settings");
      } else {
        expect(settingsLink).not.toBeInTheDocument();
      }
    },
  );

  it("opens the PR in Dev Hub and closes the popover", async () => {
    const user = userEvent.setup();
    const { onRequestClose } = renderPanel(resolveWith(makePullRequest()));

    await user.click(
      await screen.findByRole("button", { name: "Open in Dev Hub" }),
    );

    expect(panelMocks.openPullRequestInDevHub).toHaveBeenCalledWith(
      expect.objectContaining({ nameWithOwner: "acme/widgets", number: 12 }),
    );
    expect(onRequestClose).toHaveBeenCalledOnce();
  });

  it("links to the PR on GitHub in a new tab", async () => {
    renderPanel(resolveWith(makePullRequest()));

    const githubLink = await screen.findByRole("link", {
      name: "Open on GitHub",
    });
    expect(githubLink).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/pull/12",
    );
    expect(githubLink).toHaveAttribute("target", "_blank");
    expect(githubLink).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows no actions for a merged PR", async () => {
    renderPanel(
      resolveWith(makePullRequest({ state: "MERGED", viewerCanReopen: true })),
    );

    expect(await screen.findByText("Merged")).toBeInTheDocument();
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Merge" }),
    ).not.toBeInTheDocument();
  });

  it("shows actions, review and auto-merge chips for an open PR", async () => {
    renderPanel(
      resolveWith(
        makePullRequest({
          reviewDecision: "APPROVED",
          autoMerge: {
            enabledAt: "2026-11-10T10:00:00Z",
            mergeMethod: "SQUASH",
            enabledByLogin: "octocat",
          },
        }),
      ),
    );

    expect(
      await screen.findByRole("button", { name: "Merge" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Auto-merge: Squash")).toHaveAttribute(
      "title",
      "Enabled by octocat",
    );
  });

  it("refreshes the PR and its feedback", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderPanel(resolveWith(makePullRequest()));
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await screen.findByText("Add the widget parser");
    await user.click(
      screen.getByRole("button", { name: "Refresh pull request" }),
    );

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["github", "branch-pr", "acme", "widgets", "feat-x"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["github", "pr-feedback", "acme", "widgets", 12],
    });
  });
});
