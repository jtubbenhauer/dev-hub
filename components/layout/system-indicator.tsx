"use client"

import { useSystemStatsSnapshot } from "@/hooks/use-system-stats"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

function usageColor(percent: number): string {
  if (percent >= 80) return "text-red-500"
  if (percent >= 60) return "text-yellow-500"
  return "text-green-500"
}

function dotColor(percent: number): string {
  if (percent >= 80) return "fill-red-500 text-red-500"
  if (percent >= 60) return "fill-yellow-500 text-yellow-500"
  return "fill-green-500 text-green-500"
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)}GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)}MB`
  return `${(bytes / 1_024).toFixed(0)}KB`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function SystemIndicator() {
  const { data: stats } = useSystemStatsSnapshot({ interval: 30_000 })

  if (!stats) return null

  const cpuPercent = Math.round(stats.cpu.usage)
  const memPercent = Math.round(stats.memory.usagePercent)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2.5 rounded-md px-2 py-1 text-xs hover:bg-accent/50 transition-colors">
          <span className="flex items-center gap-1">
            <svg className={cn("size-2", dotColor(cpuPercent))} viewBox="0 0 8 8">
              <circle cx="4" cy="4" r="4" />
            </svg>
            <span className={usageColor(cpuPercent)}>{cpuPercent}%</span>
            <span className="text-muted-foreground">CPU</span>
          </span>
          <span className="flex items-center gap-1">
            <svg className={cn("size-2", dotColor(memPercent))} viewBox="0 0 8 8">
              <circle cx="4" cy="4" r="4" />
            </svg>
            <span className={usageColor(memPercent)}>{memPercent}%</span>
            <span className="text-muted-foreground">MEM</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-3 space-y-2.5">
        <div className="space-y-1.5">
          <p className="text-xs font-medium">CPU</p>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{stats.cpu.model}</span>
            <span className={cn("font-medium", usageColor(cpuPercent))}>{cpuPercent}%</span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{stats.cpu.cores} cores · {stats.cpu.speed.toFixed(1)} GHz</span>
            {stats.cpu.temperature != null && (
              <span>{stats.cpu.temperature.toFixed(0)}°C</span>
            )}
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="space-y-1.5">
          <p className="text-xs font-medium">Memory</p>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}</span>
            <span className={cn("font-medium", usageColor(memPercent))}>{memPercent}%</span>
          </div>
          {stats.memory.swapTotal > 0 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Swap {formatBytes(stats.memory.swapUsed)} / {formatBytes(stats.memory.swapTotal)}</span>
              <span>{Math.round(stats.memory.swapPercent)}%</span>
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Uptime</span>
          <span>{formatUptime(stats.uptime)}</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
