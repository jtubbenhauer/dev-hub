import type { PullRequestMergeMethod } from "@/lib/github/branch-pull-request";

// Controls the sidebar PR panel offers. Each one is a GraphQL mutation keyed
// by the PR's node id. Merge, auto-merge and update-branch pass the head
// commit the panel showed, so GitHub refuses if new commits arrived since.

export type PullRequestAction =
  | { type: "merge"; mergeMethod: PullRequestMergeMethod }
  | { type: "enable-auto-merge"; mergeMethod: PullRequestMergeMethod }
  | { type: "disable-auto-merge" }
  | { type: "close" }
  | { type: "reopen" }
  | { type: "mark-ready-for-review" }
  | { type: "convert-to-draft" }
  | { type: "update-branch" };

export type PullRequestActionType = PullRequestAction["type"];

export interface PullRequestActionTarget {
  pullRequestId: string;
  headRefOid: string;
}

export interface GraphQLRequest {
  query: string;
  variables: Record<string, unknown>;
}

const MERGE_MUTATION = `
  mutation MergePullRequest($id: ID!, $mergeMethod: PullRequestMergeMethod!, $expectedHeadOid: GitObjectID) {
    mergePullRequest(input: { pullRequestId: $id, mergeMethod: $mergeMethod, expectedHeadOid: $expectedHeadOid }) {
      pullRequest { id state }
    }
  }
`;

const ENABLE_AUTO_MERGE_MUTATION = `
  mutation EnablePullRequestAutoMerge($id: ID!, $mergeMethod: PullRequestMergeMethod!, $expectedHeadOid: GitObjectID) {
    enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $mergeMethod, expectedHeadOid: $expectedHeadOid }) {
      pullRequest { id }
    }
  }
`;

const DISABLE_AUTO_MERGE_MUTATION = `
  mutation DisablePullRequestAutoMerge($id: ID!) {
    disablePullRequestAutoMerge(input: { pullRequestId: $id }) {
      pullRequest { id }
    }
  }
`;

const CLOSE_MUTATION = `
  mutation ClosePullRequest($id: ID!) {
    closePullRequest(input: { pullRequestId: $id }) {
      pullRequest { id state }
    }
  }
`;

const REOPEN_MUTATION = `
  mutation ReopenPullRequest($id: ID!) {
    reopenPullRequest(input: { pullRequestId: $id }) {
      pullRequest { id state }
    }
  }
`;

const MARK_READY_FOR_REVIEW_MUTATION = `
  mutation MarkPullRequestReadyForReview($id: ID!) {
    markPullRequestReadyForReview(input: { pullRequestId: $id }) {
      pullRequest { id isDraft }
    }
  }
`;

const CONVERT_TO_DRAFT_MUTATION = `
  mutation ConvertPullRequestToDraft($id: ID!) {
    convertPullRequestToDraft(input: { pullRequestId: $id }) {
      pullRequest { id isDraft }
    }
  }
`;

const UPDATE_BRANCH_MUTATION = `
  mutation UpdatePullRequestBranch($id: ID!, $expectedHeadOid: GitObjectID) {
    updatePullRequestBranch(input: { pullRequestId: $id, expectedHeadOid: $expectedHeadOid, updateMethod: MERGE }) {
      pullRequest { id }
    }
  }
`;

export function buildPullRequestActionRequest(
  action: PullRequestAction,
  target: PullRequestActionTarget,
): GraphQLRequest {
  const id = target.pullRequestId;
  switch (action.type) {
    case "merge":
      return {
        query: MERGE_MUTATION,
        variables: {
          id,
          mergeMethod: action.mergeMethod,
          expectedHeadOid: target.headRefOid,
        },
      };
    case "enable-auto-merge":
      return {
        query: ENABLE_AUTO_MERGE_MUTATION,
        variables: {
          id,
          mergeMethod: action.mergeMethod,
          expectedHeadOid: target.headRefOid,
        },
      };
    case "disable-auto-merge":
      return { query: DISABLE_AUTO_MERGE_MUTATION, variables: { id } };
    case "close":
      return { query: CLOSE_MUTATION, variables: { id } };
    case "reopen":
      return { query: REOPEN_MUTATION, variables: { id } };
    case "mark-ready-for-review":
      return { query: MARK_READY_FOR_REVIEW_MUTATION, variables: { id } };
    case "convert-to-draft":
      return { query: CONVERT_TO_DRAFT_MUTATION, variables: { id } };
    case "update-branch":
      return {
        query: UPDATE_BRANCH_MUTATION,
        variables: { id, expectedHeadOid: target.headRefOid },
      };
    default: {
      const unhandledAction: never = action;
      throw new Error(
        `Unhandled pull request action: ${JSON.stringify(unhandledAction)}`,
      );
    }
  }
}

export const PULL_REQUEST_ACTION_SUCCESS_MESSAGES: Record<
  PullRequestActionType,
  string
> = {
  merge: "Pull request merged",
  "enable-auto-merge": "Auto-merge enabled",
  "disable-auto-merge": "Auto-merge disabled",
  close: "Pull request closed",
  reopen: "Pull request reopened",
  "mark-ready-for-review": "Marked ready for review",
  "convert-to-draft": "Converted to draft",
  "update-branch": "Branch updated from base",
};
