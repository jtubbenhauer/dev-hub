"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import type {
  GitHubPullRequest,
  GitHubPullRequestFile,
  GitHubReviewComment,
  GitHubReview,
  GitHubReviewEvent,
  GitHubPrFileContent,
  GitHubUser,
} from "@/types"

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
}

function getLanguageFromPath(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".")
  if (lastDot === -1) return "plaintext"
  const ext = filePath.slice(lastDot).toLowerCase()
  return EXTENSION_LANGUAGE_MAP[ext] ?? "plaintext"
}

async function githubFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/github/${path}`, options)
  if (!res.ok) {
    let message = `GitHub API error (${res.status})`
    try {
      const err = await res.json()
      if (err.message) message = err.message
      else if (err.error) message = err.error
    } catch {
      // non-JSON body
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

// The GitHub search/pulls API returns paginated results. For the review-requested list
// we use the search API which is the most reliable cross-org approach.
export function useGitHubPrsAwaitingReview() {
  return useQuery<GitHubPullRequest[]>({
    queryKey: ["github", "prs-awaiting-review"],
    queryFn: async () => {
      const data = await githubFetch<{ items: GitHubPullRequest[] }>(
        "search/issues?q=is:open+is:pr+review-requested:@me&per_page=50"
      )
      // The search API returns issue objects; we need to fetch the full PR for each
      // to get head/base sha etc. We do this in parallel but cap at 20 to avoid rate limits.
      const items = data.items.slice(0, 20)
      const prs = await Promise.all(
        items.map((item) => {
          // item.pull_request.url is the full PR API URL, e.g.
          // https://api.github.com/repos/owner/repo/pulls/123
          // We strip the base to get the path for our proxy.
          const url = (item as unknown as { pull_request: { url: string } }).pull_request?.url ?? ""
          const path = url.replace("https://api.github.com/", "")
          return path ? githubFetch<GitHubPullRequest>(path) : Promise.resolve(item as unknown as GitHubPullRequest)
        })
      )
      return prs
    },
    staleTime: 60_000,
  })
}

export function useGitHubPrFiles(owner: string | null, repo: string | null, prNumber: number | null) {
  return useQuery<GitHubPullRequestFile[]>({
    queryKey: ["github", "pr-files", owner, repo, prNumber],
    queryFn: () =>
      githubFetch<GitHubPullRequestFile[]>(
        `repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`
      ),
    enabled: !!(owner && repo && prNumber),
    staleTime: 30_000,
  })
}

export function useGitHubPrComments(owner: string | null, repo: string | null, prNumber: number | null) {
  return useQuery<GitHubReviewComment[]>({
    queryKey: ["github", "pr-comments", owner, repo, prNumber],
    queryFn: () =>
      githubFetch<GitHubReviewComment[]>(
        `repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`
      ),
    enabled: !!(owner && repo && prNumber),
    staleTime: 15_000,
  })
}

export function useGitHubPrReviews(owner: string | null, repo: string | null, prNumber: number | null) {
  return useQuery<GitHubReview[]>({
    queryKey: ["github", "pr-reviews", owner, repo, prNumber],
    queryFn: () =>
      githubFetch<GitHubReview[]>(
        `repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=100`
      ),
    enabled: !!(owner && repo && prNumber),
    staleTime: 15_000,
  })
}

export function useGitHubCurrentUser() {
  return useQuery<GitHubUser>({
    queryKey: ["github", "current-user"],
    queryFn: () => githubFetch<GitHubUser>("user"),
    staleTime: 300_000,
  })
}

// Fetch file content at a specific ref, returns decoded string
async function fetchFileContentAtRef(
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string> {
  try {
    const data = await githubFetch<{ content: string; encoding: string }>(
      `repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`
    )
    if (data.encoding === "base64") {
      // atob works in browser; in Node edge runtime use Buffer
      try {
        return atob(data.content.replace(/\n/g, ""))
      } catch {
        return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8")
      }
    }
    return data.content
  } catch (err) {
    // File may not exist at that ref (e.g. newly added / deleted file) — return empty for 404 only
    if (err instanceof Error && err.message.includes("404")) return ""
    throw err
  }
}

export function useGitHubPrFileContent(
  owner: string | null,
  repo: string | null,
  file: GitHubPullRequestFile | null,
  baseSha: string | null,
  headSha: string | null
) {
  return useQuery<GitHubPrFileContent>({
    queryKey: ["github", "pr-file-content", owner, repo, file?.filename, baseSha, headSha],
    queryFn: async () => {
      const path = file!.filename
      const previousPath = file!.previous_filename ?? path

      const [original, current] = await Promise.all([
        file!.status === "added"
          ? Promise.resolve("")
          : fetchFileContentAtRef(owner!, repo!, previousPath, baseSha!),
        file!.status === "removed"
          ? Promise.resolve("")
          : fetchFileContentAtRef(owner!, repo!, path, headSha!),
      ])

      return {
        original,
        current,
        path,
        language: getLanguageFromPath(path),
        patch: file!.patch,
      }
    },
    enabled: !!(owner && repo && file && baseSha && headSha),
    staleTime: 60_000,
  })
}

interface AddCommentInput {
  owner: string
  repo: string
  prNumber: number
  body: string
  commitId: string
  path: string
  line: number
  startLine?: number
  side?: "LEFT" | "RIGHT"
  startSide?: "LEFT" | "RIGHT"
}

export function useGitHubAddComment(owner: string | null, repo: string | null, prNumber: number | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: AddCommentInput) => {
      const payload: Record<string, unknown> = {
        body: input.body,
        commit_id: input.commitId,
        path: input.path,
        line: input.line,
        side: input.side ?? "RIGHT",
      }
      if (input.startLine !== undefined && input.startLine !== input.line) {
        payload.start_line = input.startLine
        payload.start_side = input.startSide ?? "RIGHT"
      }
      return githubFetch<GitHubReviewComment>(
        `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["github", "pr-comments", owner, repo, prNumber],
      })
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}

interface ReplyToCommentInput {
  owner: string
  repo: string
  prNumber: number
  commentId: number
  body: string
}

export function useGitHubReplyToComment(owner: string | null, repo: string | null, prNumber: number | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: ReplyToCommentInput) =>
      githubFetch<GitHubReviewComment>(
        `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: input.body, in_reply_to: input.commentId }),
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["github", "pr-comments", owner, repo, prNumber],
      })
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}

interface SubmitReviewInput {
  owner: string
  repo: string
  prNumber: number
  event: GitHubReviewEvent
  body: string
}

export function useGitHubSubmitReview(owner: string | null, repo: string | null, prNumber: number | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: SubmitReviewInput) =>
      githubFetch<GitHubReview>(
        `repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: input.event, body: input.body }),
        }
      ),
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({
        queryKey: ["github", "pr-reviews", owner, repo, prNumber],
      })
      const label =
        input.event === "APPROVE"
          ? "Approved"
          : input.event === "REQUEST_CHANGES"
            ? "Changes requested"
            : "Review submitted"
      toast.success(label)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}
