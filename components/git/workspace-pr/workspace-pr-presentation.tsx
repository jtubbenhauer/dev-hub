import {
  CheckCircle2,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Loader2,
  MinusCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type {
  BranchPullRequest,
  MergeBlocker,
  PullRequestCheckState,
  PullRequestChecksSummary,
  PullRequestMergeMethod,
  PullRequestReviewDecision,
} from "@/lib/github/branch-pull-request";
import type { PullRequestReviewState } from "@/lib/github/pull-request-feedback";
import type {
  WorkspacePullRequest,
  WorkspacePullRequestLookup,
} from "@/hooks/use-branch-pull-request";
import { cn } from "@/lib/utils";

export type PullRequestDisplayState = "open" | "draft" | "merged" | "closed";

export function getPullRequestDisplayState(
  pullRequest: Pick<BranchPullRequest, "state" | "isDraft">,
): PullRequestDisplayState {
  switch (pullRequest.state) {
    case "MERGED":
      return "merged";
    case "CLOSED":
      return "closed";
    case "OPEN":
      return pullRequest.isDraft ? "draft" : "open";
  }
}

interface DisplayStatePresentation {
  label: string;
  icon: LucideIcon;
  iconClassName: string;
  badgeClassName: string;
}

export const PULL_REQUEST_STATE_PRESENTATION: Record<
  PullRequestDisplayState,
  DisplayStatePresentation
> = {
  open: {
    label: "Open",
    icon: GitPullRequest,
    iconClassName: "text-green-500",
    badgeClassName: "border-green-500/40 bg-green-500/10 text-green-500",
  },
  draft: {
    label: "Draft",
    icon: GitPullRequestDraft,
    iconClassName: "text-muted-foreground",
    badgeClassName: "bg-muted text-muted-foreground",
  },
  merged: {
    label: "Merged",
    icon: GitMerge,
    iconClassName: "text-purple-500",
    badgeClassName: "border-purple-500/40 bg-purple-500/10 text-purple-500",
  },
  closed: {
    label: "Closed",
    icon: GitPullRequestClosed,
    iconClassName: "text-red-500",
    badgeClassName: "border-red-500/40 bg-red-500/10 text-red-500",
  },
};

export const CHECKS_DOT_CLASS: Record<
  PullRequestChecksSummary["state"],
  string | null
> = {
  failure: "bg-red-500",
  pending: "animate-pulse bg-amber-500",
  success: "bg-green-500",
  neutral: null,
  skipped: null,
  none: null,
};

export const CHECKS_STATUS_PHRASE: Record<
  PullRequestChecksSummary["state"],
  string | null
> = {
  failure: "checks failing",
  pending: "checks running",
  success: "checks passing",
  neutral: null,
  skipped: null,
  none: null,
};

const CHECK_STATE_ICONS: Record<
  PullRequestCheckState,
  { icon: LucideIcon; className: string; label: string }
> = {
  failure: { icon: XCircle, className: "text-red-500", label: "Failing" },
  pending: {
    icon: Loader2,
    className: "animate-spin text-amber-500",
    label: "Pending",
  },
  success: { icon: CheckCircle2, className: "text-green-500", label: "Passed" },
  skipped: {
    icon: MinusCircle,
    className: "text-muted-foreground",
    label: "Skipped",
  },
  neutral: {
    icon: MinusCircle,
    className: "text-muted-foreground",
    label: "Neutral",
  },
};

export function CheckStateIcon({
  state,
  className,
}: {
  state: PullRequestCheckState;
  className?: string;
}) {
  const presentation = CHECK_STATE_ICONS[state];
  const Icon = presentation.icon;
  return (
    <Icon
      aria-label={presentation.label}
      className={cn("size-3.5 shrink-0", presentation.className, className)}
    />
  );
}

export const REVIEW_DECISION_PRESENTATION: Record<
  PullRequestReviewDecision,
  { label: string; className: string }
> = {
  APPROVED: { label: "Approved", className: "text-green-500" },
  CHANGES_REQUESTED: { label: "Changes requested", className: "text-red-500" },
  REVIEW_REQUIRED: { label: "Review required", className: "text-amber-500" },
};

export const REVIEW_STATE_CLASS: Record<PullRequestReviewState, string> = {
  APPROVED: "text-green-500",
  CHANGES_REQUESTED: "text-red-500",
  COMMENTED: "text-muted-foreground",
  DISMISSED: "text-muted-foreground",
  PENDING: "text-muted-foreground",
};

export const MERGE_BLOCKER_LABELS: Record<MergeBlocker, string> = {
  "not-open": "Not open",
  "no-permission": "No write access",
  draft: "Draft",
  conflicts: "Conflicts",
  behind: "Behind base",
  blocked: "Blocked",
  checking: "Checking mergeability",
};

export const MERGE_METHOD_SHORT_LABELS: Record<PullRequestMergeMethod, string> =
  {
    SQUASH: "Squash",
    MERGE: "Merge",
    REBASE: "Rebase",
  };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatRelativeTime(
  isoTimestamp: string,
  nowMs: number = Date.now(),
): string {
  const elapsedMs = Math.max(0, nowMs - new Date(isoTimestamp).getTime());
  if (elapsedMs < MINUTE_MS) return "just now";
  if (elapsedMs < HOUR_MS) return `${Math.floor(elapsedMs / MINUTE_MS)}m ago`;
  if (elapsedMs < DAY_MS) return `${Math.floor(elapsedMs / HOUR_MS)}h ago`;
  const days = Math.floor(elapsedMs / DAY_MS);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function formatCheckDuration(
  startedAt: string | null,
  completedAt: string | null,
): string | null {
  if (!startedAt || !completedAt) return null;
  const totalSeconds = Math.max(
    0,
    Math.round(
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    ),
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export interface PullRequestTabAppearance {
  icon: LucideIcon;
  // null keeps the tab's own muted colour.
  iconClassName: string | null;
  dotClassName: string | null;
  statusText: string;
}

const LOOKUP_STATUS_TEXT: Record<
  Exclude<WorkspacePullRequestLookup, "ready">,
  string
> = {
  loading: "Pull request",
  unavailable: "Pull request status unavailable",
  "not-a-repository": "Not a git repository",
  "no-github-remote": "No GitHub remote",
  "detached-head": "No branch checked out",
};

function plainTabAppearance(statusText: string): PullRequestTabAppearance {
  return {
    icon: GitPullRequest,
    iconClassName: null,
    dotClassName: null,
    statusText,
  };
}

// The right sidebar's PR tab shows the linked PR's state and its checks.
export function getPullRequestTabAppearance({
  lookup,
  branch,
  query,
}: Pick<
  WorkspacePullRequest,
  "lookup" | "branch" | "query"
>): PullRequestTabAppearance {
  if (lookup !== "ready") return plainTabAppearance(LOOKUP_STATUS_TEXT[lookup]);
  const result = query.data;
  if (!result) {
    return plainTabAppearance(
      query.isError
        ? "Pull request status unavailable"
        : "Pull request status loading",
    );
  }
  const pullRequest = result.pullRequest;
  if (!pullRequest) return plainTabAppearance(`No pull request for ${branch}`);

  const presentation =
    PULL_REQUEST_STATE_PRESENTATION[getPullRequestDisplayState(pullRequest)];
  const checksPhrase = CHECKS_STATUS_PHRASE[pullRequest.checksSummary.state];
  const stateText = `Pull request #${pullRequest.number}: ${presentation.label}`;
  return {
    icon: presentation.icon,
    iconClassName: presentation.iconClassName,
    dotClassName: CHECKS_DOT_CLASS[pullRequest.checksSummary.state],
    statusText: checksPhrase ? `${stateText}, ${checksPhrase}` : stateText,
  };
}
