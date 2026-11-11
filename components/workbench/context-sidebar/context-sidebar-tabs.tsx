import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PullRequestTabAppearance } from "@/components/git/workspace-pr/workspace-pr-presentation";
import { CONTEXT_SIDEBAR_VIEW_ITEMS } from "@/components/workbench/context-sidebar/context-sidebar-views";
import { cn } from "@/lib/utils";
import type { ContextSidebarView } from "@/stores/context-sidebar-store";

interface ContextSidebarTabsProps {
  // The view on screen, or null while the sidebar is hidden.
  readonly shownView: ContextSidebarView | null;
  readonly changedPathCount: number;
  readonly pullRequestAppearance: PullRequestTabAppearance;
  readonly onSelectView: (view: ContextSidebarView) => void;
}

export function ContextSidebarTabs({
  shownView,
  changedPathCount,
  pullRequestAppearance,
  onSelectView,
}: ContextSidebarTabsProps) {
  return (
    <div
      role="group"
      aria-label="Context sidebar views"
      className="flex items-center gap-1"
    >
      {CONTEXT_SIDEBAR_VIEW_ITEMS.map(({ view, label, icon }) => {
        const isShown = view === shownView;
        const badgeCount = view === "changes" ? changedPathCount : 0;
        const pullRequest =
          view === "pull-request" ? pullRequestAppearance : null;
        const Icon = pullRequest?.icon ?? icon;
        return (
          <Tooltip key={view}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={label}
                aria-pressed={isShown}
                className={cn(
                  "text-muted-foreground relative",
                  isShown && "bg-accent text-accent-foreground",
                )}
                onClick={() => onSelectView(view)}
              >
                <Icon className={cn("h-4 w-4", pullRequest?.iconClassName)} />
                {pullRequest?.dotClassName && (
                  <span
                    data-testid="pull-request-checks-dot"
                    className={cn(
                      "ring-background absolute top-1 right-1 size-2 rounded-full ring-2",
                      pullRequest.dotClassName,
                    )}
                  />
                )}
                {badgeCount > 0 && (
                  <span className="bg-primary text-primary-foreground absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] leading-none font-medium tabular-nums">
                    {badgeCount > 99 ? "99+" : badgeCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {pullRequest?.statusText ?? label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
