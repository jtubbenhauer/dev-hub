import { describe, expect, it } from "vitest";
import { isAllowedGitHubRequest } from "@/lib/github/github-proxy-allowlist";

describe("isAllowedGitHubRequest", () => {
  it.each([
    ["GET", "user"],
    ["GET", "search/issues"],
    ["POST", "graphql"],
    ["GET", "repos/acme/web/pulls"],
    ["GET", "repos/acme/web/pulls/7"],
    ["GET", "repos/acme/web/pulls/7/files"],
    ["GET", "repos/acme/web/pulls/7/comments"],
    ["POST", "repos/acme/web/pulls/7/comments"],
    ["PATCH", "repos/acme/web/pulls/comments/99"],
    ["DELETE", "repos/acme/web/pulls/comments/99"],
    ["GET", "repos/acme/web/pulls/7/reviews"],
    ["POST", "repos/acme/web/pulls/7/reviews"],
    ["DELETE", "repos/acme/web/pulls/7/reviews/5"],
    ["POST", "repos/acme/web/pulls/7/reviews/5/events"],
    ["PUT", "repos/acme/web/pulls/7/merge"],
    ["GET", "repos/acme/web/commits/abc123/check-runs"],
    ["GET", "repos/acme/web/contents/src/app%20file.ts"],
    ["GET", "repos/acme/web/issues/7/comments"],
    ["GET", "repos/acme/web/actions/runs"],
    ["POST", "repos/acme/web/actions/runs/42/rerun"],
  ])("lets dev-hub's %s /%s through", (method, path) => {
    expect(isAllowedGitHubRequest(method, path)).toBe(true);
  });

  it.each([
    ["POST", "user/keys", "adding an SSH key to the account"],
    ["GET", "user/keys", "listing SSH keys"],
    ["PATCH", "user", "editing the profile"],
    ["DELETE", "repos/acme/web", "deleting a repository"],
    ["PATCH", "repos/acme/web", "changing repository settings"],
    ["PUT", "repos/acme/web/contents/README.md", "writing a file"],
    ["DELETE", "repos/acme/web/contents/README.md", "deleting a file"],
    ["POST", "repos/acme/web/hooks", "adding a webhook"],
    ["PUT", "repos/acme/web/collaborators/someone", "adding a collaborator"],
    ["POST", "repos/acme/web/actions/runs/42/cancel", "cancelling a run"],
    ["DELETE", "repos/acme/web/actions/runs/42", "deleting a run"],
    ["GET", "orgs/acme/members", "reading an organisation"],
    ["GET", "graphql", "a GET to GraphQL"],
  ])("refuses %s /%s (%s)", (method, path) => {
    expect(isAllowedGitHubRequest(method, path)).toBe(false);
  });
});
