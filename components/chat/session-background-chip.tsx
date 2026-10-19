"use client";

import { Radio, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  SessionBackgroundStatus,
  SessionGoalState,
} from "@/lib/opencode/types";
import { useSessionBackgroundStore } from "@/stores/session-background-store";

const GOAL_STATE_LABELS: Record<SessionGoalState, string> = {
  active: "Goal",
  paused: "Goal paused",
  stopped: "Goal stopped",
  blocked: "Goal blocked",
  achieved: "Goal achieved",
};

interface SessionBackgroundChipProps {
  sessionId: string | null;
}

export function goalStateLabel(
  goalState: SessionGoalState | undefined,
): string {
  return goalState === undefined ? "Goal" : GOAL_STATE_LABELS[goalState];
}

function goalSummary(status: SessionBackgroundStatus): string {
  const goalName = goalStateLabel(status.goalState);
  return status.goalCheckIn
    ? `${goalName} · check-in ${status.goalCheckIn}`
    : goalName;
}

function monitorSummary(monitorCount: number | undefined): string {
  return monitorCount === undefined ? "Watching" : `${monitorCount} watching`;
}

function backgroundWorkLabel(status: SessionBackgroundStatus): string {
  const detailLines = [status.goal, status.goalWait, status.monitors].filter(
    (line) => line !== undefined,
  );
  return `Background work: ${detailLines.join(". ")}`;
}

function BackgroundWorkDetails({
  status,
}: {
  status: SessionBackgroundStatus;
}) {
  const hasGoal = status.goal !== undefined || status.goalWait !== undefined;
  return (
    <div className="flex flex-col gap-1.5">
      {hasGoal && (
        <div className="flex gap-1.5">
          <Target aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
          <div>
            {status.goal !== undefined && <p>{status.goal}</p>}
            {status.goalWait !== undefined && (
              <p className="text-background/70">{status.goalWait}</p>
            )}
          </div>
        </div>
      )}
      {status.monitors !== undefined && (
        <div className="flex gap-1.5">
          <Radio aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
          {status.monitorEntries === undefined ? (
            <p>{status.monitors}</p>
          ) : (
            <ul>
              {status.monitorEntries.map((monitor) => (
                <li key={monitor.id}>
                  {monitor.description === ""
                    ? monitor.id
                    : monitor.description}
                  {monitor.isPaused && (
                    <span className="text-background/70"> (muted)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function SessionBackgroundChip({
  sessionId,
}: SessionBackgroundChipProps) {
  const status = useSessionBackgroundStore((state) =>
    sessionId ? state.statusBySession[sessionId] : undefined,
  );
  if (!status) return null;
  const hasGoal = status.goal !== undefined || status.goalWait !== undefined;
  const hasMonitors = status.monitors !== undefined;
  if (!hasGoal && !hasMonitors) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          role="group"
          tabIndex={0}
          aria-label={backgroundWorkLabel(status)}
          className="text-muted-foreground shrink-0 gap-1.5 px-1.5 py-0 text-[10px]"
        >
          {hasGoal && (
            <span className="flex items-center gap-1">
              <Target aria-hidden="true" className="size-3" />
              <span className="hidden tabular-nums md:inline">
                {goalSummary(status)}
              </span>
              {status.goalWaitProgress !== undefined && (
                <span
                  aria-hidden="true"
                  className="bg-muted hidden h-1 w-6 overflow-hidden rounded-full md:block"
                >
                  <span
                    data-testid="session-background-wait-progress"
                    className="bg-muted-foreground/60 block h-full origin-left transition-transform duration-1000 ease-linear motion-reduce:transition-none"
                    style={{ transform: `scaleX(${status.goalWaitProgress})` }}
                  />
                </span>
              )}
            </span>
          )}
          {hasGoal && hasMonitors && (
            <span aria-hidden="true" className="bg-border h-2.5 w-px" />
          )}
          {hasMonitors && (
            <span className="flex items-center gap-1">
              <Radio aria-hidden="true" className="size-3" />
              {status.monitorCount !== undefined && (
                <span className="tabular-nums md:hidden">
                  {status.monitorCount}
                </span>
              )}
              <span className="hidden md:inline">
                {monitorSummary(status.monitorCount)}
              </span>
            </span>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="max-w-80 text-pretty"
      >
        <BackgroundWorkDetails status={status} />
      </TooltipContent>
    </Tooltip>
  );
}
