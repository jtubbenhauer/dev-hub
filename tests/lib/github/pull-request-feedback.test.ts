import { describe, expect, it } from "vitest";
import {
  formatThreadLocation,
  toPullRequestFeedback,
  type PullRequestFeedbackQueryData,
  type PullRequestReviewThread,
} from "@/lib/github/pull-request-feedback";

type PullRequestData = NonNullable<
  NonNullable<PullRequestFeedbackQueryData["repository"]>["pullRequest"]
>;
type ThreadNode = NonNullable<
  PullRequestData["reviewThreads"]["nodes"][number]
>;
type CommentNode = NonNullable<PullRequestData["comments"]["nodes"][number]>;
type ReviewNode = NonNullable<PullRequestData["reviews"]["nodes"][number]>;

function makeComment(overrides: Partial<CommentNode> = {}): CommentNode {
  return {
    id: "C_1",
    body: "Looks good",
    url: "https://github.com/acme/web/pull/7#issuecomment-1",
    createdAt: "2026-11-11T10:00:00Z",
    author: { __typename: "User", login: "alice", avatarUrl: "https://a.png" },
    ...overrides,
  };
}

function makeThread(overrides: Partial<ThreadNode> = {}): ThreadNode {
  return {
    id: "T_1",
    isResolved: false,
    isOutdated: false,
    path: "src/app.ts",
    line: 10,
    startLine: null,
    originalLine: 10,
    comments: { totalCount: 1, nodes: [makeComment()] },
    ...overrides,
  };
}

function makeReview(overrides: Partial<ReviewNode> = {}): ReviewNode {
  return {
    id: "R_1",
    body: "Please split this up",
    state: "CHANGES_REQUESTED",
    url: "https://github.com/acme/web/pull/7#pullrequestreview-1",
    submittedAt: "2026-11-11T09:00:00Z",
    createdAt: "2026-11-11T08:00:00Z",
    author: { __typename: "User", login: "bob", avatarUrl: null },
    ...overrides,
  };
}

function makeData(
  pullRequest: Partial<PullRequestData>,
): PullRequestFeedbackQueryData {
  return {
    repository: {
      pullRequest: {
        reviewThreads: { nodes: [] },
        comments: { nodes: [] },
        reviews: { nodes: [] },
        ...pullRequest,
      },
    },
  };
}

function makeThreadModel(
  overrides: Partial<PullRequestReviewThread>,
): PullRequestReviewThread {
  return {
    kind: "thread",
    id: "T_1",
    path: "src/app.ts",
    line: 10,
    startLine: null,
    originalLine: 10,
    isResolved: false,
    isOutdated: false,
    comments: [],
    totalCommentCount: 0,
    ...overrides,
  };
}

describe("toPullRequestFeedback", () => {
  it("splits threads by resolution, orders them by file and line, and drops empty ones", () => {
    const feedback = toPullRequestFeedback(
      makeData({
        reviewThreads: {
          nodes: [
            makeThread({ id: "late", path: "src/b.ts", line: 3 }),
            makeThread({ id: "done", isResolved: true }),
            makeThread({ id: "early", path: "src/a.ts", line: 40 }),
            makeThread({ id: "first", path: "src/a.ts", line: 2 }),
            makeThread({ id: "empty", comments: { totalCount: 0, nodes: [] } }),
            null,
          ],
        },
      }),
    );

    expect(feedback.unresolvedThreads.map((thread) => thread.id)).toEqual([
      "first",
      "early",
      "late",
    ]);
    expect(feedback.resolvedThreads.map((thread) => thread.id)).toEqual([
      "done",
    ]);
  });

  it("merges conversation comments with review summaries, newest first", () => {
    const feedback = toPullRequestFeedback(
      makeData({
        comments: {
          nodes: [
            makeComment({ id: "old", createdAt: "2026-11-10T00:00:00Z" }),
            makeComment({ id: "new", createdAt: "2026-11-12T00:00:00Z" }),
          ],
        },
        reviews: {
          nodes: [
            makeReview({ id: "review", submittedAt: "2026-11-11T00:00:00Z" }),
          ],
        },
      }),
    );

    expect(feedback.conversation.map((item) => [item.kind, item.id])).toEqual([
      ["comment", "new"],
      ["review", "review"],
      ["comment", "old"],
    ]);
  });

  it("leaves out pending reviews and reviews without a summary", () => {
    const feedback = toPullRequestFeedback(
      makeData({
        reviews: {
          nodes: [
            makeReview({ id: "draft", state: "PENDING" }),
            makeReview({ id: "inline-only", state: "COMMENTED", body: "  " }),
            makeReview({ id: "approval", state: "APPROVED", body: "LGTM" }),
          ],
        },
      }),
    );

    expect(feedback.conversation.map((item) => item.id)).toEqual(["approval"]);
  });

  it("marks bot authors and shows deleted accounts as ghost", () => {
    const feedback = toPullRequestFeedback(
      makeData({
        comments: {
          nodes: [
            makeComment({
              id: "bot",
              createdAt: "2026-11-12T00:00:00Z",
              author: {
                __typename: "Bot",
                login: "vercel",
                avatarUrl: "https://v.png",
              },
            }),
            makeComment({ id: "deleted", author: null }),
          ],
        },
      }),
    );

    expect(feedback.conversation.map((item) => item.author)).toEqual([
      { login: "vercel", avatarUrl: "https://v.png", isBot: true },
      { login: "ghost", avatarUrl: null, isBot: false },
    ]);
  });

  it("returns empty feedback when the pull request cannot be read", () => {
    expect(toPullRequestFeedback({ repository: null })).toEqual({
      unresolvedThreads: [],
      resolvedThreads: [],
      conversation: [],
    });
  });
});

describe("formatThreadLocation", () => {
  it.each([
    [{ line: 12, startLine: null }, "src/app.ts:12"],
    [{ line: 12, startLine: 12 }, "src/app.ts:12"],
    [{ line: 14, startLine: 10 }, "src/app.ts:10-14"],
    [{ line: null, originalLine: 8 }, "src/app.ts:8"],
    [{ line: null, originalLine: null }, "src/app.ts"],
  ])("formats %o as %s", (overrides, expected) => {
    expect(formatThreadLocation(makeThreadModel(overrides))).toBe(expected);
  });
});
