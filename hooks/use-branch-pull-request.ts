import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useGitRemotes,
  useGitStatus,
  useWorkspaceGitHub,
} from "@/hooks/use-git";
import { githubGraphQL } from "@/hooks/use-github";
import {
  BRANCH_PULL_REQUEST_QUERY,
  getBranchPullRequestRefetchInterval,
  toBranchPullRequestResult,
  toLookupBranch,
  type BranchPullRequest,
  type BranchPullRequestQueryData,
  type BranchPullRequestResult,
} from "@/lib/github/branch-pull-request";
import {
  PULL_REQUEST_FEEDBACK_QUERY,
  toPullRequestFeedback,
  type PullRequestFeedback,
  type PullRequestFeedbackQueryData,
} from "@/lib/github/pull-request-feedback";
import {
  buildPullRequestActionRequest,
  PULL_REQUEST_ACTION_SUCCESS_MESSAGES,
  type PullRequestAction,
} from "@/lib/github/pull-request-actions";

const FAILED_LOOKUP_REFETCH_INTERVAL_MS = 300_000;

export function branchPullRequestQueryKey(
  owner: string | null,
  repo: string | null,
  branch: string | null,
) {
  return ["github", "branch-pr", owner, repo, branch] as const;
}

export function pullRequestFeedbackQueryKey(
  owner: string | null,
  repo: string | null,
  number: number | null,
) {
  return ["github", "pr-feedback", owner, repo, number] as const;
}

export function useBranchPullRequest(
  owner: string | null,
  repo: string | null,
  branch: string | null,
) {
  return useQuery<BranchPullRequestResult>({
    queryKey: branchPullRequestQueryKey(owner, repo, branch),
    queryFn: async () => {
      const data = await githubGraphQL<BranchPullRequestQueryData>(
        BRANCH_PULL_REQUEST_QUERY,
        { owner, repo, branch },
      );
      return toBranchPullRequestResult(data, `${owner}/${repo}`);
    },
    enabled: !!(owner && repo && branch),
    staleTime: 15_000,
    // A missing token or unreadable repo will not fix itself every minute.
    refetchInterval: (query) =>
      query.state.status === "error"
        ? FAILED_LOOKUP_REFETCH_INTERVAL_MS
        : getBranchPullRequestRefetchInterval(query.state.data, branch),
  });
}

// Why a pull request can or cannot be looked up for a workspace.
export type WorkspacePullRequestLookup =
  | "loading"
  | "unavailable"
  | "not-a-repository"
  | "no-github-remote"
  | "detached-head"
  | "ready";

export interface WorkspacePullRequest {
  owner: string | null;
  repo: string | null;
  branch: string | null;
  lookup: WorkspacePullRequestLookup;
  query: UseQueryResult<BranchPullRequestResult>;
}

export function useWorkspacePullRequest(
  workspaceId: string | null,
): WorkspacePullRequest {
  const gitStatusQuery = useGitStatus(workspaceId);
  const remotesQuery = useGitRemotes(workspaceId);
  const github = useWorkspaceGitHub(workspaceId);
  const gitStatus = gitStatusQuery.data;
  const branch = gitStatus?.isRepo ? toLookupBranch(gitStatus.branch) : null;
  const owner = github?.owner ?? null;
  const repo = github?.repo ?? null;
  const query = useBranchPullRequest(owner, repo, branch);

  let lookup: WorkspacePullRequestLookup = "ready";
  if (gitStatus?.isRepo === false) lookup = "not-a-repository";
  else if (!gitStatus || !remotesQuery.data) {
    lookup =
      gitStatusQuery.isError || remotesQuery.isError
        ? "unavailable"
        : "loading";
  } else if (!github) lookup = "no-github-remote";
  else if (!branch) lookup = "detached-head";

  return { owner, repo, branch, lookup, query };
}

export function usePullRequestFeedback(
  owner: string | null,
  repo: string | null,
  number: number | null,
  isEnabled: boolean,
) {
  return useQuery<PullRequestFeedback>({
    queryKey: pullRequestFeedbackQueryKey(owner, repo, number),
    queryFn: async () => {
      const data = await githubGraphQL<PullRequestFeedbackQueryData>(
        PULL_REQUEST_FEEDBACK_QUERY,
        { owner, repo, number },
      );
      return toPullRequestFeedback(data);
    },
    enabled: isEnabled && !!(owner && repo && number),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export interface PullRequestActionScope {
  owner: string;
  repo: string;
  branch: string;
  pullRequest: Pick<BranchPullRequest, "id" | "number" | "headRefOid">;
}

export function usePullRequestAction(scope: PullRequestActionScope | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (action: PullRequestAction) => {
      if (!scope) throw new Error("No pull request is linked to this branch");
      const request = buildPullRequestActionRequest(action, {
        pullRequestId: scope.pullRequest.id,
        headRefOid: scope.pullRequest.headRefOid,
      });
      await githubGraphQL<unknown>(request.query, request.variables);
    },
    onSuccess: (_data, action) => {
      toast.success(PULL_REQUEST_ACTION_SUCCESS_MESSAGES[action.type]);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
    // Refresh on failure too: most failures mean the PR changed underneath.
    onSettled: () => {
      if (!scope) return;
      const { owner, repo, branch } = scope;
      const prNumber = scope.pullRequest.number;
      const staleQueryKeys = [
        branchPullRequestQueryKey(owner, repo, branch),
        pullRequestFeedbackQueryKey(owner, repo, prNumber),
        ["github", "pr", owner, repo, prNumber],
        ["github", "workspace-pr", owner, repo],
        ["github", "repo-prs", owner, repo],
        ["github", "prs-created-by-me"],
        ["github", "prs-awaiting-review"],
      ];
      for (const queryKey of staleQueryKeys) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
