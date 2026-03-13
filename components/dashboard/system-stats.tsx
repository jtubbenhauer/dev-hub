"use client"

import {
  AreaChart,
  Area,
  YAxis,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemStatsWithHistory } from "@/hooks/use-system-stats"
import { Cpu, MemoryStick, HardDrive, Network } from "lucide-react"

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exp = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, exp)
  return `${value.toFixed(decimals)} ${units[exp]}`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function thresholdColor(percent: number): string {
  if (percent >= 80) return "text-red-500"
  if (percent >= 60) return "text-yellow-500"
  return "text-green-500"
}

function sparklineColor(percent: number): string {
  if (percent >= 80) return "var(--chart-error)"
  if (percent >= 60) return "var(--chart-warning)"
  return "var(--chart-success)"
}

interface SparklineProps {
  data: number[]
  color: string
  id: string
  maxValue?: number
}

function Sparkline({ data, color, id, maxValue }: SparklineProps) {
  const chartData = data.map((value, index) => ({ index, value }))
  const gradientId = `grad-${id}`

  return (
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart
        data={chartData}
        margin={{ top: 2, right: 0, bottom: 0, left: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          dot={false}
          isAnimationActive={false}
          yAxisId={0}
        />
        <RechartsTooltip content={() => null} />
        {/* Hidden Y axis to fix domain */}
        <YAxis domain={[0, maxValue ?? "auto"]} hide yAxisId={0} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function SystemStatsCards() {
  const { data, isLoading } = useSystemStatsWithHistory({ interval: 5_000 })

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16 mb-2" />
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  const { current, history } = data
  const cpuColor = sparklineColor(current.cpu.usage)
  const memColor = sparklineColor(current.memory.usagePercent)
  const primaryDisk = current.disks[0]
  const totalRxSec = current.network.reduce((sum, n) => sum + n.rxSec, 0)
  const totalTxSec = current.network.reduce((sum, n) => sum + n.txSec, 0)

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* CPU */}
        <Card>
          <CardHeader className="pb-1 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Cpu className="size-3.5" />
              CPU
            </CardTitle>
            <span className={`text-xs font-medium ${thresholdColor(current.cpu.usage)}`}>
              {current.cpu.usage}%
            </span>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="mb-1">
              <span className="text-2xl font-bold">{current.cpu.usage}</span>
              <span className="text-sm text-muted-foreground ml-1">%</span>
            </div>
            <p className="text-xs text-muted-foreground truncate mb-2">
              {current.cpu.model} · {current.cpu.cores} cores
              {current.cpu.temperature !== undefined && ` · ${current.cpu.temperature}°C`}
            </p>
            <Sparkline data={history.cpu} color={cpuColor} id="cpu" maxValue={100} />
          </CardContent>
        </Card>

        {/* Memory */}
        <Card>
          <CardHeader className="pb-1 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <MemoryStick className="size-3.5" />
              Memory
            </CardTitle>
            <span className={`text-xs font-medium ${thresholdColor(current.memory.usagePercent)}`}>
              {current.memory.usagePercent}%
            </span>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="mb-1">
              <span className="text-2xl font-bold">{formatBytes(current.memory.used)}</span>
              <span className="text-sm text-muted-foreground ml-1">
                / {formatBytes(current.memory.total)}
              </span>
            </div>
            {current.memory.swapTotal > 0 && (
              <p className="text-xs text-muted-foreground mb-2">
                Swap: {formatBytes(current.memory.swapUsed)} / {formatBytes(current.memory.swapTotal)}
              </p>
            )}
            {current.memory.swapTotal === 0 && (
              <p className="text-xs text-muted-foreground mb-2">&nbsp;</p>
            )}
            <Sparkline data={history.memory} color={memColor} id="memory" maxValue={100} />
          </CardContent>
        </Card>

        {/* Disk */}
        <Card>
          <CardHeader className="pb-1 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <HardDrive className="size-3.5" />
              Disk
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {primaryDisk ? (
              <div className="space-y-2">
                <div>
                  <span className="text-2xl font-bold">{primaryDisk.usagePercent}</span>
                  <span className="text-sm text-muted-foreground ml-1">%</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(primaryDisk.used)} / {formatBytes(primaryDisk.size)} · {primaryDisk.mount}
                </p>
                {current.disks.slice(1).map((disk) => (
                  <div key={disk.mount} className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground truncate">{disk.mount}</span>
                      <span className={thresholdColor(disk.usagePercent)}>{disk.usagePercent}%</span>
                    </div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${disk.usagePercent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No disks detected</p>
            )}
          </CardContent>
        </Card>

        {/* Network */}
        <Card>
          <CardHeader className="pb-1 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Network className="size-3.5" />
              Network
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="mb-1 space-y-0.5">
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground text-xs">↓</span>
                <span className="font-semibold">{formatBytes(totalRxSec)}/s</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground text-xs">↑</span>
                <span className="font-semibold">{formatBytes(totalTxSec)}/s</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-2">
              {current.network.map((n) => n.iface).join(", ")}
            </p>
            <Sparkline data={history.networkRx} color="var(--chart-info)" id="network" />
          </CardContent>
        </Card>
      </div>

      {/* Uptime strip */}
      <p className="text-xs text-muted-foreground">
        Uptime: {formatUptime(current.uptime)}
      </p>
    </div>
  )
}
