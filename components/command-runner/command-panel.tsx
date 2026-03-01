"use client"

import { useState, useCallback } from "react"
import { X, Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CommandInput } from "./command-input"
import { CommandOutput } from "./command-output"
import { useCommandStore } from "@/stores/command-store"
import { cn } from "@/lib/utils"

interface CommandPanelProps {
  workspaceId: string | null
  initialSessionId?: string
  onClose?: () => void
  className?: string
}

export function CommandPanel({ workspaceId, initialSessionId, onClose, className }: CommandPanelProps) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(initialSessionId ?? null)
  const session = useCommandStore((s) => currentSessionId ? s.sessions[currentSessionId] : null)
  const runCommand = useCommandStore((s) => s.runCommand)
  const killCommand = useCommandStore((s) => s.killCommand)
  const [isExpanded, setIsExpanded] = useState(false)

  const lines = session?.lines ?? []
  const isRunning = session?.isRunning ?? false
  const exitCode = session?.exitCode ?? null
  const command = session?.command ?? ""

  const handleRun = useCallback(
    (cmd: string) => {
      if (!workspaceId) return
      const newSessionId = runCommand(cmd, workspaceId)
      setCurrentSessionId(newSessionId)
    },
    [workspaceId, runCommand]
  )

  const handleKill = useCallback(() => {
    if (!currentSessionId) return
    killCommand(currentSessionId)
  }, [currentSessionId, killCommand])

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card p-3",
        isExpanded && "fixed inset-4 z-40 overflow-hidden",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex-1 truncate">
          {command ? (
            <span className="font-mono text-xs text-muted-foreground">
              {command}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">New command</span>
          )}
        </div>

        {exitCode !== null && (
          <Badge variant={exitCode === 0 ? "default" : "destructive"} className="text-[10px]">
            exit {exitCode}
          </Badge>
        )}

        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          onClick={() => setIsExpanded((v) => !v)}
        >
          {isExpanded ? (
            <Minimize2 className="size-3" />
          ) : (
            <Maximize2 className="size-3" />
          )}
        </Button>

        {onClose && (
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={onClose}
          >
            <X className="size-3" />
          </Button>
        )}
      </div>

      {/* Input */}
      <CommandInput
        workspaceId={workspaceId}
        isRunning={isRunning}
        onRun={handleRun}
        onKill={handleKill}
      />

      {/* Output */}
      <CommandOutput
        lines={lines}
        isRunning={isRunning}
        className={cn("min-h-32", isExpanded ? "flex-1" : "max-h-80")}
      />
    </div>
  )
}
