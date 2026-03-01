"use client"

import { useState, useCallback, useId } from "react"
import { X, Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CommandInput } from "./command-input"
import { CommandOutput } from "./command-output"
import { useCommandWebSocket } from "@/hooks/use-websocket"
import type { ServerMessage } from "@/lib/commands/types"
import { cn } from "@/lib/utils"

interface CommandPanelProps {
  workspaceId: string | null
  onClose?: () => void
  className?: string
}

interface PanelState {
  sessionId: string
  command: string
  lines: string[]
  isRunning: boolean
  exitCode: number | null
}

function createPanelState(sessionId: string): PanelState {
  return { sessionId, command: "", lines: [], isRunning: false, exitCode: null }
}

export function CommandPanel({ workspaceId, onClose, className }: CommandPanelProps) {
  const generatedId = useId()
  const [state, setState] = useState<PanelState>(() =>
    createPanelState(generatedId.replace(/:/g, ""))
  )
  const [isExpanded, setIsExpanded] = useState(false)

  const handleMessage = useCallback((message: ServerMessage) => {
    if (message.sessionId !== state.sessionId) return

    switch (message.type) {
      case "started":
        setState((prev) => ({ ...prev, isRunning: true, lines: [], exitCode: null }))
        break
      case "data":
        setState((prev) => ({ ...prev, lines: [...prev.lines, message.data] }))
        break
      case "exit":
        setState((prev) => ({
          ...prev,
          isRunning: false,
          exitCode: message.exitCode,
        }))
        break
      case "error":
        setState((prev) => ({
          ...prev,
          isRunning: false,
          lines: [...prev.lines, `\x1b[31mError: ${message.message}\x1b[0m\n`],
        }))
        break
    }
  }, [state.sessionId])

  const { runCommand, killCommand } = useCommandWebSocket({
    onMessage: handleMessage,
    workspaceId: workspaceId ?? undefined,
  })

  const handleRun = useCallback(
    (command: string) => {
      setState((prev) => ({ ...prev, command, lines: [], exitCode: null }))
      runCommand(state.sessionId, command)
    },
    [runCommand, state.sessionId]
  )

  const handleKill = useCallback(() => {
    killCommand(state.sessionId)
  }, [killCommand, state.sessionId])

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
          {state.command ? (
            <span className="font-mono text-xs text-muted-foreground">
              {state.command}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">New command</span>
          )}
        </div>

        {state.exitCode !== null && (
          <Badge variant={state.exitCode === 0 ? "default" : "destructive"} className="text-[10px]">
            exit {state.exitCode}
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
        isRunning={state.isRunning}
        onRun={handleRun}
        onKill={handleKill}
      />

      {/* Output */}
      <CommandOutput
        lines={state.lines}
        isRunning={state.isRunning}
        className={cn("min-h-32", isExpanded ? "flex-1" : "max-h-80")}
      />
    </div>
  )
}
