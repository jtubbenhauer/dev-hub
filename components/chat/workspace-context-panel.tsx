"use client";

import { memo, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GitPullRequest,
  CheckSquare,
  Globe,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFirebasePreview } from "@/hooks/use-firebase-preview";
import { useGitHubWorkflowRuns, useRerunWorkflow } from "@/hooks/use-github";
import { cn } from "@/lib/utils";
import type { Workspace, LinkedTaskMeta } from "@/types";

interface WorkspaceContextPanelProps {
  workspaceId: string;
  workspace: Workspace;
}

interface PreviewRowProps {
  preview: import("@/lib/firebase-preview").FirebasePreview;
  owner: string | null;
  repo: string | null;
  branch: string | null;
}

function PreviewRow({ preview, owner, repo, branch }: PreviewRowProps) {
  const { data: workflowData } = useGitHubWorkflowRuns(owner, repo, branch);
  const rerunMutation = useRerunWorkflow(owner, repo);
  const [isDeploying, setIsDeploying] = useState(false);

  const handleRerun = () => {
    const runs = workflowData?.workflow_runs;
    if (!runs || runs.length === 0) return;
    rerunMutation.mutate(
      { runId: runs[0].id },
      {
        onSuccess: () => {
          setIsDeploying(true);
          toast.success("Deployment re-triggered");
        },
      },
    );
  };

  return (
    <Tooltip delayDuration={500} disableHoverableContent>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 text-xs">
          <Globe className="text-muted-foreground size-3.5 shrink-0" />
          <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground min-w-0 flex-1 truncate hover:underline"
            title={preview.url}
          >
            {preview.url}
          </a>
          {isDeploying ? (
            <Badge
              variant="outline"
              className="shrink-0 animate-pulse px-1 py-0 text-[10px] text-orange-500"
            >
              Deploying…
            </Badge>
          ) : preview.isExpired ? (
            <>
              <Badge
                variant="outline"
                className="text-muted-foreground shrink-0 px-1 py-0 text-[10px] line-through"
              >
                Expired
              </Badge>
              {owner && repo && branch && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  title="Re-run deployment"
                  onClick={handleRerun}
                  disabled={rerunMutation.isPending}
                >
                  <RefreshCw
                    className={cn(
                      "size-3",
                      rerunMutation.isPending && "animate-spin",
                    )}
                  />
                </button>
              )}
            </>
          ) : (
            <span className="text-muted-foreground shrink-0">
              {formatRelativeTime(preview.deployedAt)}
            </span>
          )}
          <Badge
            variant="outline"
            className="shrink-0 px-1 py-0 font-mono text-[10px]"
          >
            {preview.commitSha.substring(0, 7)}
          </Badge>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left">Firebase preview</TooltipContent>
    </Tooltip>
  );
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

export const WorkspaceContextPanel = memo(function WorkspaceContextPanel({
  workspaceId,
  workspace,
}: WorkspaceContextPanelProps) {
  const router = useRouter();
  const { previews, pr, owner, repo, branch } = useFirebasePreview(workspaceId);

  const handleOpenPrReview = useCallback(() => {
    if (!pr) return;
    try {
      localStorage.setItem("dev-hub:git-view-mode", "pr");
      localStorage.setItem(
        "dev-hub:git-selected-pr",
        `${pr.base.repo.full_name}/${pr.number}`,
      );
    } catch {}
    router.push("/git");
  }, [pr, router]);

  const linkedTaskMeta = workspace.linkedTaskMeta as LinkedTaskMeta | null;

  const hasContent = !!(pr || linkedTaskMeta || previews.length > 0);
  if (!hasContent) return null;

  return (
    <div>
      <div className="px-3 py-2">
        <span className="text-muted-foreground text-xs font-medium">
          Workspace Context
        </span>
      </div>
      <div className="space-y-2 px-3 pt-2 pb-3">
        {pr && (
          <div className="flex items-center gap-2 text-xs">
            <GitPullRequest className="text-muted-foreground size-3.5 shrink-0" />
            <button
              type="button"
              className="text-foreground min-w-0 flex-1 truncate text-left hover:underline"
              onClick={handleOpenPrReview}
            >
              {pr.title} #{pr.number}
            </button>
            <Tooltip delayDuration={500} disableHoverableContent>
              <TooltipTrigger asChild>
                <a
                  href={pr.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <ExternalLink className="size-3" />
                </a>
              </TooltipTrigger>
              <TooltipContent side="left">Open on GitHub</TooltipContent>
            </Tooltip>
            <Badge variant="outline" className="shrink-0 px-1 py-0 text-[10px]">
              <span
                className={
                  pr.draft ? "text-muted-foreground" : "text-green-500"
                }
              >
                {pr.draft ? "draft" : "open"}
              </span>
            </Badge>
          </div>
        )}

        {linkedTaskMeta && (
          <Tooltip delayDuration={500} disableHoverableContent>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 text-xs">
                <CheckSquare className="text-muted-foreground size-3.5 shrink-0" />
                <a
                  href={linkedTaskMeta.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground truncate hover:underline"
                >
                  {linkedTaskMeta.customId
                    ? `${linkedTaskMeta.customId} · `
                    : ""}
                  {linkedTaskMeta.name}
                </a>
                <Badge
                  variant="outline"
                  className="shrink-0 px-1 py-0 text-[10px]"
                >
                  {linkedTaskMeta.status}
                </Badge>
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">ClickUp task</TooltipContent>
          </Tooltip>
        )}

        {previews.map((preview) => (
          <PreviewRow
            key={preview.url}
            preview={preview}
            owner={owner}
            repo={repo}
            branch={branch}
          />
        ))}
      </div>
    </div>
  );
});
