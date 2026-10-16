"use client";

import { Radio, Target } from "lucide-react";

import { goalStateLabel } from "@/components/chat/session-background-chip";
import type { SessionGoalState } from "@/lib/opencode/types";
import {
  isBackgroundWorkLive,
  useSessionBackgroundStore,
} from "@/stores/session-background-store";

function goalLabel(
  goalState: SessionGoalState | undefined,
  hasGoalWait: boolean,
): string | undefined {
  if (goalState === "active") return `${goalStateLabel(goalState)} in progress`;
  if (hasGoalWait) return `${goalStateLabel(goalState)} · check-in scheduled`;
  return undefined;
}

function monitorLabel(
  hasMonitors: boolean,
  monitorCount: number | undefined,
): string | undefined {
  if (!hasMonitors) return undefined;
  if (monitorCount === undefined) return "Monitors watching";
  return `${monitorCount} ${monitorCount === 1 ? "monitor" : "monitors"} watching`;
}

// Each selector returns a primitive, so the countdown of a waiting goal, which
// updates every second, does not re-render every session row.
export function SessionBackgroundIndicator({
  sessionId,
}: {
  sessionId: string;
}) {
  const isLive = useSessionBackgroundStore((state) => {
    const status = state.statusBySession[sessionId];
    return status !== undefined && isBackgroundWorkLive(status);
  });
  const goalState = useSessionBackgroundStore(
    (state) => state.statusBySession[sessionId]?.goalState,
  );
  const hasGoalWait = useSessionBackgroundStore(
    (state) => state.statusBySession[sessionId]?.goalWait !== undefined,
  );
  const hasMonitors = useSessionBackgroundStore(
    (state) => state.statusBySession[sessionId]?.monitors !== undefined,
  );
  const monitorCount = useSessionBackgroundStore(
    (state) => state.statusBySession[sessionId]?.monitorCount,
  );
  if (!isLive) return null;

  const label = [
    goalLabel(goalState, hasGoalWait),
    monitorLabel(hasMonitors, monitorCount),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

  return (
    <div
      className="flex items-center gap-1 text-xs text-sky-700 tabular-nums dark:text-sky-300"
      title={label}
      aria-label={label}
    >
      {hasMonitors ? (
        <>
          <span className="relative flex size-3 items-center justify-center">
            <span
              aria-hidden="true"
              className="animation-duration-2000 absolute size-1.5 animate-ping rounded-full bg-sky-500/60 motion-reduce:hidden motion-reduce:animate-none"
            />
            <Radio aria-hidden="true" className="relative size-3" />
          </span>
          {monitorCount !== undefined && <span>{monitorCount}</span>}
        </>
      ) : (
        <Target
          aria-hidden="true"
          className="size-3 animate-pulse motion-reduce:animate-none"
        />
      )}
    </div>
  );
}
