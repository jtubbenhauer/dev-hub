"use client";

import { Bot } from "lucide-react";

export interface SessionSubAgentCount {
  readonly active: number;
  readonly waiting: number;
  readonly progress?: {
    readonly completed: number;
    readonly total: number;
  };
}

interface SessionSubAgentCountIndicatorProps {
  readonly count: SessionSubAgentCount;
}

export function SessionSubAgentCountIndicator({
  count,
}: SessionSubAgentCountIndicatorProps) {
  const total = count.active + count.waiting;
  if (total <= 0) return null;

  const label = `${total} sub-${total === 1 ? "agent" : "agents"} working`;
  const waitingSuffix =
    count.waiting > 0 ? ` (${count.waiting} waiting for input)` : "";
  const progress =
    count.progress && count.progress.total > 0 ? count.progress : null;
  const progressLabel = progress
    ? `${progress.completed} of ${progress.total} sub-agent tasks completed`
    : null;
  const title = progressLabel
    ? `${label}${waitingSuffix} — ${progressLabel}`
    : `${label}${waitingSuffix}`;

  return (
    <div
      className="flex items-center gap-1 text-xs text-violet-600 tabular-nums dark:text-violet-300"
      title={title}
      aria-label={title}
    >
      <Bot className="size-3" />
      <span>{total}</span>
      {progress && progressLabel && (
        <progress
          aria-label={progressLabel}
          className="h-1 w-10 accent-violet-500"
          value={progress.completed}
          max={progress.total}
        />
      )}
    </div>
  );
}
