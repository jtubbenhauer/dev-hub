"use client"

import { useEffect, useState, useCallback } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { TerminalPanel } from "./terminal-panel"
import { useTerminalStore } from "@/stores/terminal-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { Loader2, AlertCircle, TerminalSquare } from "lucide-react"

interface TerminalConfig {
  wsUrl: string
  cwd: string
  shellCommand: string | null
}

export function TerminalDrawer() {
  const isOpen = useTerminalStore((s) => s.isOpen)
  const setOpen = useTerminalStore((s) => s.setOpen)
  const toggle = useTerminalStore((s) => s.toggle)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)

  const [config, setConfig] = useState<TerminalConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<string | null>(null)

  const resolve = useCallback((workspaceId: string) => {
    setIsLoading(true)
    setError(null)
    setConfig(null)
    setResolvedWorkspaceId(workspaceId)

    fetch(`/api/terminal/resolve?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json() as { error?: string }
          throw new Error(body.error || `Failed to resolve terminal (${res.status})`)
        }
        return res.json() as Promise<TerminalConfig>
      })
      .then((data) => {
        setConfig(data)
        setIsLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setIsLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!isOpen || !activeWorkspaceId) return
    if (activeWorkspaceId === resolvedWorkspaceId && config) return

    resolve(activeWorkspaceId)
  }, [isOpen, activeWorkspaceId, resolvedWorkspaceId, config, resolve])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "`" && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        toggle()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggle])

  return (
    <Sheet open={isOpen} onOpenChange={setOpen}>
      <SheetContent side="bottom" className="h-[60vh] max-h-[600px]" showCloseButton={false}>
        <SheetHeader className="pb-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-sm flex items-center gap-1.5">
                <TerminalSquare className="size-3.5" />
                Terminal
              </SheetTitle>
              {activeWorkspace && (
                <span className="text-xs text-muted-foreground">
                  {activeWorkspace.name}
                  {activeWorkspace.backend === "remote" && (
                    <span className="text-blue-500 ml-1">(remote)</span>
                  )}
                </span>
              )}
            </div>
            <SheetDescription className="sr-only">
              Interactive terminal session
            </SheetDescription>
            <span className="text-xs text-muted-foreground font-mono">Ctrl+`</span>
          </div>
        </SheetHeader>

        <div className="flex flex-1 flex-col overflow-hidden px-4 pb-4">
          {!activeWorkspaceId && (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Select a workspace to open a terminal
              </p>
            </div>
          )}

          {activeWorkspaceId && isLoading && (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {activeWorkspaceId && error && (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-center max-w-sm">
                <AlertCircle className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
          )}

          {activeWorkspaceId && config && !isLoading && !error && (
            <div className="flex-1 min-h-0">
              <TerminalPanel
                key={resolvedWorkspaceId}
                wsUrl={config.wsUrl}
                cwd={config.cwd}
                shellCommand={config.shellCommand}
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
