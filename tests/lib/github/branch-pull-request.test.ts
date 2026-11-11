import { describe, expect, it } from "vitest";
import {
  buildCreatePullRequestUrl,
  getBranchPullRequestRefetchInterval,
  getMergeReadiness,
  normalizeStatusCheckContexts,
  selectBranchPullRequestNode,
  summarizePullRequestChecks,
  toBranchPullRequestResult,
  toLookupBranch,
  type BranchPullRequest,
  type BranchPullRequestQueryData,
  type PullRequestNode,
  type StatusCheckContextNode,
} from "@/lib/github/branch-pull-request";

function makeCheckRun(
  overrides: Partial<
    Extract<StatusCheckContextNode, { __typename: "CheckRun" }>
  >,
): StatusCheckContextNode {
  return {
    __typename: "CheckRun",
    id: "CR_1",
    name: "build",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    detailsUrl: "https://github.com/acme/web/actions/runs/1/job/1",
    startedAt: "2026-11-11T10:00:00Z",
    completedAt: "2026-11-11T10:02:00Z",
    checkSuite: { workflowRun: { workflow: { name: "CI" } } },
    ...overrides,
  };
}

function makeStatusContext(
  overrides: Partial<
    Extract<StatusCheckContextNode, { __typename: "StatusContext" }>
  >,
): StatusCheckContextNode {
  return {
    __typename: "StatusContext",
    id: "SC_1",
    context: "vercel",
    state: "SUCCESS",
    description: "Deployment ready",
    targetUrl: "https://vercel.com/acme/web/1",
    createdAt: "2026-11-11T10:00:00Z",
    ...overrides,
  };
}

function makePullRequestNode(
  overrides: Partial<PullRequestNode> = {},
  contexts: StatusCheckContextNode[] = [],
): PullRequestNode {
  return {
    id: "PR_node_7",
    number: 7,
    title: "Add sidebar PR button",
    url: "https://github.com/acme/web/pull/7",
    state: "OPEN",
    isDraft: false,
    isCrossRepository: false,
    author: { login: "miguel", avatarUrl: "https://avatars/miguel.png" },
    baseRefName: "main",
    headRefName: "feat/pr-button",
    headRefOid: "abc123",
    additions: 120,
    deletions: 8,
    changedFiles: 6,
    createdAt: "2026-11-10T10:00:00Z",
    updatedAt: "2026-11-11T10:00:00Z",
    mergedAt: null,
    closedAt: null,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    totalCommentsCount: 3,
    autoMergeRequest: null,
    viewerCanUpdate: true,
    viewerCanUpdateBranch: false,
    viewerCanEnableAutoMerge: true,
    viewerCanDisableAutoMerge: false,
    viewerCanClose: true,
    viewerCanReopen: false,
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: { totalCount: contexts.length, nodes: contexts },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

function makeQueryData(
  nodes: Array<PullRequestNode | null>,
  repositoryOverrides: Partial<
    NonNullable<BranchPullRequestQueryData["repository"]>
  > = {},
): BranchPullRequestQueryData {
  return {
    repository: {
      nameWithOwner: "acme/web",
      defaultBranchRef: { name: "main" },
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
      autoMergeAllowed: true,
      viewerDefaultMergeMethod: "SQUASH",
      viewerPermission: "WRITE",
      pullRequests: { nodes },
      ...repositoryOverrides,
    },
  };
}

function makeBranchPullRequest(
  overrides: Partial<PullRequestNode> = {},
  contexts: StatusCheckContextNode[] = [],
): BranchPullRequest {
  const result = toBranchPullRequestResult(
    makeQueryData([makePullRequestNode(overrides, contexts)]),
    "acme/web",
  );
  if (!result.pullRequest) throw new Error("fixture has no pull request");
  return result.pullRequest;
}

describe("selectBranchPullRequestNode", () => {
  it("prefers the open pull request over a more recently updated merged one", () => {
    const merged = makePullRequestNode({ number: 9, state: "MERGED" });
    const open = makePullRequestNode({ number: 7, state: "OPEN" });

    expect(selectBranchPullRequestNode([merged, open])?.number).toBe(7);
  });

  it("drops pull requests opened from forks with the same branch name", () => {
    const fromFork = makePullRequestNode({
      number: 11,
      isCrossRepository: true,
    });
    const merged = makePullRequestNode({ number: 4, state: "MERGED" });

    expect(selectBranchPullRequestNode([fromFork, merged])?.number).toBe(4);
  });

  it("falls back to the most recently updated closed or merged pull request", () => {
    const closed = makePullRequestNode({ number: 5, state: "CLOSED" });
    const olderMerged = makePullRequestNode({ number: 3, state: "MERGED" });

    expect(selectBranchPullRequestNode([closed, olderMerged])?.number).toBe(5);
  });

  it("returns null when the branch has no pull request of its own", () => {
    expect(selectBranchPullRequestNode([])).toBeNull();
    expect(
      selectBranchPullRequestNode([
        null,
        makePullRequestNode({ isCrossRepository: true }),
      ]),
    ).toBeNull();
  });
});

describe("normalizeStatusCheckContexts", () => {
  it("maps check runs and commit statuses to check states and labels", () => {
    const checks = normalizeStatusCheckContexts([
      makeCheckRun({ id: "a", name: "lint", status: "IN_PROGRESS" }),
      makeCheckRun({ id: "b", name: "test", conclusion: "CANCELLED" }),
      makeCheckRun({ id: "c", name: "e2e", conclusion: "SKIPPED" }),
      makeStatusContext({ id: "d", context: "deploy", state: "ERROR" }),
      makeStatusContext({ id: "e", context: "coverage", state: "EXPECTED" }),
      makeCheckRun({ id: "f", name: "build", conclusion: "SUCCESS" }),
    ]);

    expect(
      checks.map((check) => [check.id, check.state, check.statusLabel]),
    ).toEqual([
      ["d", "failure", "Error"],
      ["b", "failure", "Cancelled"],
      ["e", "pending", "Expected"],
      ["a", "pending", "In progress"],
      ["f", "success", "Passed"],
      ["c", "skipped", "Skipped"],
    ]);
  });

  it("keeps the workflow name, details link and unfinished timing of a check run", () => {
    const [check] = normalizeStatusCheckContexts([
      makeCheckRun({
        status: "QUEUED",
        conclusion: null,
        completedAt: "1970-01-01T00:00:00Z",
      }),
    ]);

    expect(check).toMatchObject({
      name: "build",
      workflowName: "CI",
      state: "pending",
      statusLabel: "Queued",
      url: "https://github.com/acme/web/actions/runs/1/job/1",
      completedAt: null,
    });
  });

  it("uses the status context's name, description and target link", () => {
    const [check] = normalizeStatusCheckContexts([makeStatusContext({})]);

    expect(check).toMatchObject({
      name: "vercel",
      workflowName: null,
      state: "success",
      description: "Deployment ready",
      url: "https://vercel.com/acme/web/1",
    });
  });

  it("ignores missing nodes", () => {
    expect(normalizeStatusCheckContexts([null])).toEqual([]);
  });
});

describe("summarizePullRequestChecks", () => {
  it("counts checks and lets failures outrank pending and passing checks", () => {
    const summary = summarizePullRequestChecks(
      normalizeStatusCheckContexts([
        makeCheckRun({ id: "a", conclusion: "FAILURE" }),
        makeCheckRun({ id: "b", status: "IN_PROGRESS", conclusion: null }),
        makeCheckRun({ id: "c", conclusion: "SUCCESS" }),
        makeCheckRun({ id: "d", conclusion: "NEUTRAL" }),
        makeCheckRun({ id: "e", conclusion: "SKIPPED" }),
      ]),
    );

    expect(summary).toEqual({
      state: "failure",
      total: 5,
      successCount: 1,
      failureCount: 1,
      pendingCount: 1,
      skippedCount: 2,
    });
  });

  it("reports pending before success, neutral for only skipped checks and none for no checks", () => {
    const pending = normalizeStatusCheckContexts([
      makeCheckRun({ id: "a", status: "QUEUED", conclusion: null }),
      makeCheckRun({ id: "b" }),
    ]);
    const skipped = normalizeStatusCheckContexts([
      makeCheckRun({ conclusion: "SKIPPED" }),
    ]);

    expect(summarizePullRequestChecks(pending).state).toBe("pending");
    expect(summarizePullRequestChecks(skipped).state).toBe("neutral");
    expect(summarizePullRequestChecks([]).state).toBe("none");
  });
});

describe("toBranchPullRequestResult", () => {
  it("lists only the merge methods the repository allows and keeps a usable default", () => {
    const result = toBranchPullRequestResult(
      makeQueryData([], {
        squashMergeAllowed: false,
        mergeCommitAllowed: true,
        rebaseMergeAllowed: true,
        viewerDefaultMergeMethod: "SQUASH",
      }),
      "acme/web",
    );

    expect(result.repository.allowedMergeMethods).toEqual(["MERGE", "REBASE"]);
    expect(result.repository.defaultMergeMethod).toBe("MERGE");
    expect(result.pullRequest).toBeNull();
  });

  it("maps the selected pull request with auto-merge and the real check total", () => {
    const node = makePullRequestNode(
      {
        autoMergeRequest: {
          enabledAt: "2026-11-11T09:00:00Z",
          mergeMethod: "REBASE",
          enabledBy: { login: "miguel" },
        },
      },
      [makeCheckRun({ conclusion: "FAILURE" })],
    );
    node.commits.nodes[0]!.commit.statusCheckRollup!.contexts.totalCount = 140;

    const result = toBranchPullRequestResult(makeQueryData([node]), "acme/web");

    expect(result.repository).toMatchObject({
      nameWithOwner: "acme/web",
      defaultBranchName: "main",
      defaultMergeMethod: "SQUASH",
      isAutoMergeAllowed: true,
      viewerPermission: "WRITE",
    });
    expect(result.pullRequest).toMatchObject({
      id: "PR_node_7",
      number: 7,
      headRefOid: "abc123",
      authorLogin: "miguel",
      autoMerge: {
        enabledAt: "2026-11-11T09:00:00Z",
        mergeMethod: "REBASE",
        enabledByLogin: "miguel",
      },
      checksTotalCount: 140,
      checksSummary: { state: "failure", failureCount: 1 },
    });
  });

  it("treats a commit without a status rollup as having no checks", () => {
    const node = makePullRequestNode();
    node.commits.nodes[0]!.commit.statusCheckRollup = null;

    const result = toBranchPullRequestResult(makeQueryData([node]), "acme/web");

    expect(result.pullRequest?.checks).toEqual([]);
    expect(result.pullRequest?.checksSummary.state).toBe("none");
  });

  it("throws a readable error when the repository cannot be read", () => {
    expect(() =>
      toBranchPullRequestResult({ repository: null }, "acme/secret"),
    ).toThrow(/acme\/secret/);
  });
});

describe("getMergeReadiness", () => {
  it.each([
    [{ mergeStateStatus: "CLEAN" }, true, null],
    [{ mergeStateStatus: "HAS_HOOKS" }, true, null],
    [{ mergeStateStatus: "UNSTABLE" }, true, null],
    [{ mergeStateStatus: "BEHIND" }, false, "behind"],
    [{ mergeStateStatus: "BLOCKED" }, false, "blocked"],
    [{ mergeStateStatus: "UNKNOWN" }, false, "checking"],
    [{ mergeStateStatus: "DIRTY" }, false, "conflicts"],
    [{ mergeable: "CONFLICTING" }, false, "conflicts"],
    [{ isDraft: true, mergeStateStatus: "DRAFT" }, false, "draft"],
    [{ state: "MERGED" }, false, "not-open"],
  ] as const)(
    "reports %o as canMerge=%s with blocker %s",
    (overrides, canMerge, blocker) => {
      const readiness = getMergeReadiness(
        makeBranchPullRequest(overrides),
        "WRITE",
      );

      expect(readiness.canMerge).toBe(canMerge);
      expect(readiness.blocker).toBe(blocker);
    },
  );

  it("blocks viewers without write access", () => {
    expect(getMergeReadiness(makeBranchPullRequest(), "READ").blocker).toBe(
      "no-permission",
    );
    expect(getMergeReadiness(makeBranchPullRequest(), null).blocker).toBe(
      "no-permission",
    );
  });

  it("explains a blocked merge by the review decision before the checks", () => {
    const changesRequested = makeBranchPullRequest({
      mergeStateStatus: "BLOCKED",
      reviewDecision: "CHANGES_REQUESTED",
    });
    const failingChecks = makeBranchPullRequest(
      { mergeStateStatus: "BLOCKED", reviewDecision: null },
      [makeCheckRun({ conclusion: "FAILURE" })],
    );

    expect(getMergeReadiness(changesRequested, "WRITE").message).toMatch(
      /changes were requested/i,
    );
    expect(getMergeReadiness(failingChecks, "WRITE").message).toMatch(
      /checks are failing/i,
    );
  });
});

describe("getBranchPullRequestRefetchInterval", () => {
  it("checks an open pull request every minute, also while its checks run", () => {
    const runningChecks = toBranchPullRequestResult(
      makeQueryData([
        makePullRequestNode({}, [
          makeCheckRun({ status: "IN_PROGRESS", conclusion: null }),
        ]),
      ]),
      "acme/web",
    );
    const settled = toBranchPullRequestResult(
      makeQueryData([makePullRequestNode()]),
      "acme/web",
    );

    expect(
      getBranchPullRequestRefetchInterval(runningChecks, "feat/pr-button"),
    ).toBe(60_000);
    expect(getBranchPullRequestRefetchInterval(settled, "feat/pr-button")).toBe(
      60_000,
    );
  });

  it.each(["MERGED", "CLOSED"] as const)(
    "checks a %s pull request every five minutes",
    (state) => {
      const result = toBranchPullRequestResult(
        makeQueryData([makePullRequestNode({ state })]),
        "acme/web",
      );

      expect(
        getBranchPullRequestRefetchInterval(result, "feat/pr-button"),
      ).toBe(300_000);
    },
  );

  it("checks the default branch every five minutes while it has no pull request", () => {
    const noPullRequest = toBranchPullRequestResult(
      makeQueryData([]),
      "acme/web",
    );
    const defaultBranchPullRequest = toBranchPullRequestResult(
      makeQueryData([makePullRequestNode({ headRefName: "main" })]),
      "acme/web",
    );

    expect(getBranchPullRequestRefetchInterval(noPullRequest, "main")).toBe(
      300_000,
    );
    expect(
      getBranchPullRequestRefetchInterval(defaultBranchPullRequest, "main"),
    ).toBe(60_000);
  });

  it("checks other branches without a pull request every minute", () => {
    const noPullRequest = toBranchPullRequestResult(
      makeQueryData([]),
      "acme/web",
    );

    expect(
      getBranchPullRequestRefetchInterval(noPullRequest, "feat/pr-button"),
    ).toBe(60_000);
    expect(getBranchPullRequestRefetchInterval(undefined, "main")).toBe(60_000);
  });
});

describe("buildCreatePullRequestUrl", () => {
  it("keeps branch path separators and encodes everything else", () => {
    expect(buildCreatePullRequestUrl("acme/web", "feat/pr #2")).toBe(
      "https://github.com/acme/web/compare/feat/pr%20%232?expand=1",
    );
  });
});

describe("toLookupBranch", () => {
  it.each([
    ["feat/pr-button", "feat/pr-button"],
    ["  main  ", "main"],
    ["HEAD", null],
    ["(HEAD detached at abc123)", null],
    ["", null],
    [null, null],
  ])("turns %o into %o", (branch, expected) => {
    expect(toLookupBranch(branch)).toBe(expected);
  });
});
