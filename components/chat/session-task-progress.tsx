"use client";

import { ListTodo } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const STALE_AFTER_MS = 3_600_000;
const PAGE_LOADED_AT = Date.now();

export interface SessionTaskProgress {
  readonly completed: number;
  readonly total: number;
  readonly updatedAt?: number;
}

interface SessionTaskProgressIndicatorProps {
  readonly progress: SessionTaskProgress;
  readonly compact?: boolean;
  readonly currentTime?: number;
  readonly isSessionActive?: boolean;
}

export function SessionTaskProgressIndicator({
  progress,
  compact = false,
  currentTime,
  isSessionActive = false,
}: SessionTaskProgressIndicatorProps) {
  const [clockTime, setClockTime] = useState(PAGE_LOADED_AT);
  useEffect(() => {
    if (currentTime !== undefined || progress.updatedAt === undefined) return;
    const timeout = window.setTimeout(
      () => setClockTime(Date.now()),
      Math.max(0, progress.updatedAt + STALE_AFTER_MS + 1 - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [currentTime, progress.updatedAt]);
  const effectiveTime = currentTime ?? clockTime;
  const accessibleLabel = `${progress.completed} of ${progress.total} tasks completed`;
  const isStale =
    !isSessionActive &&
    progress.updatedAt !== undefined &&
    effectiveTime - progress.updatedAt > STALE_AFTER_MS;
  if (isStale && progress.completed === progress.total) return null;
  const hoursSinceUpdate = progress.updatedAt
    ? Math.floor((effectiveTime - progress.updatedAt) / STALE_AFTER_MS)
    : 0;
  const title = isStale
    ? `Task status last updated ${hoursSinceUpdate} ${hoursSinceUpdate === 1 ? "hour" : "hours"} ago`
    : accessibleLabel;
  const progressLabel = isStale
    ? `${accessibleLabel}. ${title}`
    : accessibleLabel;

  return (
    <div
      className={cn(
        "text-muted-foreground flex items-center gap-1 text-xs tabular-nums",
        isStale && "grayscale",
      )}
      title={title}
    >
      <ListTodo
        className={cn("size-3", isStale ? "text-gray-400" : "text-sky-500")}
      />
      <span>
        {progress.completed}/{progress.total}
      </span>
      <progress
        aria-label={progressLabel}
        className={cn(
          "h-1",
          compact ? "w-6" : "w-10",
          isStale ? "accent-gray-400" : "accent-sky-500",
        )}
        value={progress.completed}
        max={progress.total}
      />
    </div>
  );
}
