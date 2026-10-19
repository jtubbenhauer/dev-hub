"use client";

import { ChevronDown, Pause, Radio } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getVisibleAgentCount } from "@/components/chat/running-sub-agents-banner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SessionBackgroundMonitor } from "@/lib/opencode/types";
import { cn } from "@/lib/utils";

const CLOCK_TICK_MS = 15_000;

// Elapsed labels only show whole minutes, so a coarse tick keeps them current
// without re-rendering the row every second.
function useClockMs(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(interval);
  }, []);
  return nowMs;
}

// Same compact shape omo uses in its footer: 3m, 2h 30m, 1d 2h 3m.
export function formatMonitorElapsed(elapsedMs: number): string {
  const minutes = Math.trunc(Math.max(0, elapsedMs) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.trunc(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours >= 24) {
    return `${Math.trunc(hours / 24)}d ${hours % 24}h ${remainingMinutes}m`;
  }
  return remainingMinutes === 0
    ? `${hours}h`
    : `${hours}h ${remainingMinutes}m`;
}

function monitorName(monitor: SessionBackgroundMonitor): string {
  return monitor.description === "" ? monitor.id : monitor.description;
}

function monitorActivity(
  monitor: SessionBackgroundMonitor,
  nowMs: number,
): string {
  const parts = [
    `running ${formatMonitorElapsed(nowMs - monitor.startedAtMs)}`,
  ];
  if (monitor.fireCount !== undefined) {
    parts.push(
      `fired ${monitor.fireCount} ${monitor.fireCount === 1 ? "time" : "times"}`,
    );
  }
  if (monitor.lastFiredAtMs !== undefined) {
    parts.push(
      `last ${formatMonitorElapsed(nowMs - monitor.lastFiredAtMs)} ago`,
    );
  }
  if (monitor.isPaused) parts.push("muted");
  return parts.join(" · ");
}

function MonitorIcon({ isPaused }: { isPaused: boolean }) {
  return isPaused ? (
    <Pause
      aria-label="Muted"
      className="text-muted-foreground size-3 shrink-0"
    />
  ) : (
    <Radio
      aria-hidden="true"
      className="size-3 shrink-0 text-sky-600 dark:text-sky-400"
    />
  );
}

interface MonitorEntryProps {
  readonly monitor: SessionBackgroundMonitor;
  readonly nowMs: number;
}

function MonitorLabel({ monitor, nowMs }: MonitorEntryProps) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {monitorName(monitor)}
      </span>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {formatMonitorElapsed(nowMs - monitor.startedAtMs)}
      </span>
    </>
  );
}

function MonitorDetails({ monitor, nowMs }: MonitorEntryProps) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">{monitorName(monitor)}</p>
      {monitor.command !== undefined && (
        <p className="line-clamp-4 font-mono break-all">{monitor.command}</p>
      )}
      <p className="text-background/70">{monitorActivity(monitor, nowMs)}</p>
    </div>
  );
}

function MonitorChip({ monitor, nowMs }: MonitorEntryProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="listitem"
          tabIndex={0}
          className={cn(
            "bg-background/70 hover:bg-background flex max-w-64 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-sky-500/20 px-2 py-1 transition-colors",
            monitor.isPaused && "opacity-70",
          )}
        >
          <MonitorIcon isPaused={monitor.isPaused} />
          <MonitorLabel monitor={monitor} nowMs={nowMs} />
        </div>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="max-w-80 text-pretty"
      >
        <MonitorDetails monitor={monitor} nowMs={nowMs} />
      </TooltipContent>
    </Tooltip>
  );
}

export function BackgroundMonitorRow({
  monitors,
}: {
  monitors: readonly SessionBackgroundMonitor[];
}) {
  const nowMs = useClockMs();
  const [monitorListWidth, setMonitorListWidth] = useState<number | null>(null);
  const observeMonitorListWidth = useCallback(
    (monitorList: HTMLDivElement | null) => {
      if (!monitorList) return;
      setMonitorListWidth(monitorList.clientWidth);
      const resizeObserver = new ResizeObserver(() =>
        setMonitorListWidth(monitorList.clientWidth),
      );
      resizeObserver.observe(monitorList);
      return () => resizeObserver.disconnect();
    },
    [],
  );
  const visibleCount = getVisibleAgentCount(monitors.length, monitorListWidth);
  const visibleMonitors = monitors.slice(0, visibleCount);
  const overflowMonitors = monitors.slice(visibleCount);

  return (
    <div className="flex h-7 w-full min-w-0 items-center gap-2 overflow-hidden">
      <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-300">
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          <span
            aria-hidden="true"
            className="animation-duration-2000 absolute size-2 animate-ping rounded-full bg-sky-500/50 motion-reduce:hidden motion-reduce:animate-none"
          />
          <Radio aria-hidden="true" className="relative size-3.5" />
        </span>
        <span className="tabular-nums">{monitors.length} watching</span>
      </div>
      <div
        ref={observeMonitorListWidth}
        role="list"
        aria-label="Watches"
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
      >
        {visibleMonitors.map((monitor) => (
          <MonitorChip key={monitor.id} monitor={monitor} nowMs={nowMs} />
        ))}
        {overflowMonitors.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="bg-background/70 hover:bg-background data-[state=open]:bg-background text-muted-foreground hover:text-foreground data-[state=open]:text-foreground flex shrink-0 items-center gap-1 rounded-md border border-sky-500/20 px-2 py-1 text-xs font-medium tabular-nums transition-colors"
              >
                +{overflowMonitors.length} more
                <ChevronDown className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-72 max-w-(--radix-dropdown-menu-content-available-width)"
            >
              {overflowMonitors.map((monitor) => (
                <DropdownMenuItem
                  key={monitor.id}
                  title={[
                    monitorName(monitor),
                    monitor.command,
                    monitorActivity(monitor, nowMs),
                  ]
                    .filter((line) => line !== undefined)
                    .join("\n")}
                >
                  <MonitorIcon isPaused={monitor.isPaused} />
                  <MonitorLabel monitor={monitor} nowMs={nowMs} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
