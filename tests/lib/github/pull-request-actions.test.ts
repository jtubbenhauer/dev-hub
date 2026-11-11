import { describe, expect, it } from "vitest";
import {
  buildPullRequestActionRequest,
  type PullRequestAction,
} from "@/lib/github/pull-request-actions";

const target = { pullRequestId: "PR_node_7", headRefOid: "abc123" };

describe("buildPullRequestActionRequest", () => {
  it.each<[PullRequestAction, string, Record<string, unknown>]>([
    [
      { type: "merge", mergeMethod: "SQUASH" },
      "mergePullRequest(",
      { id: "PR_node_7", mergeMethod: "SQUASH", expectedHeadOid: "abc123" },
    ],
    [
      { type: "enable-auto-merge", mergeMethod: "REBASE" },
      "enablePullRequestAutoMerge(",
      { id: "PR_node_7", mergeMethod: "REBASE", expectedHeadOid: "abc123" },
    ],
    [
      { type: "disable-auto-merge" },
      "disablePullRequestAutoMerge(",
      { id: "PR_node_7" },
    ],
    [{ type: "close" }, "closePullRequest(", { id: "PR_node_7" }],
    [{ type: "reopen" }, "reopenPullRequest(", { id: "PR_node_7" }],
    [
      { type: "mark-ready-for-review" },
      "markPullRequestReadyForReview(",
      { id: "PR_node_7" },
    ],
    [
      { type: "convert-to-draft" },
      "convertPullRequestToDraft(",
      { id: "PR_node_7" },
    ],
    [
      { type: "update-branch" },
      "updatePullRequestBranch(",
      { id: "PR_node_7", expectedHeadOid: "abc123" },
    ],
  ])("sends %o as %s", (action, mutationField, variables) => {
    const request = buildPullRequestActionRequest(action, target);

    expect(request.query).toContain(mutationField);
    expect(request.variables).toEqual(variables);
  });

  it("guards merges against commits pushed after the panel loaded", () => {
    const request = buildPullRequestActionRequest(
      { type: "merge", mergeMethod: "MERGE" },
      target,
    );

    expect(request.query).toContain("expectedHeadOid: $expectedHeadOid");
  });
});
