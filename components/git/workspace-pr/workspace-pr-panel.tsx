"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ExternalLink, GitBranch, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePrActions } from "@/components/git/workspace-pr/workspace-pr-actions";
import { WorkspacePrChecks } from "@/components/git/workspace-pr/workspace-pr-checks";
import { WorkspacePrComments } from "@/components/git/workspace-pr/workspace-pr-comments";
import {
  formatRelativeTime,
  getPullRequestDisplayState,
  MERGE_BLOCKER_LABELS,
  MERGE_METHOD_SHORT_LABELS,
  PULL_REQUEST_STATE_PRESENTATION,
  REVIEW_DECISION_PRESENTATION,
} from "@/components/git/workspace-pr/workspace-pr-presentation";
import {
  branchPullRequestQueryKey,
  pullRequestFeedbackQueryKey,
} from "@/hooks/use-branch-pull-request";
import {
  buildCreatePullRequestUrl,
  getMergeReadiness,
  type BranchPullRequest,
  type BranchPullRequestResult,
  type RepositoryMergeSettings,
} from "@/lib/github/branch-pull-request";
import { openPullRequestInDevHub } from "@/lib/github/pr-panel-selection";
import { cn } from "@/lib/utils";

export interface WorkspacePrPanelProps {
  workspaceId: string;
  owner: string;
  repo: string;
  branch: string;
  query: UseQueryResult<BranchPullRequestResult>;
  onRequestClose: () => void;
}

const SMALL_BUTTON_CLASS = "h-7 text-xs";
const CHIP_CLASS = "h-4 px-1 text-[10px]";

function PanelSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t px-3 py-3">
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      {children}
    </section>
  );
}

function StatusChips({
  pullRequest,
  repository,
}: {
  pullRequest: BranchPullRequest;
  repository: RepositoryMergeSettings;
}) {
  const reviewDecision = pullRequest.reviewDecision
    ? REVIEW_DECISION_PRESENTATION[pullRequest.reviewDecision]
    : null;
  const readiness =
    pullRequest.state === "OPEN"
      ? getMergeReadiness(pullRequest, repository.viewerPermission)
      : null;
  const autoMerge = pullRequest.autoMerge;

  if (!reviewDecision && !readiness && !autoMerge) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {reviewDecision && (
        <Badge
          variant="outline"
          className={cn(CHIP_CLASS, reviewDecision.className)}
        >
          {reviewDecision.label}
        </Badge>
      )}
      {readiness && (
        <Badge
          variant="outline"
          title={readiness.message}
          className={cn(
            CHIP_CLASS,
            readiness.canMerge
              ? "text-green-500"
              : readiness.blocker === "conflicts"
                ? "text-red-500"
                : "text-amber-500",
          )}
        >
          {readiness.blocker
            ? MERGE_BLOCKER_LABELS[readiness.blocker]
            : "Ready to merge"}
        </Badge>
      )}
      {autoMerge && (
        <Badge
          variant="outline"
          className={CHIP_CLASS}
          title={
            autoMerge.enabledByLogin
              ? `Enabled by ${autoMerge.enabledByLogin}`
              : undefined
          }
        >
          Auto-merge: {MERGE_METHOD_SHORT_LABELS[autoMerge.mergeMethod]}
        </Badge>
      )}
    </div>
  );
}

function PullRequestSummary({
  pullRequest,
  repository,
}: {
  pullRequest: BranchPullRequest;
  repository: RepositoryMergeSettings;
}) {
  const statePresentation =
    PULL_REQUEST_STATE_PRESENTATION[getPullRequestDisplayState(pullRequest)];
  const StateIcon = statePresentation.icon;
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-1.5 text-[11px]">
        <Badge
          variant="outline"
          className={cn(CHIP_CLASS, statePresentation.badgeClassName)}
        >
          <StateIcon />
          {statePresentation.label}
        </Badge>
        <span className="text-foreground font-medium">
          #{pullRequest.number}
        </span>
        {pullRequest.authorLogin && (
          <span className="flex min-w-0 items-center gap-1">
            {pullRequest.authorAvatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- 16px remote GitHub avatar; next/image would need remotePatterns config
              <img
                src={pullRequest.authorAvatarUrl}
                alt=""
                className="size-4 shrink-0 rounded-full"
              />
            )}
            <span className="truncate">{pullRequest.authorLogin}</span>
          </span>
        )}
        <span>updated {formatRelativeTime(pullRequest.updatedAt)}</span>
      </div>
      <p className="line-clamp-3 text-sm font-medium">{pullRequest.title}</p>
      <p className="text-muted-foreground truncate font-mono text-[11px]">
        {pullRequest.headRefName} → {pullRequest.baseRefName}
      </p>
      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums">
        <span className="text-green-500">+{pullRequest.additions}</span>
        <span className="text-red-500">−{pullRequest.deletions}</span>
        <span>
          {pullRequest.changedFiles}{" "}
          {pullRequest.changedFiles === 1 ? "file" : "files"}
        </span>
        <span>
          {pullRequest.totalCommentsCount}{" "}
          {pullRequest.totalCommentsCount === 1 ? "comment" : "comments"}
        </span>
      </div>
      <StatusChips pullRequest={pullRequest} repository={repository} />
    </div>
  );
}

function NoPullRequest({
  repository,
  branch,
}: {
  repository: RepositoryMergeSettings;
  branch: string;
}) {
  if (branch === repository.defaultBranchName) {
    return (
      <p className="text-muted-foreground px-3 py-3 text-xs">
        You&apos;re on the default branch{" "}
        <code className="bg-muted rounded px-1 font-mono">{branch}</code>.
        Switch to a feature branch to see its pull request.
      </p>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2 px-3 py-3">
      <p className="text-muted-foreground text-xs">
        No pull request for{" "}
        <code className="bg-muted rounded px-1 font-mono">{branch}</code> yet.
      </p>
      <a
        href={buildCreatePullRequestUrl(repository.nameWithOwner, branch)}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonVariants({ size: "sm" }), SMALL_BUTTON_CLASS)}
      >
        <ExternalLink className="size-3.5" />
        Create pull request
      </a>
    </div>
  );
}

function PanelError({ error }: { error: Error }) {
  const isTokenProblem = /token/i.test(error.message);
  return (
    <div className="flex flex-col items-start gap-2 px-3 py-3">
      <p className="text-xs text-red-500">{error.message}</p>
      {isTokenProblem && (
        <Link
          href="/settings"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            SMALL_BUTTON_CLASS,
          )}
        >
          Open Settings
        </Link>
      )}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-3 py-3" aria-label="Loading">
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export function WorkspacePrPanel({
  workspaceId,
  owner,
  repo,
  branch,
  query,
  onRequestClose,
}: WorkspacePrPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const result = query.data;
  const pullRequest = result?.pullRequest ?? null;

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: branchPullRequestQueryKey(owner, repo, branch),
    });
    if (pullRequest) {
      void queryClient.invalidateQueries({
        queryKey: pullRequestFeedbackQueryKey(owner, repo, pullRequest.number),
      });
    }
  };

  const openInDevHub = (nameWithOwner: string, number: number) => {
    openPullRequestInDevHub({
      nameWithOwner,
      number,
      navigate: (href) => router.push(href),
    });
    onRequestClose();
  };

  return (
    <div className="flex flex-col">
      <header className="bg-background sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-baseline gap-1.5 text-xs">
            <span className="shrink-0 font-medium">Pull request</span>
            <span className="text-muted-foreground truncate">
              {owner}/{repo}
            </span>
          </div>
          <span
            className="text-muted-foreground flex min-w-0 items-center gap-1 font-mono text-[11px]"
            title={branch}
          >
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">{branch}</span>
          </span>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Refresh pull request"
          title="Refresh pull request"
          onClick={refresh}
        >
          <RefreshCw className={cn(query.isFetching && "animate-spin")} />
        </Button>
      </header>

      {result ? (
        pullRequest ? (
          <>
            <PullRequestSummary
              pullRequest={pullRequest}
              repository={result.repository}
            />
            <div className="flex flex-wrap gap-1.5 px-3 pb-3">
              <Button
                size="sm"
                variant="outline"
                className={SMALL_BUTTON_CLASS}
                onClick={() =>
                  openInDevHub(
                    result.repository.nameWithOwner,
                    pullRequest.number,
                  )
                }
              >
                Open in Dev Hub
              </Button>
              <a
                href={pullRequest.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  SMALL_BUTTON_CLASS,
                )}
              >
                <ExternalLink className="size-3.5" />
                Open on GitHub
              </a>
            </div>
            {(pullRequest.state === "OPEN" ||
              (pullRequest.state === "CLOSED" &&
                pullRequest.viewerCanReopen)) && (
              <PanelSection title="Actions">
                <WorkspacePrActions
                  owner={owner}
                  repo={repo}
                  branch={branch}
                  pullRequest={pullRequest}
                  repository={result.repository}
                />
              </PanelSection>
            )}
            <PanelSection title="Checks">
              <WorkspacePrChecks pullRequest={pullRequest} />
            </PanelSection>
            <PanelSection title="Comments">
              <WorkspacePrComments
                workspaceId={workspaceId}
                owner={owner}
                repo={repo}
                pullRequest={pullRequest}
                nameWithOwner={result.repository.nameWithOwner}
                onSentToChat={onRequestClose}
              />
            </PanelSection>
          </>
        ) : (
          <NoPullRequest repository={result.repository} branch={branch} />
        )
      ) : query.error ? (
        <PanelError error={query.error} />
      ) : (
        <PanelSkeleton />
      )}
    </div>
  );
}
