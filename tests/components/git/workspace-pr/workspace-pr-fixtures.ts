import {
  summarizePullRequestChecks,
  type BranchPullRequest,
  type PullRequestCheck,
  type RepositoryMergeSettings,
} from "@/lib/github/branch-pull-request";
import type {
  PullRequestConversationItem,
  PullRequestFeedbackComment,
  PullRequestReviewThread,
} from "@/lib/github/pull-request-feedback";

export function makeRepository(
  overrides: Partial<RepositoryMergeSettings> = {},
): RepositoryMergeSettings {
  return {
    nameWithOwner: "acme/widgets",
    defaultBranchName: "main",
    allowedMergeMethods: ["SQUASH", "MERGE", "REBASE"],
    defaultMergeMethod: "SQUASH",
    isAutoMergeAllowed: true,
    viewerPermission: "WRITE",
    ...overrides,
  };
}

export function makeCheck(
  overrides: Partial<PullRequestCheck> & Pick<PullRequestCheck, "id">,
): PullRequestCheck {
  return {
    name: `check-${overrides.id}`,
    workflowName: null,
    state: "success",
    statusLabel: "Passed",
    description: null,
    url: null,
    startedAt: "2026-11-10T10:00:00Z",
    completedAt: "2026-11-10T10:01:05Z",
    ...overrides,
  };
}

export function makePullRequest(
  overrides: Partial<BranchPullRequest> = {},
): BranchPullRequest {
  const checks = overrides.checks ?? [];
  return {
    id: "PR_node_12",
    number: 12,
    title: "Add the widget parser",
    url: "https://github.com/acme/widgets/pull/12",
    state: "OPEN",
    isDraft: false,
    authorLogin: "octocat",
    authorAvatarUrl: "https://avatars.githubusercontent.com/u/1",
    baseRefName: "main",
    headRefName: "feat-x",
    headRefOid: "abc123",
    additions: 120,
    deletions: 30,
    changedFiles: 4,
    createdAt: "2026-11-09T10:00:00Z",
    updatedAt: "2026-11-10T10:00:00Z",
    mergedAt: null,
    closedAt: null,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    totalCommentsCount: 3,
    autoMerge: null,
    viewerCanUpdate: false,
    viewerCanUpdateBranch: false,
    viewerCanEnableAutoMerge: false,
    viewerCanDisableAutoMerge: false,
    viewerCanClose: false,
    viewerCanReopen: false,
    checksTotalCount: checks.length,
    checksSummary: summarizePullRequestChecks(checks),
    ...overrides,
    checks,
  };
}

export function makeComment(
  overrides: Partial<PullRequestFeedbackComment> &
    Pick<PullRequestFeedbackComment, "id">,
): PullRequestFeedbackComment {
  return {
    author: { login: "reviewer", avatarUrl: null, isBot: false },
    body: `Comment ${overrides.id}`,
    url: `https://github.com/acme/widgets/pull/12#discussion_${overrides.id}`,
    createdAt: "2026-11-10T09:00:00Z",
    ...overrides,
  };
}

export function makeThread(
  overrides: Partial<PullRequestReviewThread> &
    Pick<PullRequestReviewThread, "id" | "path">,
): PullRequestReviewThread {
  const comments = overrides.comments ?? [
    makeComment({ id: `${overrides.id}-c1` }),
  ];
  return {
    kind: "thread",
    line: 42,
    startLine: null,
    originalLine: 42,
    isResolved: false,
    isOutdated: false,
    totalCommentCount: comments.length,
    ...overrides,
    comments,
  };
}

export function makeReview(
  overrides: Partial<Extract<PullRequestConversationItem, { kind: "review" }>> &
    Pick<PullRequestFeedbackComment, "id">,
): PullRequestConversationItem {
  return {
    ...makeComment({ id: overrides.id }),
    kind: "review",
    state: "CHANGES_REQUESTED",
    ...overrides,
  };
}
