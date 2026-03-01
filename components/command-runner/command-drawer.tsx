"use client"

import { useEffect } from "react"
import { Plus, X } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CommandInput } from "./command-input"
import { CommandOutput } from "./command-output"
import { useCommandStore } from "@/stores/command-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useShallow } from "zustand/react/shallow"
import { cn } from "@/lib/utils"

interface SessionTab {
  sessionId: string
  command: string
  isRunning: boolean
  exitCode: number | null
}

export function CommandDrawer() {
  const isOpen = useCommandStore((s) => s.isDrawerOpen)
  const setDrawerOpen = useCommandStore((s) => s.setDrawerOpen)
  const activeSessionId = useCommandStore((s) => s.activeSessionId)
  const setActiveSessionId = useCommandStore((s) => s.setActiveSessionId)
  const runCommand = useCommandStore((s) => s.runCommand)
  const killCommand = useCommandStore((s) => s.killCommand)
  const removeSession = useCommandStore((s) => s.removeSession)
  const fetchActiveProcesses = useCommandStore((s) => s.fetchActiveProcesses)
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)

  // Only tab metadata — re-renders when tabs are added/removed or running state changes,
  // NOT on every line of output.
  const sessionTabs = useCommandStore(
    useShallow((s): SessionTab[] =>
      Object.values(s.sessions).map((session) => ({
        sessionId: session.sessionId,
        command: session.command,
        isRunning: session.isRunning,
        exitCode: session.exitCode,
      }))
    )
  )

  // Only the active session — re-renders when output flushes, but only for this tab.
  const activeSession = useCommandStore((s) =>
    activeSessionId ? s.sessions[activeSessionId] ?? null : null
  )

  // Poll for active processes when drawer opens
  useEffect(() => {
    if (!isOpen) return
    fetchActiveProcesses()
  }, [isOpen, fetchActiveProcesses])

  const handleNewPanel = () => {
    setActiveSessionId(null)
  }

  const handleRun = (command: string) => {
    if (!workspaceId) return
    const newSessionId = runCommand(command, workspaceId)
    setActiveSessionId(newSessionId)
  }

  const handleKill = () => {
    if (!activeSessionId) return
    killCommand(activeSessionId)
  }

  const handleCloseTab = (sessionId: string, isRunning: boolean) => {
    if (isRunning) {
      killCommand(sessionId)
    }
    removeSession(sessionId)
  }

  return (
    <Sheet open={isOpen} onOpenChange={setDrawerOpen}>
      <SheetContent side="bottom" className="h-[60vh] max-h-[600px]" showCloseButton={false}>
        <SheetHeader className="pb-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-sm">Command Runner</SheetTitle>
            <SheetDescription className="sr-only">
              Run and manage terminal commands
            </SheetDescription>
          </div>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-2 overflow-hidden px-4 pb-4">
          {/* Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto border-b pb-1">
            {sessionTabs.map((tab) => (
              <button
                key={tab.sessionId}
                onClick={() => setActiveSessionId(tab.sessionId)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs font-mono transition-colors",
                  tab.sessionId === activeSessionId
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.isRunning && (
                  <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                )}
                <span className="max-w-32 truncate">{tab.command}</span>
                {tab.exitCode !== null && (
                  <Badge
                    variant={tab.exitCode === 0 ? "default" : "destructive"}
                    className="text-[8px] px-1 py-0"
                  >
                    {tab.exitCode}
                  </Badge>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCloseTab(tab.sessionId, tab.isRunning)
                  }}
                  className="ml-1 rounded-sm p-0.5 hover:bg-muted-foreground/20"
                >
                  <X className="size-2.5" />
                </button>
              </button>
            ))}

            <Button
              size="icon"
              variant="ghost"
              className="size-6 shrink-0"
              onClick={handleNewPanel}
            >
              <Plus className="size-3" />
            </Button>
          </div>

          {/* Active panel content */}
          {activeSession ? (
            <div className="flex flex-1 flex-col gap-2 overflow-hidden">
              <CommandInput
                workspaceId={workspaceId}
                isRunning={activeSession.isRunning}
                onRun={handleRun}
                onKill={handleKill}
              />
              <CommandOutput
                lines={activeSession.lines}
                isRunning={activeSession.isRunning}
                className="flex-1"
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col gap-2 overflow-hidden">
              <CommandInput
                workspaceId={workspaceId}
                isRunning={false}
                onRun={handleRun}
                onKill={() => {}}
              />
              {!workspaceId && (
                <p className="text-xs text-muted-foreground text-center py-8">
                  Select a workspace to run commands
                </p>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
