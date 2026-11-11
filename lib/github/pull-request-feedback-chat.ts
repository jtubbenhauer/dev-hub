import {
  formatThreadLocation,
  REVIEW_STATE_LABELS,
  type PullRequestConversationItem,
  type PullRequestFeedbackComment,
  type PullRequestReviewThread,
} from "@/lib/github/pull-request-feedback";

// Text the sidebar PR panel drops into the chat composer, so the agent sees
// where each comment points and who wrote it. The user adds the instruction.

export interface PullRequestChatContext {
  number: number;
  nameWithOwner: string;
}

export const MAX_CHAT_COMMENT_BODY_CHARS = 4_000;

function cleanBody(body: string): string {
  const withoutHtmlComments = body.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (withoutHtmlComments.length <= MAX_CHAT_COMMENT_BODY_CHARS) {
    return withoutHtmlComments;
  }
  return `${withoutHtmlComments.slice(0, MAX_CHAT_COMMENT_BODY_CHARS).trimEnd()}\n[... comment truncated ...]`;
}

function quoteComment(comment: PullRequestFeedbackComment): string {
  const lines = (cleanBody(comment.body) || "(no text)").split("\n");
  const [firstLine, ...restLines] = lines;
  return [
    `> **${comment.author.login}:** ${firstLine}`,
    ...restLines.map((line) => (line ? `> ${line}` : ">")),
  ].join("\n");
}

function prLabel(context: PullRequestChatContext): string {
  return `PR #${context.number} (${context.nameWithOwner})`;
}

function threadBlock(thread: PullRequestReviewThread): string {
  const states = [
    thread.isResolved ? "resolved" : null,
    thread.isOutdated ? "outdated" : null,
  ].filter((state): state is string => state !== null);
  const stateSuffix = states.length > 0 ? ` (${states.join(", ")})` : "";
  const hiddenReplies = thread.totalCommentCount - thread.comments.length;
  const quotedComments = thread.comments.map(quoteComment).join("\n>\n");
  return [
    `\`${formatThreadLocation(thread)}\`${stateSuffix}`,
    "",
    hiddenReplies > 0
      ? `${quotedComments}\n>\n> [${hiddenReplies} more replies on GitHub]`
      : quotedComments,
    "",
    thread.comments[0].url,
  ].join("\n");
}

export function formatReviewThreadForChat(
  thread: PullRequestReviewThread,
  context: PullRequestChatContext,
): string {
  return `Review thread on ${prLabel(context)} at ${threadBlock(thread)}`;
}

export function formatReviewThreadsForChat(
  threads: readonly PullRequestReviewThread[],
  context: PullRequestChatContext,
): string {
  const blocks = threads.map(
    (thread, index) => `${index + 1}. ${threadBlock(thread)}`,
  );
  const noun = threads.length === 1 ? "thread" : "threads";
  return [
    `${threads.length} review ${noun} on ${prLabel(context)}:`,
    ...blocks,
  ].join("\n\n");
}

export function formatConversationItemForChat(
  item: PullRequestConversationItem,
  context: PullRequestChatContext,
): string {
  const heading =
    item.kind === "review"
      ? `Review on ${prLabel(context)}, ${item.author.login} ${REVIEW_STATE_LABELS[item.state]}:`
      : `Comment on ${prLabel(context)}:`;
  return [heading, "", quoteComment(item), "", item.url].join("\n");
}
