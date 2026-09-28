"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOmoSessionStats } from "@/hooks/use-omo-session-stats";
import {
  contextUsageLevel,
  formatContextPercent,
  formatCost,
  formatTokenCount,
} from "@/lib/chat/omo-session-stats";
import { cn } from "@/lib/utils";

interface ContextUsageIndicatorProps {
  workspaceId: string | null;
  sessionId: string | null;
}

const LEVEL_BAR_CLASSES = {
  normal: "bg-muted-foreground/60",
  warning: "bg-amber-500",
  critical: "bg-red-500",
} as const;

export function ContextUsageIndicator({
  workspaceId,
  sessionId,
}: ContextUsageIndicatorProps) {
  const stats = useOmoSessionStats(workspaceId, sessionId);
  const usage = stats?.contextUsage;
  if (!stats || !usage) return null;

  const level = contextUsageLevel(usage.percent);
  const percentLabel = formatContextPercent(usage.percent);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="meter"
          aria-label="Context used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(usage.percent)}
          aria-valuetext={`${percentLabel} of context used`}
          tabIndex={0}
          className="text-muted-foreground flex shrink-0 items-center gap-1.5 px-1 text-xs"
        >
          <div className="bg-muted h-1.5 w-10 overflow-hidden rounded-full">
            <div
              className={cn("h-full rounded-full", LEVEL_BAR_CLASSES[level])}
              style={{ width: `${Math.min(100, Math.max(2, usage.percent))}%` }}
            />
          </div>
          <span
            className={cn(
              "tabular-nums",
              level === "warning" && "text-amber-500",
              level === "critical" && "text-red-500",
            )}
          >
            {percentLabel}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div>
          Context: {formatTokenCount(usage.tokens)} /{" "}
          {formatTokenCount(usage.contextWindow)} tokens ({percentLabel})
        </div>
        <div>
          Session: {formatTokenCount(stats.tokens.total)} tokens ·{" "}
          {formatCost(stats.cost)}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
