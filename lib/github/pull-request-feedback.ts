// Review threads, conversation comments and review summaries for one pull
// request, fetched in a single GraphQL query for the sidebar PR panel.

export interface PullRequestFeedbackAuthor {
  login: string;
  avatarUrl: string | null;
  isBot: boolean;
}

export interface PullRequestFeedbackComment {
  id: string;
  author: PullRequestFeedbackAuthor;
  body: string;
  url: string;
  createdAt: string;
}

export interface PullRequestReviewThread {
  kind: "thread";
  id: string;
  path: string;
  // null when the thread is outdated (its code changed since the comment).
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  comments: PullRequestFeedbackComment[];
  // Threads longer than 50 comments are cut off; this is the real total.
  totalCommentCount: number;
}

export interface PullRequestConversationComment extends PullRequestFeedbackComment {
  kind: "comment";
}

export type PullRequestReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "PENDING";

export interface PullRequestReviewSummary extends PullRequestFeedbackComment {
  kind: "review";
  state: PullRequestReviewState;
}

export type PullRequestConversationItem =
  | PullRequestConversationComment
  | PullRequestReviewSummary;

export interface PullRequestFeedback {
  unresolvedThreads: PullRequestReviewThread[];
  resolvedThreads: PullRequestReviewThread[];
  // Newest first.
  conversation: PullRequestConversationItem[];
}

export const PULL_REQUEST_FEEDBACK_QUERY = `
  query PullRequestFeedback($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            startLine
            originalLine
            comments(first: 50) {
              totalCount
              nodes {
                id
                body
                url
                createdAt
                author { __typename login avatarUrl }
              }
            }
          }
        }
        comments(last: 100) {
          nodes {
            id
            body
            url
            createdAt
            author { __typename login avatarUrl }
          }
        }
        reviews(last: 100) {
          nodes {
            id
            body
            state
            url
            submittedAt
            createdAt
            author { __typename login avatarUrl }
          }
        }
      }
    }
  }
`;

interface AuthorNode {
  __typename: string;
  login: string;
  avatarUrl: string | null;
}

interface CommentNode {
  id: string;
  body: string;
  url: string;
  createdAt: string;
  author: AuthorNode | null;
}

interface ReviewThreadNode {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  comments: { totalCount: number; nodes: Array<CommentNode | null> };
}

interface ReviewNode {
  id: string;
  body: string;
  state: PullRequestReviewState;
  url: string;
  submittedAt: string | null;
  createdAt: string;
  author: AuthorNode | null;
}

export interface PullRequestFeedbackQueryData {
  repository: {
    pullRequest: {
      reviewThreads: { nodes: Array<ReviewThreadNode | null> };
      comments: { nodes: Array<CommentNode | null> };
      reviews: { nodes: Array<ReviewNode | null> };
    } | null;
  } | null;
}

// GitHub shows deleted accounts as "ghost".
function toAuthor(author: AuthorNode | null): PullRequestFeedbackAuthor {
  if (!author) return { login: "ghost", avatarUrl: null, isBot: false };
  return {
    login: author.login,
    avatarUrl: author.avatarUrl,
    isBot: author.__typename === "Bot",
  };
}

function toComment(node: CommentNode): PullRequestFeedbackComment {
  return {
    id: node.id,
    author: toAuthor(node.author),
    body: node.body,
    url: node.url,
    createdAt: node.createdAt,
  };
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function compareThreadsByLocation(
  a: PullRequestReviewThread,
  b: PullRequestReviewThread,
): number {
  const lineA = a.line ?? a.originalLine ?? 0;
  const lineB = b.line ?? b.originalLine ?? 0;
  return a.path.localeCompare(b.path) || lineA - lineB;
}

export function toPullRequestFeedback(
  data: PullRequestFeedbackQueryData,
): PullRequestFeedback {
  const pullRequest = data.repository?.pullRequest;
  if (!pullRequest) {
    return { unresolvedThreads: [], resolvedThreads: [], conversation: [] };
  }

  const threads: PullRequestReviewThread[] = pullRequest.reviewThreads.nodes
    .filter(isPresent)
    .map((node) => ({
      kind: "thread" as const,
      id: node.id,
      path: node.path,
      line: node.line,
      startLine: node.startLine,
      originalLine: node.originalLine,
      isResolved: node.isResolved,
      isOutdated: node.isOutdated,
      comments: node.comments.nodes.filter(isPresent).map(toComment),
      totalCommentCount: node.comments.totalCount,
    }))
    .filter((thread) => thread.comments.length > 0)
    .sort(compareThreadsByLocation);

  const conversationComments: PullRequestConversationItem[] =
    pullRequest.comments.nodes.filter(isPresent).map((node) => ({
      kind: "comment" as const,
      ...toComment(node),
    }));

  // Reviews without a body only carry inline comments, which the threads
  // already show; pending reviews are the viewer's unsubmitted drafts.
  const reviewSummaries: PullRequestConversationItem[] =
    pullRequest.reviews.nodes
      .filter(isPresent)
      .filter((node) => node.state !== "PENDING" && node.body.trim() !== "")
      .map((node) => ({
        kind: "review" as const,
        id: node.id,
        author: toAuthor(node.author),
        body: node.body,
        url: node.url,
        createdAt: node.submittedAt ?? node.createdAt,
        state: node.state,
      }));

  const conversation = [...conversationComments, ...reviewSummaries].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );

  return {
    unresolvedThreads: threads.filter((thread) => !thread.isResolved),
    resolvedThreads: threads.filter((thread) => thread.isResolved),
    conversation,
  };
}

export function formatThreadLocation(thread: PullRequestReviewThread): string {
  if (thread.line === null) {
    return thread.originalLine === null
      ? thread.path
      : `${thread.path}:${thread.originalLine}`;
  }
  if (thread.startLine !== null && thread.startLine !== thread.line) {
    return `${thread.path}:${thread.startLine}-${thread.line}`;
  }
  return `${thread.path}:${thread.line}`;
}

export const REVIEW_STATE_LABELS: Record<PullRequestReviewState, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed review",
  PENDING: "pending review",
};
