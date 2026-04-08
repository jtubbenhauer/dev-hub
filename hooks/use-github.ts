"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  GitHubPullRequest,
  GitHubPullRequestFile,
  GitHubReviewComment,
  GitHubReview,
  GitHubReviewEvent,
  GitHubMergeMethod,
  GitHubCheckRun,
  GitHubUser,
  GitHubPrFileContent,
} from "@/types";
import { parseDiffHunkLines } from "@/lib/github-diff";
import { useReviewDraftStore } from "@/stores/review-draft-store";

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "css",
  ".less": "css",
  ".md": "markdown",
  ".mdx": "markdown",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".yaml": "yaml",
  ".yml": "yaml",
};

function getLanguageFromPath(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return "plaintext";
  const ext = filePath.slice(lastDot).toLowerCase();
  return EXTENSION_LANGUAGE_MAP[ext] ?? "plaintext";
}

async function githubFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/github/${path}`, options);
  if (!res.ok) {
    let message = `GitHub API error (${res.status})`;
    try {
      const err = await res.json();
      if (err.message) message = err.message;
      else if (err.error) message = err.error;
    } catch {
      // non-JSON body
    }
    throw new Error(message);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

async function githubFetchAllPages<T>(path: string): Promise<T[]> {
  const separator = path.includes("?") ? "&" : "?";
  const perPage = 100;
  const results: T[] = [];
  for (let page = 1; ; page++) {
    const pagePath = `${path}${separator}per_page=${perPage}&page=${page}`;
    const batch = await githubFetch<T[]>(pagePath);
    results.push(...batch);
    if (batch.length < perPage) break;
  }
  return results;
}

// ─── GitHub GraphQL helper ───────────────────────────────────────────────────

interface GraphQLResponse<T> {
  data: T;
  errors?: { message: string }[];
}

async function githubGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("/api/github/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    let message = `GitHub GraphQL error (${res.status})`;
    try {
      const err = await res.json();
      if (err.message) message = err.message;
    } catch {
      // non-JSON body
    }
    throw new Error(message);
  }
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

// The GitHub search/pulls API returns paginated results. For the review-requested list
// we use the search API which is the most reliable cross-org approach.
export function useGitHubPrsAwaitingReview(
  options: { enabled?: boolean } = {},
) {
  return useQuery<GitHubPullRequest[]>({
    queryKey: ["github", "prs-awaiting-review"],
    enabled: options.enabled !== false,
    queryFn: async () => {
      const [requested, reviewed] = await Promise.all([
        githubFetch<{ items: GitHubPullRequest[] }>(
          "search/issues?q=is:open+is:pr+review-requested:@me&per_page=50",
        ),
        githubFetch<{ items: GitHubPullRequest[] }>(
          "search/issues?q=is:open+is:pr+reviewed-by:@me+-author:@me&per_page=50",
        ),
      ]);
      const seen = new Set<string>();
      const merged: GitHubPullRequest[] = [];
      for (const item of [...requested.items, ...reviewed.items]) {
        if (seen.has(item.node_id)) continue;
        seen.add(item.node_id);
        merged.push(item);
      }
      const items = merged.slice(0, 20);
      const prs = await Promise.all(
        items.map((item) => {
          const url =
            (item as unknown as { pull_request: { url: string } }).pull_request
              ?.url ?? "";
          const path = url.replace("https://api.github.com/", "");
          return path
            ? githubFetch<GitHubPullRequest>(path)
            : Promise.resolve(item as unknown as GitHubPullRequest);
        }),
      );
      return prs;
    },
    staleTime: 60_000,
  });
}

export function useGitHubPrsCreatedByMe(options: { enabled?: boolean } = {}) {
  return useQuery<GitHubPullRequest[]>({
    queryKey: ["github", "prs-created-by-me"],
    enabled: options.enabled !== false,
    queryFn: async () => {
      const data = await githubFetch<{ items: GitHubPullRequest[] }>(
        "search/issues?q=is:open+is:pr+author:@me&per_page=50",
      );
      const items = data.items.slice(0, 20);
      const prs = await Promise.all(
        items.map((item) => {
          const url =
            (item as unknown as { pull_request: { url: string } }).pull_request
              ?.url ?? "";
          const path = url.replace("https://api.github.com/", "");
          return path
            ? githubFetch<GitHubPullRequest>(path)
            : Promise.resolve(item as unknown as GitHubPullRequest);
        }),
      );
      return prs;
    },
    staleTime: 60_000,
  });
}

export function useWorkspacePr(
  owner: string | null,
  repo: string | null,
  branch: string | null,
) {
  return useQuery<GitHubPullRequest | null>({
    queryKey: ["github", "workspace-pr", owner, repo, branch],
    queryFn: async () => {
      const searchQuery = `head:${branch} repo:${owner}/${repo} is:open is:pr`;
      const data = await githubFetch<{ items: GitHubPullRequest[] }>(
        `search/issues?q=${encodeURIComponent(searchQuery)}&per_page=10`,
      );

      // Filter out results with deleted fork repos (head.repo === null)
      const validItems = data.items.filter(
        (item) =>
          (item as unknown as { pull_request: { url: string } }).pull_request
            ?.url,
      );

      if (validItems.length === 0) return null;

      // Fetch the full PR object for the first valid result
      const firstItem = validItems[0];
      const url =
        (firstItem as unknown as { pull_request: { url: string } }).pull_request
          ?.url ?? "";
      const path = url.replace("https://api.github.com/", "");

      if (!path) return null;

      const pr = await githubFetch<GitHubPullRequest>(path);

      // Guard against deleted fork repos
      if (pr.head.repo === null) return null;

      return pr;
    },
    enabled: !!(owner && repo && branch),
    staleTime: 60_000,
  });
}

export function useGitHubPr(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  return useQuery<GitHubPullRequest | null>({
    queryKey: ["github", "pr", owner, repo, prNumber],
    queryFn: async () => {
      const pr = await githubFetch<GitHubPullRequest>(
        `repos/${owner}/${repo}/pulls/${prNumber}`,
      );
      if (pr.head.repo === null) return null;
      return pr;
    },
    enabled: !!(owner && repo && prNumber),
    staleTime: 60_000,
  });
}

export function useGitHubPrFiles(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  return useQuery<GitHubPullRequestFile[]>({
    queryKey: ["github", "pr-files", owner, repo, prNumber],
    queryFn: () =>
      githubFetchAllPages<GitHubPullRequestFile>(
        `repos/${owner}/${repo}/pulls/${prNumber}/files`,
      ),
    enabled: !!(owner && repo && prNumber),
    staleTime: 30_000,
  });
}

export function useGitHubPrComments(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  return useQuery<GitHubReviewComment[]>({
    queryKey: ["github", "pr-comments", owner, repo, prNumber],
    queryFn: () =>
      githubFetchAllPages<GitHubReviewComment>(
        `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
      ),
    enabled: !!(owner && repo && prNumber),
    staleTime: 15_000,
  });
}

interface PrReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  line: number | null;
  originalLine: number | null;
  path: string;
}

interface PrReviewThreadsPage {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: Array<{
          id: string;
          isResolved: boolean;
          isOutdated: boolean;
          line: number | null;
          originalLine: number | null;
          path: string;
        }>;
      };
    };
  };
}

const PR_THREADS_QUERY = `
  query ($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            isOutdated
            line
            originalLine
            path
          }
        }
      }
    }
  }
`;

export function useGitHubPrReviewThreads(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  return useQuery<PrReviewThread[]>({
    queryKey: ["github", "pr-threads", owner, repo, prNumber],
    queryFn: async () => {
      const data = await githubGraphQL<PrReviewThreadsPage>(PR_THREADS_QUERY, {
        owner,
        repo,
        number: prNumber,
      });
      return data.repository.pullRequest.reviewThreads.nodes;
    },
    enabled: !!(owner && repo && prNumber),
    staleTime: 15_000,
  });
}

const RESOLVE_THREAD_MUTATION = `
  mutation ($threadId: ID!) {
    resolveReviewThread(input: {threadId: $threadId}) {
      thread { id isResolved }
    }
  }
`;

const UNRESOLVE_THREAD_MUTATION = `
  mutation ($threadId: ID!) {
    unresolveReviewThread(input: {threadId: $threadId}) {
      thread { id isResolved }
    }
  }
`;

export function useGitHubToggleThreadResolved(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { threadId: string; resolved: boolean }) => {
      const mutation = input.resolved
        ? RESOLVE_THREAD_MUTATION
        : UNRESOLVE_THREAD_MUTATION;
      await githubGraphQL<unknown>(mutation, {
        threadId: input.threadId,
      });
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({
        queryKey: ["github", "pr-threads", owner, repo, prNumber],
      });
      toast.success(input.resolved ? "Thread resolved" : "Thread unresolved");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useGitHubPrReviews(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  return useQuery<GitHubReview[]>({
    queryKey: ["github", "pr-reviews", owner, repo, prNumber],
    queryFn: () =>
      githubFetch<GitHubReview[]>(
        `repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`,
      ),
    enabled: !!(owner && repo && prNumber),
    staleTime: 15_000,
  });
}

export function useGitHubCurrentUser() {
  return useQuery<GitHubUser>({
    queryKey: ["github", "current-user"],
    queryFn: () => githubFetch<GitHubUser>("user"),
    staleTime: 300_000,
  });
}

export function useGitHubPrChecks(
  owner: string | null,
  repo: string | null,
  headSha: string | null,
) {
  return useQuery<GitHubCheckRun[]>({
    queryKey: ["github", "pr-checks", owner, repo, headSha],
    queryFn: async () => {
      const data = await githubFetch<{ check_runs: GitHubCheckRun[] }>(
        `repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=100`,
      );
      return data.check_runs;
    },
    enabled: !!(owner && repo && headSha),
    staleTime: 30_000,
  });
}

// Fetch file content at a specific ref, returns decoded string
async function fetchFileContentAtRef(
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string> {
  try {
    const data = await githubFetch<{ content: string; encoding: string }>(
      `repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`,
    );
    if (data.encoding === "base64") {
      const raw = data.content.replace(/\n/g, "");
      const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
      return new TextDecoder("utf-8").decode(bytes);
    }
    return data.content;
  } catch (err) {
    // File may not exist at that ref (e.g. newly added / deleted file) — return empty for 404 only
    if (err instanceof Error && err.message.includes("404")) return "";
    throw err;
  }
}

export function useGitHubPrFileContent(
  owner: string | null,
  repo: string | null,
  file: GitHubPullRequestFile | null,
  baseSha: string | null,
  headSha: string | null,
) {
  return useQuery<GitHubPrFileContent>({
    queryKey: [
      "github",
      "pr-file-content",
      owner,
      repo,
      file?.filename,
      baseSha,
      headSha,
    ],
    queryFn: async () => {
      const path = file!.filename;
      const previousPath = file!.previous_filename ?? path;

      const [original, current] = await Promise.all([
        file!.status === "added"
          ? Promise.resolve("")
          : fetchFileContentAtRef(owner!, repo!, previousPath, baseSha!),
        file!.status === "removed"
          ? Promise.resolve("")
          : fetchFileContentAtRef(owner!, repo!, path, headSha!),
      ]);

      return {
        original,
        current,
        path,
        language: getLanguageFromPath(path),
        patch: file!.patch,
      };
    },
    enabled: !!(owner && repo && file && baseSha && headSha),
    staleTime: 60_000,
  });
}

interface AddCommentInput {
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  commitId: string;
  path: string;
  line: number;
  startLine?: number;
  side?: "LEFT" | "RIGHT";
  startSide?: "LEFT" | "RIGHT";
  subjectType?: "line" | "file";
}

export function useGitHubAddComment(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AddCommentInput) => {
      const payload: Record<string, unknown> = {
        body: input.body,
        commit_id: input.commitId,
        path: input.path,
      };
      if (input.subjectType === "file") {
        payload.subject_type = "file";
      } else {
        payload.line = input.line;
        payload.side = input.side ?? "RIGHT";
        if (input.startLine !== undefined && input.startLine !== input.line) {
          payload.start_line = input.startLine;
          payload.start_side = input.startSide ?? "RIGHT";
        }
      }
      return githubFetch<GitHubReviewComment>(
        `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["github", "pr-comments", owner, repo, prNumber],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

interface ReplyToCommentInput {
  owner: string;
  repo: string;
  prNumber: number;
  commentId: number;
  body: string;
}

export function useGitHubReplyToComment(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ReplyToCommentInput) =>
      githubFetch<GitHubReviewComment>(
        `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: input.body,
            in_reply_to: input.commentId,
          }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["github", "pr-comments", owner, repo, prNumber],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

interface EditCommentInput {
  owner: string;
  repo: string;
  prNumber: number;
  commentId: number;
  body: string;
}

export function useGitHubEditComment(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: EditCommentInput) =>
      githubFetch<GitHubReviewComment>(
        `repos/${input.owner}/${input.repo}/pulls/comments/${input.commentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: input.body }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["github", "pr-comments", owner, repo, prNumber],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

interface DeleteCommentInput {
  owner: string;
  repo: string;
  commentId: number;
}

export function useGitHubDeleteComment(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: DeleteCommentInput) =>
      githubFetch<void>(
        `repos/${input.owner}/${input.repo}/pulls/comments/${input.commentId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["github", "pr-comments", owner, repo, prNumber],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

interface SubmitReviewInput {
  owner: string;
  repo: string;
  prNumber: number;
  event: GitHubReviewEvent;
  body: string;
  headSha: string | null;
  prKey: string;
}

export function useGitHubSubmitReview(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SubmitReviewInput) => {
      const drafts = useReviewDraftStore.getState().getDrafts(input.prKey);
      const inlineDrafts = drafts.filter((draft) => draft.type === "inline");
      const replyDrafts = drafts.filter((draft) => draft.type === "reply");

      if (inlineDrafts.length > 0 && !input.headSha) {
        throw new Error(
          "Cannot submit inline drafts yet because the PR head commit is unavailable. Refresh and try again.",
        );
      }

      const existingReviews = await githubFetch<GitHubReview[]>(
        `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/reviews?per_page=100`,
      );
      const existingPending = existingReviews.find(
        (r) => r.state === "PENDING",
      );
      if (existingPending) {
        await githubFetch<GitHubReview>(
          `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/reviews/${existingPending.id}`,
          { method: "DELETE" },
        );
      }

      const createPayload: Record<string, unknown> = {};
      if (input.body.trim()) {
        createPayload.body = input.body;
      }
      if (input.headSha) {
        createPayload.commit_id = input.headSha;
      }
      const prFiles = await githubFetchAllPages<GitHubPullRequestFile>(
        `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/files`,
      );
      const patchByFile = new Map<string, string | undefined>();
      for (const file of prFiles) {
        patchByFile.set(file.filename, file.patch);
      }

      const reviewComments: Record<string, unknown>[] = [];
      const fileComments: typeof inlineDrafts = [];

      for (const draft of inlineDrafts) {
        const validLines = parseDiffHunkLines(patchByFile.get(draft.path));
        if (validLines.has(draft.line)) {
          const comment: Record<string, unknown> = {
            path: draft.path,
            line: draft.line,
            side: draft.side,
            body: draft.body,
          };
          if (draft.startLine !== undefined && draft.startLine !== draft.line) {
            comment.start_line = draft.startLine;
            comment.start_side = draft.side;
          }
          reviewComments.push(comment);
        } else {
          fileComments.push(draft);
        }
      }

      if (reviewComments.length > 0) {
        createPayload.comments = reviewComments;
      }

      const pendingReview = await githubFetch<GitHubReview>(
        `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createPayload),
        },
      );

      await githubFetch<GitHubReview>(
        `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/reviews/${pendingReview.id}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: input.event }),
        },
      );

      for (const draft of fileComments) {
        await githubFetch<GitHubReviewComment>(
          `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/comments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              body: draft.body,
              commit_id: input.headSha,
              path: draft.path,
              subject_type: "file",
            }),
          },
        );
      }

      for (const draft of replyDrafts) {
        if (!draft.replyToId) continue;
        await githubFetch<GitHubReviewComment>(
          `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/comments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              body: draft.body,
              in_reply_to: draft.replyToId,
            }),
          },
        );
      }

      useReviewDraftStore.getState().clearDrafts(input.prKey);
      return pendingReview;
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({
        queryKey: ["github", "pr-reviews", owner, repo, prNumber],
      });
      queryClient.invalidateQueries({
        queryKey: ["github", "pr-comments", owner, repo, prNumber],
      });
      queryClient.invalidateQueries({
        queryKey: ["github", "pr-threads", owner, repo, prNumber],
      });
      const label =
        input.event === "APPROVE"
          ? "Approved"
          : input.event === "REQUEST_CHANGES"
            ? "Changes requested"
            : "Review submitted";
      toast.success(label);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

interface MergePrInput {
  owner: string;
  repo: string;
  prNumber: number;
  mergeMethod: GitHubMergeMethod;
  commitTitle?: string;
  commitMessage?: string;
}

export function useGitHubMergePr() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: MergePrInput) =>
      githubFetch<{ sha: string; merged: boolean; message: string }>(
        `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/merge`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merge_method: input.mergeMethod,
            commit_title: input.commitTitle,
            commit_message: input.commitMessage,
          }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["github", "prs-awaiting-review"],
      });
      queryClient.invalidateQueries({
        queryKey: ["github", "prs-created-by-me"],
      });
      toast.success("Pull request merged");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

// ─── PR file viewed state (GitHub GraphQL) ───────────────────────────────────

const PR_VIEWED_FILES_QUERY = `
  query PullRequestViewedFiles($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        files(first: 100, after: $after) {
          nodes { path, viewerViewedState }
          pageInfo { hasNextPage, endCursor }
        }
      }
    }
  }
`;

const MARK_FILE_AS_VIEWED = `
  mutation MarkFileAsViewed($input: MarkFileAsViewedInput!) {
    markFileAsViewed(input: $input) { pullRequest { id } }
  }
`;

const UNMARK_FILE_AS_VIEWED = `
  mutation UnmarkFileAsViewed($input: UnmarkFileAsViewedInput!) {
    unmarkFileAsViewed(input: $input) { pullRequest { id } }
  }
`;

interface PrViewedFilesPage {
  repository: {
    pullRequest: {
      files: {
        nodes: {
          path: string;
          viewerViewedState: "VIEWED" | "UNVIEWED" | "DISMISSED";
        }[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    };
  } | null;
}

export function useGitHubPrViewedFiles(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  return useQuery<string[]>({
    queryKey: ["github", "pr-viewed-files", owner, repo, prNumber],
    queryFn: async (): Promise<string[]> => {
      const viewed: string[] = [];
      let after: string | null = null;

      for (;;) {
        const page: PrViewedFilesPage = await githubGraphQL<PrViewedFilesPage>(
          PR_VIEWED_FILES_QUERY,
          { owner, name: repo, number: prNumber, after },
        );

        const files = page.repository?.pullRequest?.files;
        if (!files) break;

        for (const node of files.nodes) {
          if (node.viewerViewedState === "VIEWED") viewed.push(node.path);
        }

        if (!files.pageInfo.hasNextPage) break;
        after = files.pageInfo.endCursor;
      }

      return viewed;
    },
    enabled: !!(owner && repo && prNumber),
    staleTime: 30_000,
  });
}

interface ToggleFileViewedInput {
  pullRequestId: string;
  path: string;
  viewed: boolean;
}

export interface GitHubIssueComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
  updated_at: string;
}

export function useGitHubIssueComments(
  owner: string | null,
  repo: string | null,
  issueNumber: number | null,
) {
  return useQuery<GitHubIssueComment[]>({
    queryKey: ["github", "issue-comments", owner, repo, issueNumber],
    queryFn: () =>
      githubFetch<GitHubIssueComment[]>(
        `repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&sort=updated&direction=desc`,
      ),
    enabled: !!(owner && repo && issueNumber),
    staleTime: 120_000,
  });
}

interface WorkflowRun {
  id: number;
  name: string;
  conclusion: string;
  created_at: string;
}

interface WorkflowRunsResponse {
  workflow_runs: WorkflowRun[];
}

export function useGitHubWorkflowRuns(
  owner: string | null,
  repo: string | null,
  branch: string | null,
) {
  return useQuery<WorkflowRunsResponse>({
    queryKey: ["github", "workflow-runs", owner, repo, branch],
    queryFn: () =>
      githubFetch<WorkflowRunsResponse>(
        `repos/${owner}/${repo}/actions/runs?branch=${branch}&event=pull_request&per_page=5&status=completed`,
      ),
    enabled: !!(owner && repo && branch),
    staleTime: 300_000,
  });
}

interface RerunWorkflowInput {
  runId: number;
}

export function useRerunWorkflow(owner: string | null, repo: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RerunWorkflowInput) =>
      githubFetch<void>(
        `repos/${owner}/${repo}/actions/runs/${input.runId}/rerun`,
        {
          method: "POST",
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["github", "issue-comments", owner, repo],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useGitHubToggleFileViewed(
  owner: string | null,
  repo: string | null,
  prNumber: number | null,
) {
  const queryClient = useQueryClient();
  const queryKey = ["github", "pr-viewed-files", owner, repo, prNumber];

  return useMutation({
    mutationFn: async (input: ToggleFileViewedInput) => {
      const mutation = input.viewed
        ? MARK_FILE_AS_VIEWED
        : UNMARK_FILE_AS_VIEWED;
      return githubGraphQL(mutation, {
        input: { pullRequestId: input.pullRequestId, path: input.path },
      });
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<string[]>(queryKey);

      queryClient.setQueryData<string[]>(queryKey, (old = []) =>
        input.viewed
          ? [...old, input.path]
          : old.filter((p) => p !== input.path),
      );

      return { previous };
    },
    onError: (err: Error, _, context) => {
      if (context?.previous)
        queryClient.setQueryData(queryKey, context.previous);
      toast.error(`Failed to update viewed state: ${err.message}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
