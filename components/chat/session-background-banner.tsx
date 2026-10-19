"use client";

import { Radio, Target } from "lucide-react";

import { goalStateLabel } from "@/components/chat/session-background-chip";
import { BackgroundMonitorRow } from "@/components/chat/session-background-monitors";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SessionBackgroundStatus } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";
import {
  isBackgroundWorkLive,
  useSessionBackgroundStore,
} from "@/stores/session-background-store";

const BACKGROUND_TINT = "text-sky-700 dark:text-sky-300";

// An achieved goal with nothing left running needs no banner; the toolbar
// chip still shows it.
function shouldShowBanner(status: SessionBackgroundStatus): boolean {
  return isBackgroundWorkLive(status) || status.goalState !== "achieved";
}

// Paused, stopped and blocked goals hold still: they wait for the user.
function isGoalInProgress(status: SessionBackgroundStatus): boolean {
  return (
    status.goalState === "active" ||
    (status.goalState === undefined && status.goalWait !== undefined)
  );
}

function WaitProgressBar({ progress }: { progress: number }) {
  return (
    <span
      role="progressbar"
      aria-label="Wait until check-in"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-sky-500/20"
    >
      <span
        className="block h-full origin-left bg-sky-600 transition-transform duration-1000 ease-linear motion-reduce:transition-none dark:bg-sky-400"
        style={{ transform: `scaleX(${progress})` }}
      />
    </span>
  );
}

function GoalSummary({ status }: { status: SessionBackgroundStatus }) {
  return (
    <>
      <Target
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0",
          BACKGROUND_TINT,
          isGoalInProgress(status) &&
            "animate-pulse motion-reduce:animate-none",
        )}
      />
      <span className="min-w-0 truncate font-medium">
        {status.goal ?? goalStateLabel(status.goalState)}
      </span>
      {status.goalCheckIn !== undefined && (
        <span className={cn("shrink-0 tabular-nums", BACKGROUND_TINT)}>
          {`check-in ${status.goalCheckIn}`}
        </span>
      )}
      {status.goalWaitProgress !== undefined && (
        <WaitProgressBar progress={status.goalWaitProgress} />
      )}
    </>
  );
}

function MonitorSummary({ monitors }: { monitors: string }) {
  return (
    <>
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        <span
          aria-hidden="true"
          className="animation-duration-2000 absolute size-2 animate-ping rounded-full bg-sky-500/50 motion-reduce:hidden motion-reduce:animate-none"
        />
        <Radio
          aria-hidden="true"
          className={cn("relative size-3.5", BACKGROUND_TINT)}
        />
      </span>
      <span className="text-foreground/70 min-w-16 flex-1 truncate">
        {monitors}
      </span>
    </>
  );
}

function BackgroundWorkLines({
  status,
  showsMonitorSummary,
}: {
  status: SessionBackgroundStatus;
  showsMonitorSummary: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {status.goal !== undefined && <p>{status.goal}</p>}
      {status.goalWait !== undefined && (
        <p className="text-background/70">{status.goalWait}</p>
      )}
      {showsMonitorSummary && <p>{status.monitors}</p>}
    </div>
  );
}

export function SessionBackgroundBanner({ sessionId }: { sessionId: string }) {
  const status = useSessionBackgroundStore(
    (state) => state.statusBySession[sessionId],
  );
  if (!status || !shouldShowBanner(status)) return null;
  const hasGoal = status.goal !== undefined || status.goalWait !== undefined;
  const monitorEntries = status.monitorEntries ?? [];
  // Until omo sends its monitor list, only the footer summary line is known.
  const showsMonitorSummary =
    status.monitors !== undefined && monitorEntries.length === 0;

  return (
    <section
      aria-label="Background work"
      className="flex shrink-0 flex-col gap-1 border-b border-sky-500/20 bg-sky-500/10 px-4 py-1.5"
    >
      {(hasGoal || showsMonitorSummary) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex h-7 w-full min-w-0 items-center gap-1.5 overflow-hidden text-xs">
              {hasGoal && <GoalSummary status={status} />}
              {hasGoal && showsMonitorSummary && (
                <span
                  aria-hidden="true"
                  className="mx-1 h-3 w-px shrink-0 bg-sky-500/30"
                />
              )}
              {showsMonitorSummary && status.monitors !== undefined && (
                <MonitorSummary monitors={status.monitors} />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="start"
            className="max-w-80 text-pretty"
          >
            <BackgroundWorkLines
              status={status}
              showsMonitorSummary={showsMonitorSummary}
            />
          </TooltipContent>
        </Tooltip>
      )}
      {monitorEntries.length > 0 && (
        <BackgroundMonitorRow monitors={monitorEntries} />
      )}
    </section>
  );
}
