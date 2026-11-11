"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type {
  BranchPullRequest,
  PullRequestCheck,
} from "@/lib/github/branch-pull-request";
import {
  CheckStateIcon,
  formatCheckDuration,
} from "@/components/git/workspace-pr/workspace-pr-presentation";
import { cn } from "@/lib/utils";

const COLLAPSED_CHECK_LIMIT = 6;

function describeCheckCounts(
  summary: BranchPullRequest["checksSummary"],
): string {
  const parts = [
    { count: summary.failureCount, label: "failing" },
    { count: summary.pendingCount, label: "pending" },
    { count: summary.successCount, label: "passing" },
    { count: summary.skippedCount, label: "skipped" },
  ]
    .filter((part) => part.count > 0)
    .map((part) => `${part.count} ${part.label}`);
  return parts.join(", ");
}

function CheckRow({ check }: { check: PullRequestCheck }) {
  const duration = check.completedAt
    ? formatCheckDuration(check.startedAt, check.completedAt)
    : null;
  const content = (
    <>
      <CheckStateIcon state={check.state} />
      <span className="min-w-0 flex-1 truncate" title={check.name}>
        {check.workflowName && (
          <span className="text-muted-foreground">{check.workflowName} · </span>
        )}
        {check.name}
      </span>
      <span className="text-muted-foreground shrink-0 tabular-nums">
        {duration ?? check.statusLabel}
      </span>
      {check.url && (
        <ExternalLink className="text-muted-foreground size-3 shrink-0" />
      )}
    </>
  );
  const rowClassName =
    "flex min-h-7 items-center gap-2 rounded-sm px-2 py-1 text-[11px]";

  if (!check.url) {
    return <li className={rowClassName}>{content}</li>;
  }
  return (
    <li>
      <a
        href={check.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(rowClassName, "hover:bg-accent/50 transition-colors")}
      >
        {content}
      </a>
    </li>
  );
}

export function WorkspacePrChecks({
  pullRequest,
}: {
  pullRequest: BranchPullRequest;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { checks, checksSummary, checksTotalCount } = pullRequest;

  if (checksSummary.total === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No checks reported for the latest commit
      </p>
    );
  }

  // Failing and pending checks sort first, so they always stay visible.
  const attentionCount = checks.filter(
    (check) => check.state === "failure" || check.state === "pending",
  ).length;
  const collapsedCount = Math.max(COLLAPSED_CHECK_LIMIT, attentionCount);
  const hiddenCount = Math.max(0, checks.length - collapsedCount);
  const visibleChecks = isExpanded ? checks : checks.slice(0, collapsedCount);

  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-center gap-1.5 text-xs">
        {checksSummary.state !== "none" && (
          <CheckStateIcon state={checksSummary.state} />
        )}
        <span>{describeCheckCounts(checksSummary)}</span>
        {checksTotalCount > checks.length && (
          <span className="text-muted-foreground">
            (showing {checks.length} of {checksTotalCount})
          </span>
        )}
      </p>
      <ul className="-mx-2 flex flex-col">
        {visibleChecks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((previous) => !previous)}
          className="text-muted-foreground hover:text-foreground self-start rounded-sm py-1 text-[11px] transition-colors"
        >
          {isExpanded ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
