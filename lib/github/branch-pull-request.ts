// The pull request linked to a workspace's branch: one GraphQL round trip for
// the PR, its checks (check runs and commit statuses), review and merge state,
// auto-merge, the viewer's permissions and the repository's merge settings.

export type PullRequestState = "OPEN" | "CLOSED" | "MERGED";
export type PullRequestMergeMethod = "MERGE" | "SQUASH" | "REBASE";
export type PullRequestMergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
export type PullRequestMergeStateStatus =
  | "BEHIND"
  | "BLOCKED"
  | "CLEAN"
  | "DIRTY"
  | "DRAFT"
  | "HAS_HOOKS"
  | "UNKNOWN"
  | "UNSTABLE";
export type PullRequestReviewDecision =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REVIEW_REQUIRED";
export type RepositoryPermission =
  | "ADMIN"
  | "MAINTAIN"
  | "WRITE"
  | "TRIAGE"
  | "READ";

export type PullRequestCheckState =
  | "success"
  | "failure"
  | "pending"
  | "skipped"
  | "neutral";

export interface PullRequestCheck {
  id: string;
  name: string;
  workflowName: string | null;
  state: PullRequestCheckState;
  statusLabel: string;
  description: string | null;
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PullRequestChecksSummary {
  state: PullRequestCheckState | "none";
  total: number;
  successCount: number;
  failureCount: number;
  pendingCount: number;
  skippedCount: number;
}

export interface PullRequestAutoMerge {
  enabledAt: string;
  mergeMethod: PullRequestMergeMethod;
  enabledByLogin: string | null;
}

export interface BranchPullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  isDraft: boolean;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  mergeable: PullRequestMergeable;
  mergeStateStatus: PullRequestMergeStateStatus;
  reviewDecision: PullRequestReviewDecision | null;
  totalCommentsCount: number;
  autoMerge: PullRequestAutoMerge | null;
  viewerCanUpdate: boolean;
  viewerCanUpdateBranch: boolean;
  viewerCanEnableAutoMerge: boolean;
  viewerCanDisableAutoMerge: boolean;
  viewerCanClose: boolean;
  viewerCanReopen: boolean;
  checks: PullRequestCheck[];
  // GitHub returns at most 100 checks; this is the real total.
  checksTotalCount: number;
  checksSummary: PullRequestChecksSummary;
}

export interface RepositoryMergeSettings {
  nameWithOwner: string;
  defaultBranchName: string | null;
  allowedMergeMethods: PullRequestMergeMethod[];
  defaultMergeMethod: PullRequestMergeMethod;
  isAutoMergeAllowed: boolean;
  viewerPermission: RepositoryPermission | null;
}

export interface BranchPullRequestResult {
  repository: RepositoryMergeSettings;
  pullRequest: BranchPullRequest | null;
}

export const BRANCH_PULL_REQUEST_QUERY = `
  query BranchPullRequest($owner: String!, $repo: String!, $branch: String!) {
    repository(owner: $owner, name: $repo) {
      nameWithOwner
      defaultBranchRef { name }
      mergeCommitAllowed
      squashMergeAllowed
      rebaseMergeAllowed
      autoMergeAllowed
      viewerDefaultMergeMethod
      viewerPermission
      pullRequests(
        headRefName: $branch
        first: 10
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        nodes {
          id
          number
          title
          url
          state
          isDraft
          isCrossRepository
          author { login avatarUrl }
          baseRefName
          headRefName
          headRefOid
          additions
          deletions
          changedFiles
          createdAt
          updatedAt
          mergedAt
          closedAt
          mergeable
          mergeStateStatus
          reviewDecision
          totalCommentsCount
          autoMergeRequest { enabledAt mergeMethod enabledBy { login } }
          viewerCanUpdate
          viewerCanUpdateBranch
          viewerCanEnableAutoMerge
          viewerCanDisableAutoMerge
          viewerCanClose
          viewerCanReopen
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  contexts(first: 100) {
                    totalCount
                    nodes {
                      __typename
                      ... on CheckRun {
                        id
                        name
                        status
                        conclusion
                        detailsUrl
                        startedAt
                        completedAt
                        checkSuite { workflowRun { workflow { name } } }
                      }
                      ... on StatusContext {
                        id
                        context
                        state
                        description
                        targetUrl
                        createdAt
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface CheckRunNode {
  __typename: "CheckRun";
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  checkSuite: {
    workflowRun: { workflow: { name: string } | null } | null;
  } | null;
}

interface StatusContextNode {
  __typename: "StatusContext";
  id: string;
  context: string;
  state: string;
  description: string | null;
  targetUrl: string | null;
  createdAt: string | null;
}

export type StatusCheckContextNode = CheckRunNode | StatusContextNode;

export interface PullRequestNode {
  id: string;
  number: number;
  title: string;
  url: string;
  state: PullRequestState;
  isDraft: boolean;
  isCrossRepository: boolean;
  author: { login: string; avatarUrl: string | null } | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  mergeable: PullRequestMergeable;
  mergeStateStatus: PullRequestMergeStateStatus;
  reviewDecision: PullRequestReviewDecision | null;
  totalCommentsCount: number | null;
  autoMergeRequest: {
    enabledAt: string;
    mergeMethod: PullRequestMergeMethod;
    enabledBy: { login: string } | null;
  } | null;
  viewerCanUpdate: boolean;
  viewerCanUpdateBranch: boolean;
  viewerCanEnableAutoMerge: boolean;
  viewerCanDisableAutoMerge: boolean;
  viewerCanClose: boolean;
  viewerCanReopen: boolean;
  commits: {
    nodes: Array<{
      commit: {
        statusCheckRollup: {
          contexts: {
            totalCount: number;
            nodes: Array<StatusCheckContextNode | null>;
          };
        } | null;
      };
    } | null>;
  };
}

export interface BranchPullRequestQueryData {
  repository: {
    nameWithOwner: string;
    defaultBranchRef: { name: string } | null;
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
    autoMergeAllowed: boolean;
    viewerDefaultMergeMethod: PullRequestMergeMethod;
    viewerPermission: RepositoryPermission | null;
    pullRequests: { nodes: Array<PullRequestNode | null> };
  } | null;
}

const CHECK_STATE_ORDER: Record<PullRequestCheckState, number> = {
  failure: 0,
  pending: 1,
  success: 2,
  neutral: 3,
  skipped: 4,
};

const CHECK_RUN_PENDING_LABELS: Record<string, string> = {
  QUEUED: "Queued",
  IN_PROGRESS: "In progress",
  WAITING: "Waiting",
  PENDING: "Pending",
  REQUESTED: "Requested",
};

const CHECK_RUN_CONCLUSIONS: Record<
  string,
  { state: PullRequestCheckState; label: string }
> = {
  SUCCESS: { state: "success", label: "Passed" },
  FAILURE: { state: "failure", label: "Failed" },
  TIMED_OUT: { state: "failure", label: "Timed out" },
  CANCELLED: { state: "failure", label: "Cancelled" },
  ACTION_REQUIRED: { state: "failure", label: "Action required" },
  STARTUP_FAILURE: { state: "failure", label: "Startup failure" },
  SKIPPED: { state: "skipped", label: "Skipped" },
  NEUTRAL: { state: "neutral", label: "Neutral" },
  STALE: { state: "neutral", label: "Stale" },
};

const STATUS_CONTEXT_STATES: Record<
  string,
  { state: PullRequestCheckState; label: string }
> = {
  SUCCESS: { state: "success", label: "Passed" },
  FAILURE: { state: "failure", label: "Failed" },
  ERROR: { state: "failure", label: "Error" },
  PENDING: { state: "pending", label: "Pending" },
  EXPECTED: { state: "pending", label: "Expected" },
};

function toCheck(node: StatusCheckContextNode): PullRequestCheck {
  if (node.__typename === "StatusContext") {
    const mapped = STATUS_CONTEXT_STATES[node.state] ?? {
      state: "neutral" as const,
      label: node.state,
    };
    return {
      id: node.id,
      name: node.context,
      workflowName: null,
      state: mapped.state,
      statusLabel: mapped.label,
      description: node.description,
      url: node.targetUrl,
      startedAt: node.createdAt,
      completedAt: null,
    };
  }

  const isCompleted = node.status === "COMPLETED";
  const mapped = isCompleted
    ? (CHECK_RUN_CONCLUSIONS[node.conclusion ?? ""] ?? {
        state: "pending" as const,
        label: "Pending",
      })
    : {
        state: "pending" as const,
        label: CHECK_RUN_PENDING_LABELS[node.status] ?? "Pending",
      };
  return {
    id: node.id,
    name: node.name,
    workflowName: node.checkSuite?.workflowRun?.workflow?.name ?? null,
    state: mapped.state,
    statusLabel: mapped.label,
    description: null,
    url: node.detailsUrl,
    startedAt: node.startedAt,
    completedAt: isCompleted ? node.completedAt : null,
  };
}

export function normalizeStatusCheckContexts(
  nodes: ReadonlyArray<StatusCheckContextNode | null>,
): PullRequestCheck[] {
  return nodes
    .filter((node): node is StatusCheckContextNode => node !== null)
    .filter(
      (node) =>
        node.__typename === "CheckRun" || node.__typename === "StatusContext",
    )
    .map(toCheck)
    .sort(
      (a, b) =>
        CHECK_STATE_ORDER[a.state] - CHECK_STATE_ORDER[b.state] ||
        a.name.localeCompare(b.name),
    );
}

export function summarizePullRequestChecks(
  checks: readonly PullRequestCheck[],
): PullRequestChecksSummary {
  const countState = (state: PullRequestCheckState) =>
    checks.filter((check) => check.state === state).length;
  const successCount = countState("success");
  const failureCount = countState("failure");
  const pendingCount = countState("pending");
  const skippedCount = countState("skipped") + countState("neutral");

  let state: PullRequestChecksSummary["state"] = "none";
  if (failureCount > 0) state = "failure";
  else if (pendingCount > 0) state = "pending";
  else if (successCount > 0) state = "success";
  else if (checks.length > 0) state = "neutral";

  return {
    state,
    total: checks.length,
    successCount,
    failureCount,
    pendingCount,
    skippedCount,
  };
}

// headRefName matches by branch name only, so PRs opened from forks that
// happen to use the same branch name are dropped. An open PR wins; otherwise
// the most recently updated merged or closed one (the query orders by update).
export function selectBranchPullRequestNode(
  nodes: ReadonlyArray<PullRequestNode | null>,
): PullRequestNode | null {
  const sameRepositoryNodes = nodes.filter(
    (node): node is PullRequestNode => node !== null && !node.isCrossRepository,
  );
  return (
    sameRepositoryNodes.find((node) => node.state === "OPEN") ??
    sameRepositoryNodes[0] ??
    null
  );
}

function toBranchPullRequest(node: PullRequestNode): BranchPullRequest {
  const contexts =
    node.commits.nodes[0]?.commit.statusCheckRollup?.contexts ?? null;
  const checks = normalizeStatusCheckContexts(contexts?.nodes ?? []);
  return {
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.state,
    isDraft: node.isDraft,
    authorLogin: node.author?.login ?? null,
    authorAvatarUrl: node.author?.avatarUrl ?? null,
    baseRefName: node.baseRefName,
    headRefName: node.headRefName,
    headRefOid: node.headRefOid,
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFiles,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    mergedAt: node.mergedAt,
    closedAt: node.closedAt,
    mergeable: node.mergeable,
    mergeStateStatus: node.mergeStateStatus,
    reviewDecision: node.reviewDecision,
    totalCommentsCount: node.totalCommentsCount ?? 0,
    autoMerge: node.autoMergeRequest
      ? {
          enabledAt: node.autoMergeRequest.enabledAt,
          mergeMethod: node.autoMergeRequest.mergeMethod,
          enabledByLogin: node.autoMergeRequest.enabledBy?.login ?? null,
        }
      : null,
    viewerCanUpdate: node.viewerCanUpdate,
    viewerCanUpdateBranch: node.viewerCanUpdateBranch,
    viewerCanEnableAutoMerge: node.viewerCanEnableAutoMerge,
    viewerCanDisableAutoMerge: node.viewerCanDisableAutoMerge,
    viewerCanClose: node.viewerCanClose,
    viewerCanReopen: node.viewerCanReopen,
    checks,
    checksTotalCount: contexts?.totalCount ?? 0,
    checksSummary: summarizePullRequestChecks(checks),
  };
}

export function toBranchPullRequestResult(
  data: BranchPullRequestQueryData,
  fallbackNameWithOwner: string,
): BranchPullRequestResult {
  const repository = data.repository;
  if (!repository) {
    throw new Error(
      `Repository ${fallbackNameWithOwner} was not found or the GitHub token cannot read it`,
    );
  }

  const allowedMergeMethods: PullRequestMergeMethod[] = [];
  if (repository.squashMergeAllowed) allowedMergeMethods.push("SQUASH");
  if (repository.mergeCommitAllowed) allowedMergeMethods.push("MERGE");
  if (repository.rebaseMergeAllowed) allowedMergeMethods.push("REBASE");

  const defaultMergeMethod = allowedMergeMethods.includes(
    repository.viewerDefaultMergeMethod,
  )
    ? repository.viewerDefaultMergeMethod
    : (allowedMergeMethods[0] ?? "MERGE");

  const pullRequestNode = selectBranchPullRequestNode(
    repository.pullRequests.nodes,
  );

  return {
    repository: {
      nameWithOwner: repository.nameWithOwner,
      defaultBranchName: repository.defaultBranchRef?.name ?? null,
      allowedMergeMethods,
      defaultMergeMethod,
      isAutoMergeAllowed: repository.autoMergeAllowed,
      viewerPermission: repository.viewerPermission,
    },
    pullRequest: pullRequestNode ? toBranchPullRequest(pullRequestNode) : null,
  };
}

export type MergeBlocker =
  | "not-open"
  | "no-permission"
  | "draft"
  | "conflicts"
  | "behind"
  | "blocked"
  | "checking";

export interface MergeReadiness {
  canMerge: boolean;
  blocker: MergeBlocker | null;
  message: string;
}

const MERGE_PERMISSIONS: ReadonlySet<RepositoryPermission> = new Set([
  "ADMIN",
  "MAINTAIN",
  "WRITE",
]);

function describeBlockedMerge(pullRequest: BranchPullRequest): string {
  if (pullRequest.reviewDecision === "CHANGES_REQUESTED") {
    return "Changes were requested";
  }
  if (pullRequest.reviewDecision === "REVIEW_REQUIRED") {
    return "An approving review is required";
  }
  if (pullRequest.checksSummary.state === "failure") {
    return "Required checks are failing";
  }
  if (pullRequest.checksSummary.state === "pending") {
    return "Waiting for required checks";
  }
  return "Branch protection rules are not satisfied";
}

export function getMergeReadiness(
  pullRequest: BranchPullRequest,
  viewerPermission: RepositoryPermission | null,
): MergeReadiness {
  if (pullRequest.state !== "OPEN") {
    return {
      canMerge: false,
      blocker: "not-open",
      message: `This pull request is ${pullRequest.state.toLowerCase()}`,
    };
  }
  if (!viewerPermission || !MERGE_PERMISSIONS.has(viewerPermission)) {
    return {
      canMerge: false,
      blocker: "no-permission",
      message: "You need write access to merge",
    };
  }
  if (pullRequest.isDraft || pullRequest.mergeStateStatus === "DRAFT") {
    return {
      canMerge: false,
      blocker: "draft",
      message: "Draft pull requests can't be merged",
    };
  }
  if (
    pullRequest.mergeable === "CONFLICTING" ||
    pullRequest.mergeStateStatus === "DIRTY"
  ) {
    return {
      canMerge: false,
      blocker: "conflicts",
      message: "Merge conflicts must be resolved",
    };
  }
  switch (pullRequest.mergeStateStatus) {
    case "BEHIND":
      return {
        canMerge: false,
        blocker: "behind",
        message: "The branch is behind its base",
      };
    case "BLOCKED":
      return {
        canMerge: false,
        blocker: "blocked",
        message: describeBlockedMerge(pullRequest),
      };
    case "UNKNOWN":
      return {
        canMerge: false,
        blocker: "checking",
        message: "GitHub is still checking mergeability",
      };
    case "UNSTABLE":
      return {
        canMerge: true,
        blocker: null,
        message: "Ready to merge; some non-required checks are failing",
      };
    case "CLEAN":
    case "HAS_HOOKS":
      return { canMerge: true, blocker: null, message: "Ready to merge" };
    default: {
      const unhandledStatus: never = pullRequest.mergeStateStatus;
      throw new Error(`Unhandled merge state: ${String(unhandledStatus)}`);
    }
  }
}

export const MERGE_METHOD_LABELS: Record<PullRequestMergeMethod, string> = {
  SQUASH: "Squash and merge",
  MERGE: "Create a merge commit",
  REBASE: "Rebase and merge",
};

// Open PRs, also while checks run (CI takes minutes, so polling faster only
// reports a finish a little sooner), and branches that may get a PR soon:
// every minute. Merged or closed PRs, and a default branch with no PR of its
// own, rarely change: every five minutes.
const ACTIVE_REFETCH_INTERVAL_MS = 60_000;
const QUIET_REFETCH_INTERVAL_MS = 300_000;

export function getBranchPullRequestRefetchInterval(
  result: BranchPullRequestResult | undefined,
  branch: string | null,
): number {
  const pullRequest = result?.pullRequest;
  if (pullRequest) {
    return pullRequest.state === "OPEN"
      ? ACTIVE_REFETCH_INTERVAL_MS
      : QUIET_REFETCH_INTERVAL_MS;
  }
  if (result && branch === result.repository.defaultBranchName) {
    return QUIET_REFETCH_INTERVAL_MS;
  }
  return ACTIVE_REFETCH_INTERVAL_MS;
}

export function buildCreatePullRequestUrl(
  nameWithOwner: string,
  branch: string,
): string {
  const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${nameWithOwner}/compare/${encodedBranch}?expand=1`;
}

// simple-git reports a detached HEAD as "HEAD" (or an empty branch).
export function toLookupBranch(
  branch: string | null | undefined,
): string | null {
  if (!branch) return null;
  const trimmed = branch.trim();
  if (!trimmed || trimmed === "HEAD" || trimmed.startsWith("(")) return null;
  return trimmed;
}
