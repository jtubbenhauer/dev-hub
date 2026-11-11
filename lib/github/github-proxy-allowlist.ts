// The GitHub API requests dev-hub makes. The /api/github proxy refuses
// everything else, so a dev-hub session cannot use the signed-in GitHub
// login for anything else (SSH keys, repository settings, deleting a repo).

interface AllowedGitHubRequest {
  methods: readonly string[];
  pathPattern: RegExp;
}

const REPOSITORY = "repos/[^/]+/[^/]+";

const ALLOWED_GITHUB_REQUESTS: readonly AllowedGitHubRequest[] = [
  { methods: ["GET"], pathPattern: /^user$/ },
  { methods: ["GET"], pathPattern: /^search\/issues$/ },
  { methods: ["POST"], pathPattern: /^graphql$/ },
  // Pull request reads, review comments, reviews and merging.
  {
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    pathPattern: new RegExp(`^${REPOSITORY}/pulls(/.+)?$`),
  },
  // Check runs, file contents at a ref, and PR conversation comments.
  {
    methods: ["GET"],
    pathPattern: new RegExp(`^${REPOSITORY}/(commits|contents|issues)/.+$`),
  },
  {
    methods: ["GET"],
    pathPattern: new RegExp(`^${REPOSITORY}/actions/runs$`),
  },
  {
    methods: ["POST"],
    pathPattern: new RegExp(`^${REPOSITORY}/actions/runs/\\d+/rerun$`),
  },
];

// `path` is the request path without the leading slash, after URL
// normalisation, so `..` segments are already resolved.
export function isAllowedGitHubRequest(method: string, path: string): boolean {
  return ALLOWED_GITHUB_REQUESTS.some(
    (allowed) =>
      allowed.methods.includes(method) && allowed.pathPattern.test(path),
  );
}
