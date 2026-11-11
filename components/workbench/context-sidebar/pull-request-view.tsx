import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePrPanel } from "@/components/git/workspace-pr/workspace-pr-panel";
import type { ContextSidebarViewProps } from "@/components/workbench/context-sidebar/context-sidebar-views";
import {
  useWorkspacePullRequest,
  type WorkspacePullRequestLookup,
} from "@/hooks/use-branch-pull-request";
import { useContextSidebarStore } from "@/stores/context-sidebar-store";

const LOOKUP_MESSAGES: Record<
  Exclude<WorkspacePullRequestLookup, "loading" | "ready">,
  string
> = {
  unavailable: "Can't read this workspace's git status right now.",
  "not-a-repository": "This workspace is not a git repository.",
  "no-github-remote":
    "This workspace has no GitHub remote, so there is no pull request to show.",
  "detached-head": "Check out a branch to see its pull request.",
};

// On phones the sheet covers the chat, so it gets out of the way once a
// comment is sent there or the PR opens on the PRs page.
function closeMobilePanels(): void {
  useContextSidebarStore.getState().setMobileSheetOpen(false);
}

export function PullRequestView({ workspaceId }: ContextSidebarViewProps) {
  const { owner, repo, branch, lookup, query } =
    useWorkspacePullRequest(workspaceId);

  let content;
  if (lookup === "ready" && owner && repo && branch) {
    content = (
      <WorkspacePrPanel
        workspaceId={workspaceId}
        owner={owner}
        repo={repo}
        branch={branch}
        query={query}
        onRequestClose={closeMobilePanels}
      />
    );
  } else if (lookup === "loading" || lookup === "ready") {
    content = (
      <div
        className="flex flex-col gap-2 px-3 py-3"
        aria-label="Loading pull request"
      >
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  } else {
    content = (
      <p className="text-muted-foreground px-3 py-3 text-xs">
        {LOOKUP_MESSAGES[lookup]}
      </p>
    );
  }

  return (
    <div role="region" aria-label="Pull request">
      {content}
    </div>
  );
}
