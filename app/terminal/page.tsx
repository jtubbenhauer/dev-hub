"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"
import { TerminalPanel } from "@/components/terminal/terminal-panel"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { Loader2, TerminalSquare, AlertCircle } from "lucide-react"

interface TerminalConfig {
  wsUrl: string
  cwd: string
  shellCommand: string | null
}

function TerminalPageContent() {
  const searchParams = useSearchParams()
  const workspaceIdParam = searchParams.get("workspace")
  const { activeWorkspaceId, activeWorkspace, workspaces } = useWorkspaceStore()
  const workspaceId = workspaceIdParam || activeWorkspaceId
  const workspace = workspaceIdParam
    ? workspaces.find((w) => w.id === workspaceIdParam) ?? activeWorkspace
    : activeWorkspace

  const [config, setConfig] = useState<TerminalConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!workspaceId) {
      setError("No workspace selected. Go to Workspaces and open a terminal from there.")
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    fetch(`/api/terminal/resolve?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json() as { error?: string }
          throw new Error(body.error || `Failed to resolve terminal config (${res.status})`)
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
  }, [workspaceId])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center max-w-md">
          <AlertCircle className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  if (!config) return null

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <TerminalSquare className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{workspace?.name ?? "Terminal"}</span>
        {workspace?.backend === "remote" && (
          <span className="text-xs text-blue-500">(remote)</span>
        )}
        <span className="text-xs text-muted-foreground font-mono ml-auto truncate max-w-96">
          {config.shellCommand || config.cwd}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <TerminalPanel
          wsUrl={config.wsUrl}
          cwd={config.cwd}
          shellCommand={config.shellCommand}
        />
      </div>
    </div>
  )
}

export default function TerminalPage() {
  return (
    <AuthenticatedLayout>
      <Suspense fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      }>
        <TerminalPageContent />
      </Suspense>
    </AuthenticatedLayout>
  )
}
