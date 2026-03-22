"use client";

import { memo } from "react";
import { GitPullRequest, CheckSquare, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useFirebasePreview } from "@/hooks/use-firebase-preview";
import type { Workspace, LinkedTaskMeta } from "@/types";

interface WorkspaceContextPanelProps {
  workspaceId: string;
  workspace: Workspace;
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
  const {
    preview,
    pr,
    isLoading: isPreviewLoading,
  } = useFirebasePreview(workspaceId);

  const linkedTaskMeta = workspace.linkedTaskMeta as LinkedTaskMeta | null;

  const hasContent = !!(pr || linkedTaskMeta || preview);
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
          <Tooltip delayDuration={500} disableHoverableContent>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 text-xs">
                <GitPullRequest className="text-muted-foreground size-3.5 shrink-0" />
                <a
                  href={pr.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground truncate hover:underline"
                >
                  {pr.title} #{pr.number}
                </a>
                <Badge
                  variant="outline"
                  className="shrink-0 px-1 py-0 text-[10px]"
                >
                  <span
                    className={
                      pr.draft ? "text-muted-foreground" : "text-green-500"
                    }
                  >
                    {pr.draft ? "draft" : "open"}
                  </span>
                </Badge>
              </div>
            </TooltipTrigger>
            <TooltipContent side="left">Pull request</TooltipContent>
          </Tooltip>
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

        {preview && (
          <Tooltip delayDuration={500} disableHoverableContent>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 text-xs">
                <Globe className="text-muted-foreground size-3.5 shrink-0" />
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground max-w-[150px] truncate hover:underline"
                  title={preview.url}
                >
                  {preview.url.length > 30
                    ? preview.url.substring(0, 30) + "..."
                    : preview.url}
                </a>
                {preview.isExpired ? (
                  <Badge
                    variant="outline"
                    className="text-muted-foreground shrink-0 px-1 py-0 text-[10px] line-through"
                  >
                    Expired
                  </Badge>
                ) : (
                  <span className="text-muted-foreground shrink-0">
                    deployed {formatRelativeTime(preview.deployedAt)}
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
        )}
      </div>
    </div>
  );
});
