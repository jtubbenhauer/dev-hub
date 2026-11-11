import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  branchPullRequestQueryKey,
  useBranchPullRequest,
  usePullRequestAction,
  usePullRequestFeedback,
  useWorkspacePullRequest,
} from "@/hooks/use-branch-pull-request";
import { PULL_REQUEST_ACTION_SUCCESS_MESSAGES } from "@/lib/github/pull-request-actions";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

interface GraphQLCall {
  query: string;
  variables: Record<string, unknown>;
}

const branchPullRequestData = {
  repository: {
    nameWithOwner: "acme/web",
    defaultBranchRef: { name: "main" },
    mergeCommitAllowed: true,
    squashMergeAllowed: true,
    rebaseMergeAllowed: false,
    autoMergeAllowed: true,
    viewerDefaultMergeMethod: "SQUASH",
    viewerPermission: "WRITE",
    pullRequests: {
      nodes: [
        {
          id: "PR_node_7",
          number: 7,
          title: "Add sidebar PR button",
          url: "https://github.com/acme/web/pull/7",
          state: "OPEN",
          isDraft: false,
          isCrossRepository: false,
          author: { login: "miguel", avatarUrl: null },
          baseRefName: "main",
          headRefName: "feat/pr-button",
          headRefOid: "abc123",
          additions: 1,
          deletions: 1,
          changedFiles: 1,
          createdAt: "2026-11-10T10:00:00Z",
          updatedAt: "2026-11-11T10:00:00Z",
          mergedAt: null,
          closedAt: null,
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          reviewDecision: null,
          totalCommentsCount: 0,
          autoMergeRequest: null,
          viewerCanUpdate: true,
          viewerCanUpdateBranch: false,
          viewerCanEnableAutoMerge: false,
          viewerCanDisableAutoMerge: false,
          viewerCanClose: true,
          viewerCanReopen: false,
          commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
        },
      ],
    },
  },
};

const feedbackData = {
  repository: {
    pullRequest: {
      reviewThreads: { nodes: [] },
      comments: {
        nodes: [
          {
            id: "C_1",
            body: "Please add a test",
            url: "https://github.com/acme/web/pull/7#issuecomment-1",
            createdAt: "2026-11-11T10:00:00Z",
            author: { __typename: "User", login: "alice", avatarUrl: null },
          },
        ],
      },
      reviews: { nodes: [] },
    },
  },
};

let gitStatus: { isRepo: boolean; branch: string } | null;
let remoteUrl: string;
let graphQLResponses: Array<Record<string, unknown>>;
let graphQLCalls: GraphQLCall[];

function stubFetch() {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/workspaces/ws-1/git?action=status") {
      return gitStatus
        ? Response.json(gitStatus)
        : Response.json({ error: "Agent unreachable" }, { status: 502 });
    }
    if (input === "/api/workspaces/ws-1/git?action=remotes") {
      return Response.json([
        { name: "origin", fetchUrl: remoteUrl, pushUrl: remoteUrl },
      ]);
    }
    if (input === "/api/github/graphql") {
      graphQLCalls.push(JSON.parse(String(init?.body)) as GraphQLCall);
      const response = graphQLResponses.shift();
      if (!response) throw new Error("Unexpected GraphQL request");
      return Response.json(response);
    }
    throw new Error(`Unexpected fetch: ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function QueryWrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return { queryClient, wrapper: QueryWrapper };
}

beforeEach(() => {
  gitStatus = { isRepo: true, branch: "feat/pr-button" };
  remoteUrl = "git@github.com:acme/web.git";
  graphQLResponses = [];
  graphQLCalls = [];
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWorkspacePullRequest", () => {
  it("looks up the pull request for the workspace's branch on its origin repository", async () => {
    graphQLResponses.push({ data: branchPullRequestData });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspacePullRequest("ws-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current).toMatchObject({
      owner: "acme",
      repo: "web",
      branch: "feat/pr-button",
      lookup: "ready",
    });
    expect(graphQLCalls).toHaveLength(1);
    expect(graphQLCalls[0].variables).toEqual({
      owner: "acme",
      repo: "web",
      branch: "feat/pr-button",
    });
    expect(result.current.query.data?.pullRequest?.number).toBe(7);
    expect(result.current.query.data?.repository.allowedMergeMethods).toEqual([
      "SQUASH",
      "MERGE",
    ]);
  });

  it("does not ask GitHub when the workspace is on a detached HEAD", async () => {
    gitStatus = { isRepo: true, branch: "HEAD" };
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspacePullRequest("ws-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.lookup).toBe("detached-head"));
    expect(result.current.owner).toBe("acme");
    expect(result.current.branch).toBeNull();
    expect(result.current.query.fetchStatus).toBe("idle");
    expect(graphQLCalls).toHaveLength(0);
  });

  it("reports a folder that is not a git repository", async () => {
    gitStatus = { isRepo: false, branch: "" };
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspacePullRequest("ws-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.lookup).toBe("not-a-repository"));
    expect(graphQLCalls).toHaveLength(0);
  });

  it("reports when the workspace's git status cannot be read", async () => {
    gitStatus = null;
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspacePullRequest("ws-1"), {
      wrapper,
    });

    expect(result.current.lookup).toBe("loading");
    await waitFor(() => expect(result.current.lookup).toBe("unavailable"));
    expect(graphQLCalls).toHaveLength(0);
  });

  it("is not a GitHub repository when origin points somewhere else", async () => {
    remoteUrl = "git@gitlab.com:acme/web.git";
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspacePullRequest("ws-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.lookup).toBe("no-github-remote"));
    expect(result.current.branch).toBe("feat/pr-button");
    expect(graphQLCalls).toHaveLength(0);
  });

  it("surfaces GitHub's error message", async () => {
    graphQLResponses.push({
      data: null,
      errors: [{ message: "Bad credentials" }],
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspacePullRequest("ws-1"), {
      wrapper,
    });

    await waitFor(() => expect(result.current.query.isError).toBe(true));
    expect(result.current.query.error?.message).toBe("Bad credentials");
  });
});

describe("usePullRequestFeedback", () => {
  it("fetches comments only once the panel asks for them", async () => {
    graphQLResponses.push({ data: feedbackData });
    const { wrapper } = createWrapper();

    const { result, rerender } = renderHook(
      ({ isEnabled }: { isEnabled: boolean }) =>
        usePullRequestFeedback("acme", "web", 7, isEnabled),
      { wrapper, initialProps: { isEnabled: false } },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(graphQLCalls).toHaveLength(0);

    rerender({ isEnabled: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(graphQLCalls[0].variables).toEqual({
      owner: "acme",
      repo: "web",
      number: 7,
    });
    expect(result.current.data?.conversation.map((item) => item.id)).toEqual([
      "C_1",
    ]);
  });
});

describe("usePullRequestAction", () => {
  const scope = {
    owner: "acme",
    repo: "web",
    branch: "feat/pr-button",
    pullRequest: { id: "PR_node_7", number: 7, headRefOid: "abc123" },
  };

  it("runs the mutation for the linked pull request and refreshes its status", async () => {
    graphQLResponses.push({ data: { closePullRequest: { pullRequest: {} } } });
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => usePullRequestAction(scope), {
      wrapper,
    });
    act(() => result.current.mutate({ type: "close" }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(graphQLCalls[0].query).toContain("closePullRequest(");
    expect(graphQLCalls[0].variables).toEqual({ id: "PR_node_7" });
    expect(toastMock.success).toHaveBeenCalledExactlyOnceWith(
      PULL_REQUEST_ACTION_SUCCESS_MESSAGES.close,
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: branchPullRequestQueryKey("acme", "web", "feat/pr-button"),
    });
  });

  it("reports a refused action and still refreshes the pull request", async () => {
    graphQLResponses.push({
      data: null,
      errors: [{ message: "Head branch was modified" }],
    });
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => usePullRequestAction(scope), {
      wrapper,
    });
    act(() => result.current.mutate({ type: "merge", mergeMethod: "SQUASH" }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastMock.error).toHaveBeenCalledExactlyOnceWith(
      "Head branch was modified",
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: branchPullRequestQueryKey("acme", "web", "feat/pr-button"),
    });
  });
});

describe("useBranchPullRequest polling", () => {
  const openPullRequestNode =
    branchPullRequestData.repository.pullRequests.nodes[0];
  const runningChecksData = {
    repository: {
      ...branchPullRequestData.repository,
      pullRequests: {
        nodes: [
          {
            ...openPullRequestNode,
            commits: {
              nodes: [
                {
                  commit: {
                    statusCheckRollup: {
                      contexts: {
                        totalCount: 1,
                        nodes: [
                          {
                            __typename: "CheckRun",
                            id: "CR_1",
                            name: "build",
                            status: "IN_PROGRESS",
                            conclusion: null,
                            detailsUrl: null,
                            startedAt: "2026-11-11T10:00:00Z",
                            completedAt: null,
                            checkSuite: null,
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  };
  const defaultBranchData = {
    repository: {
      ...branchPullRequestData.repository,
      pullRequests: { nodes: [] },
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
  });

  afterEach(() => {
    focusManager.setFocused(undefined);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("checks an open pull request once a minute, even while its checks run", async () => {
    graphQLResponses.push(
      { data: runningChecksData },
      { data: runningChecksData },
    );
    const { wrapper } = createWrapper();

    renderHook(() => useBranchPullRequest("acme", "web", "feat/pr-button"), {
      wrapper,
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(graphQLCalls).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(graphQLCalls).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(graphQLCalls).toHaveLength(2);
  });

  it("checks a default branch with no pull request every five minutes", async () => {
    graphQLResponses.push(
      { data: defaultBranchData },
      { data: defaultBranchData },
    );
    const { wrapper } = createWrapper();

    renderHook(() => useBranchPullRequest("acme", "web", "main"), {
      wrapper,
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(graphQLCalls).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(240_000));
    expect(graphQLCalls).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(graphQLCalls).toHaveLength(2);
  });
});
