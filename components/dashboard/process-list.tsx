"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSystemStatsSnapshot } from "@/hooks/use-system-stats";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProcessInfo } from "@/types";

type SortKey = "cpu" | "memory";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(1)} ${units[exp]}`;
}

function cpuBarColor(percent: number): string {
  if (percent >= 50) return "bg-red-500";
  if (percent >= 20) return "bg-yellow-500";
  return "bg-green-500";
}

interface ProcessRowProps {
  process: ProcessInfo;
  maxCpu: number;
}

function ProcessRow({ process, maxCpu }: ProcessRowProps) {
  const isHighCpu = process.cpu >= 20;
  const isHighMem = process.memory >= 10;

  return (
    <div className="border-border/50 grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b py-1.5 text-xs last:border-0">
      <div className="min-w-0">
        <p
          className={cn("truncate font-medium", isHighCpu && "text-yellow-500")}
        >
          {process.name}
        </p>
        <p className="text-muted-foreground truncate">{process.user}</p>
      </div>
      <div className="w-16 text-right">
        <p className={cn("font-mono", isHighCpu && "text-yellow-500")}>
          {process.cpu.toFixed(1)}%
        </p>
        <div className="bg-muted mt-0.5 h-0.5 rounded-full">
          <div
            className={cn("h-full rounded-full", cpuBarColor(process.cpu))}
            style={{ width: `${Math.min((process.cpu / maxCpu) * 100, 100)}%` }}
          />
        </div>
      </div>
      <div className="w-14 text-right">
        <p className={cn("font-mono", isHighMem && "text-orange-500")}>
          {process.memory.toFixed(1)}%
        </p>
      </div>
      <div className="text-muted-foreground w-14 text-right font-mono">
        {formatBytes(process.memRss)}
      </div>
    </div>
  );
}

export function ProcessList() {
  const [sortBy, setSortBy] = useState<SortKey>("cpu");
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading } = useSystemStatsSnapshot({ interval: 5_000 });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="mb-1 h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const sorted = [...data.processes].sort((a, b) =>
    sortBy === "cpu" ? b.cpu - a.cpu : b.memory - a.memory,
  );
  const visible = showAll ? sorted.slice(0, 20) : sorted.slice(0, 10);
  const maxCpu = sorted[0]?.cpu ?? 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium">
            <Activity className="size-3.5" />
            Processes
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant={sortBy === "cpu" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setSortBy("cpu")}
            >
              CPU
            </Button>
            <Button
              variant={sortBy === "memory" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setSortBy("memory")}
            >
              MEM
            </Button>
          </div>
        </div>
        <div className="text-muted-foreground mt-1 grid grid-cols-[1fr_auto_auto_auto] gap-2 text-xs">
          <span>Name</span>
          <span className="w-16 text-right">CPU</span>
          <span className="w-14 text-right">MEM</span>
          <span className="w-14 text-right">RSS</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {visible.map((process) => (
          <ProcessRow key={process.pid} process={process} maxCpu={maxCpu} />
        ))}
        {sorted.length > 10 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground mt-2 h-6 w-full text-xs"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? (
              <>
                <ChevronUp className="mr-1 size-3" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="mr-1 size-3" />
                Show {sorted.length - 10} more
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
