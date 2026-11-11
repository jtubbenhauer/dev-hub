"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ExternalLink, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GitHubMarkdown } from "@/components/git/github-markdown";
import {
  formatRelativeTime,
  REVIEW_STATE_CLASS,
} from "@/components/git/workspace-pr/workspace-pr-presentation";
import { usePullRequestFeedback } from "@/hooks/use-branch-pull-request";
import type { BranchPullRequest } from "@/lib/github/branch-pull-request";
import {
  formatThreadLocation,
  REVIEW_STATE_LABELS,
  type PullRequestConversationItem,
  type PullRequestFeedbackComment,
  type PullRequestReviewThread,
} from "@/lib/github/pull-request-feedback";
import {
  formatConversationItemForChat,
  formatReviewThreadForChat,
  formatReviewThreadsForChat,
} from "@/lib/github/pull-request-feedback-chat";
import { queueTextForChat } from "@/lib/terminal-chat-bridge";
import { openChatInWorkbench } from "@/lib/workbench/open-in-workbench";
import { cn } from "@/lib/utils";

export interface WorkspacePrCommentsProps {
  workspaceId: string;
  owner: string;
  repo: string;
  pullRequest: BranchPullRequest;
  nameWithOwner: string;
  onSentToChat: () => void;
}

const LONG_BODY_CHARS = 400;
const LONG_BODY_LINES = 6;
const BADGE_CLASS = "h-4 px-1 text-[10px]";

function isLongBody(body: string): boolean {
  return (
    body.length > LONG_BODY_CHARS || body.split("\n").length > LONG_BODY_LINES
  );
}

function CommentMeta({
  comment,
  children,
}: {
  comment: PullRequestFeedbackComment;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
      {comment.author.avatarUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- 16px remote GitHub avatar; next/image would need remotePatterns config
        <img
          src={comment.author.avatarUrl}
          alt=""
          className="size-4 shrink-0 rounded-full"
        />
      )}
      <span className="truncate font-medium">{comment.author.login}</span>
      {comment.author.isBot && (
        <Badge variant="outline" className={BADGE_CLASS}>
          bot
        </Badge>
      )}
      {children}
      <span className="text-muted-foreground shrink-0">
        {formatRelativeTime(comment.createdAt)}
      </span>
    </div>
  );
}

function CommentBody({ body }: { body: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isLong = isLongBody(body);
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "text-xs break-words",
          isLong && !isExpanded && "max-h-28 overflow-hidden",
        )}
      >
        {body.trim() ? (
          <GitHubMarkdown content={body} className="text-xs" />
        ) : (
          <p className="text-muted-foreground italic">No text</p>
        )}
      </div>
      {isLong && (
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((previous) => !previous)}
          className="text-muted-foreground hover:text-foreground self-start text-[11px] transition-colors"
        >
          {isExpanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function CardActions({
  url,
  onSendToChat,
}: {
  url: string;
  onSendToChat: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={onSendToChat}
      >
        <MessageSquarePlus className="size-3.5" />
        Send to chat
      </Button>
      <Button size="icon-xs" variant="ghost" asChild>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open comment on GitHub"
          title="Open comment on GitHub"
        >
          <ExternalLink />
        </a>
      </Button>
    </div>
  );
}

function ThreadCard({
  thread,
  onSendToChat,
}: {
  thread: PullRequestReviewThread;
  onSendToChat: (thread: PullRequestReviewThread) => void;
}) {
  const [isShowingReplies, setIsShowingReplies] = useState(false);
  const location = formatThreadLocation(thread);
  const shortLocation = location.split("/").pop() ?? location;
  const [firstComment, ...replies] = thread.comments;

  return (
    <li className="flex flex-col gap-1.5 rounded-md border p-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-[11px]" title={location}>
          {shortLocation}
        </span>
        {thread.isOutdated && (
          <Badge variant="outline" className={BADGE_CLASS}>
            Outdated
          </Badge>
        )}
      </div>
      <CommentMeta comment={firstComment} />
      <CommentBody body={firstComment.body} />
      {replies.length > 0 && (
        <button
          type="button"
          aria-expanded={isShowingReplies}
          onClick={() => setIsShowingReplies((previous) => !previous)}
          className="text-muted-foreground hover:text-foreground self-start text-[11px] transition-colors"
        >
          {isShowingReplies
            ? "Hide replies"
            : `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
        </button>
      )}
      {isShowingReplies && (
        <ul className="flex flex-col gap-2 border-l pl-2">
          {replies.map((reply) => (
            <li key={reply.id} className="flex flex-col gap-1">
              <CommentMeta comment={reply} />
              <CommentBody body={reply.body} />
            </li>
          ))}
        </ul>
      )}
      <CardActions
        url={firstComment.url}
        onSendToChat={() => onSendToChat(thread)}
      />
    </li>
  );
}

function ConversationCard({
  item,
  onSendToChat,
}: {
  item: PullRequestConversationItem;
  onSendToChat: (item: PullRequestConversationItem) => void;
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-md border p-2">
      <CommentMeta comment={item}>
        {item.kind === "review" && (
          <span className={cn("shrink-0", REVIEW_STATE_CLASS[item.state])}>
            {REVIEW_STATE_LABELS[item.state]}
          </span>
        )}
      </CommentMeta>
      <CommentBody body={item.body} />
      <CardActions url={item.url} onSendToChat={() => onSendToChat(item)} />
    </li>
  );
}

function SubsectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <h4 className="text-muted-foreground text-[11px] font-medium">{title}</h4>
      {action}
    </div>
  );
}

export function WorkspacePrComments({
  workspaceId,
  owner,
  repo,
  pullRequest,
  nameWithOwner,
  onSentToChat,
}: WorkspacePrCommentsProps) {
  const router = useRouter();
  const feedbackQuery = usePullRequestFeedback(
    owner,
    repo,
    pullRequest.number,
    true,
  );
  const [isShowingResolved, setIsShowingResolved] = useState(false);
  const chatContext = { number: pullRequest.number, nameWithOwner };

  const sendToChat = (text: string) => {
    queueTextForChat(workspaceId, text);
    openChatInWorkbench({
      workspaceId,
      sessionId: null,
      navigate: (href) => router.push(href),
    });
    toast.success("Added to chat");
    onSentToChat();
  };

  const feedback = feedbackQuery.data;
  if (!feedback) {
    if (feedbackQuery.error) {
      return (
        <p className="text-xs text-red-500">{feedbackQuery.error.message}</p>
      );
    }
    return (
      <div className="flex flex-col gap-2" aria-label="Loading comments">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const { unresolvedThreads, resolvedThreads, conversation } = feedback;
  if (
    unresolvedThreads.length === 0 &&
    resolvedThreads.length === 0 &&
    conversation.length === 0
  ) {
    return <p className="text-muted-foreground text-xs">No comments yet</p>;
  }

  const sendThread = (thread: PullRequestReviewThread) =>
    sendToChat(formatReviewThreadForChat(thread, chatContext));
  const sendConversationItem = (item: PullRequestConversationItem) =>
    sendToChat(formatConversationItemForChat(item, chatContext));

  return (
    <div className="flex flex-col gap-3">
      {unresolvedThreads.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <SubsectionHeader
            title={`Unresolved threads (${unresolvedThreads.length})`}
            action={
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() =>
                  sendToChat(
                    formatReviewThreadsForChat(unresolvedThreads, chatContext),
                  )
                }
              >
                <MessageSquarePlus className="size-3.5" />
                Send all to chat
              </Button>
            }
          />
          <ul className="flex flex-col gap-2">
            {unresolvedThreads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                onSendToChat={sendThread}
              />
            ))}
          </ul>
        </section>
      )}

      {conversation.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <SubsectionHeader title={`Conversation (${conversation.length})`} />
          <ul className="flex flex-col gap-2">
            {conversation.map((item) => (
              <ConversationCard
                key={item.id}
                item={item}
                onSendToChat={sendConversationItem}
              />
            ))}
          </ul>
        </section>
      )}

      {resolvedThreads.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <button
            type="button"
            aria-expanded={isShowingResolved}
            onClick={() => setIsShowingResolved((previous) => !previous)}
            className="text-muted-foreground hover:text-foreground flex min-h-7 items-center gap-1 self-start text-[11px] font-medium transition-colors"
          >
            <ChevronRight
              className={cn(
                "size-3 transition-transform",
                isShowingResolved && "rotate-90",
              )}
            />
            Resolved threads ({resolvedThreads.length})
          </button>
          {isShowingResolved && (
            <ul className="flex flex-col gap-2">
              {resolvedThreads.map((thread) => (
                <ThreadCard
                  key={thread.id}
                  thread={thread}
                  onSendToChat={sendThread}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
