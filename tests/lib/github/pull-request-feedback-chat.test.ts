import { describe, expect, it } from "vitest";
import {
  formatConversationItemForChat,
  formatReviewThreadForChat,
  formatReviewThreadsForChat,
  MAX_CHAT_COMMENT_BODY_CHARS,
} from "@/lib/github/pull-request-feedback-chat";
import type {
  PullRequestConversationItem,
  PullRequestFeedbackComment,
  PullRequestReviewThread,
} from "@/lib/github/pull-request-feedback";

const context = { number: 7, nameWithOwner: "acme/web" };

function makeComment(
  overrides: Partial<PullRequestFeedbackComment> = {},
): PullRequestFeedbackComment {
  return {
    id: "C_1",
    author: { login: "alice", avatarUrl: null, isBot: false },
    body: "Rename this variable",
    url: "https://github.com/acme/web/pull/7#discussion_r1",
    createdAt: "2026-11-11T10:00:00Z",
    ...overrides,
  };
}

function makeThread(
  overrides: Partial<PullRequestReviewThread> = {},
): PullRequestReviewThread {
  return {
    kind: "thread",
    id: "T_1",
    path: "src/app.ts",
    line: 42,
    startLine: 40,
    originalLine: 42,
    isResolved: false,
    isOutdated: false,
    comments: [makeComment()],
    totalCommentCount: 1,
    ...overrides,
  };
}

describe("formatReviewThreadForChat", () => {
  it("names the pull request and file location, quotes each comment and links the thread", () => {
    const text = formatReviewThreadForChat(
      makeThread({
        comments: [
          makeComment({ body: "Rename this variable\nIt shadows `id`." }),
          makeComment({
            id: "C_2",
            author: { login: "bob", avatarUrl: null, isBot: false },
            body: "Agreed",
            url: "https://github.com/acme/web/pull/7#discussion_r2",
          }),
        ],
        totalCommentCount: 2,
      }),
      context,
    );

    expect(text).toContain("PR #7 (acme/web)");
    expect(text).toContain("`src/app.ts:40-42`");
    expect(text).toContain(
      "> **alice:** Rename this variable\n> It shadows `id`.\n>\n> **bob:** Agreed",
    );
    expect(
      text.endsWith("https://github.com/acme/web/pull/7#discussion_r1"),
    ).toBe(true);
  });

  it("says when a thread is resolved or outdated and when replies were cut off", () => {
    const text = formatReviewThreadForChat(
      makeThread({
        isResolved: true,
        isOutdated: true,
        line: null,
        totalCommentCount: 53,
      }),
      context,
    );

    expect(text).toContain("`src/app.ts:42` (resolved, outdated)");
    expect(text).toContain("[52 more replies on GitHub]");
  });

  it("drops hidden HTML comments and truncates very long bodies", () => {
    const longBody = `<!-- bot-metadata -->${"x".repeat(MAX_CHAT_COMMENT_BODY_CHARS + 50)}`;
    const text = formatReviewThreadForChat(
      makeThread({ comments: [makeComment({ body: longBody })] }),
      context,
    );

    expect(text).not.toContain("bot-metadata");
    expect(text).toContain("[... comment truncated ...]");
    expect(text).not.toContain("x".repeat(MAX_CHAT_COMMENT_BODY_CHARS + 1));
  });
});

describe("formatReviewThreadsForChat", () => {
  it("numbers every thread under one heading", () => {
    const text = formatReviewThreadsForChat(
      [
        makeThread({ id: "T_1", path: "src/a.ts", line: 1, startLine: null }),
        makeThread({ id: "T_2", path: "src/b.ts", line: 9, startLine: null }),
      ],
      context,
    );

    expect(text.startsWith("2 review threads on PR #7 (acme/web):")).toBe(true);
    expect(text).toContain("1. `src/a.ts:1`");
    expect(text).toContain("2. `src/b.ts:9`");
  });
});

describe("formatConversationItemForChat", () => {
  it("quotes a conversation comment with its author and link", () => {
    const item: PullRequestConversationItem = {
      kind: "comment",
      ...makeComment({
        body: "Can we add a test?",
        url: "https://github.com/acme/web/pull/7#issuecomment-9",
      }),
    };

    const text = formatConversationItemForChat(item, context);

    expect(text).toContain("PR #7 (acme/web)");
    expect(text).toContain("> **alice:** Can we add a test?");
    expect(
      text.endsWith("https://github.com/acme/web/pull/7#issuecomment-9"),
    ).toBe(true);
  });

  it("includes what a review decided", () => {
    const item: PullRequestConversationItem = {
      kind: "review",
      state: "CHANGES_REQUESTED",
      ...makeComment({ body: "Split this PR" }),
    };

    expect(formatConversationItemForChat(item, context)).toContain(
      "alice requested changes",
    );
  });
});
