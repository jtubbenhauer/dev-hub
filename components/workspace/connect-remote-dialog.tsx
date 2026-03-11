"use client"

import { useState, useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Globe, Loader2, CheckCircle2, XCircle } from "lucide-react"
import { toast } from "sonner"

type HealthStatus = "idle" | "checking" | "healthy" | "unreachable"

export function ConnectRemoteDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [agentUrl, setAgentUrl] = useState("")
  const [opencodeUrl, setOpencodeUrl] = useState("")
  const [name, setName] = useState("")
  const [healthStatus, setHealthStatus] = useState<HealthStatus>("idle")

  const isValidAgentUrl = useMemo(() => {
    if (!agentUrl) return false
    try {
      new URL(agentUrl)
      return true
    } catch {
      return false
    }
  }, [agentUrl])

  const isValidOpencodeUrl = useMemo(() => {
    if (!opencodeUrl) return false
    try {
      new URL(opencodeUrl)
      return true
    } catch {
      return false
    }
  }, [opencodeUrl])

  const canSubmit = isValidAgentUrl && isValidOpencodeUrl && healthStatus !== "checking"

  async function checkHealth() {
    if (!isValidAgentUrl) return
    setHealthStatus("checking")
    try {
      const res = await fetch(new URL("/health", agentUrl).toString(), {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) {
        setHealthStatus("unreachable")
        return
      }
      const body = (await res.json()) as { status?: string }
      setHealthStatus(body.status === "ok" ? "healthy" : "unreachable")
    } catch {
      setHealthStatus("unreachable")
    }
  }

  const connectMutation = useMutation({
    mutationFn: async (data: {
      agentUrl: string
      opencodeUrl: string
      name?: string
    }) => {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backend: "remote",
          agentUrl: data.agentUrl,
          opencodeUrl: data.opencodeUrl,
          name: data.name || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to connect remote workspace")
      }
      return res.json()
    },
    onSuccess: (workspace) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      setOpen(false)
      resetState()
      toast.success(`Connected remote workspace "${workspace.name}"`)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  function handleConnect() {
    if (!canSubmit) return
    connectMutation.mutate({
      agentUrl,
      opencodeUrl,
      name: name || undefined,
    })
  }

  function resetState() {
    setAgentUrl("")
    setOpencodeUrl("")
    setName("")
    setHealthStatus("idle")
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) resetState()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="sm:size-auto sm:px-3 sm:py-2">
          <Globe className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Connect Remote</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Connect Remote Workspace</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-url">Agent URL</Label>
            <div className="flex gap-2">
              <Input
                id="agent-url"
                value={agentUrl}
                onChange={(e) => {
                  setAgentUrl(e.target.value)
                  setHealthStatus("idle")
                }}
                placeholder="http://container.tailnet:7500"
                className="font-mono text-sm"
                autoFocus
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={checkHealth}
                disabled={!isValidAgentUrl || healthStatus === "checking"}
              >
                {healthStatus === "checking" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Test"
                )}
              </Button>
            </div>
            {agentUrl && !isValidAgentUrl && (
              <p className="text-xs text-destructive">Must be a valid URL</p>
            )}
            {healthStatus === "healthy" && (
              <p className="flex items-center gap-1 text-xs text-green-500">
                <CheckCircle2 className="h-3 w-3" />
                Agent is reachable
              </p>
            )}
            {healthStatus === "unreachable" && (
              <p className="flex items-center gap-1 text-xs text-destructive">
                <XCircle className="h-3 w-3" />
                Cannot reach agent — ensure it is running
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="opencode-url">OpenCode URL</Label>
            <Input
              id="opencode-url"
              value={opencodeUrl}
              onChange={(e) => setOpencodeUrl(e.target.value)}
              placeholder="http://container.tailnet:3000"
              className="font-mono text-sm"
            />
            {opencodeUrl && !isValidOpencodeUrl && (
              <p className="text-xs text-destructive">Must be a valid URL</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="remote-name" className="text-xs text-muted-foreground">
              Display name (optional)
            </Label>
            <Input
              id="remote-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Remote Workspace"
              className="text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) handleConnect()
              }}
            />
          </div>

          {isValidAgentUrl && isValidOpencodeUrl && (
            <div className="space-y-1.5 rounded-md border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Globe className="h-3 w-3" />
                <span>Will connect to:</span>
              </div>
              <div className="font-mono text-xs break-all">{agentUrl}</div>
              <div className="text-xs text-muted-foreground">
                as{" "}
                <span className="font-medium text-foreground">
                  {name || "Remote Workspace"}
                </span>
              </div>
            </div>
          )}

          <Button
            onClick={handleConnect}
            disabled={connectMutation.isPending || !canSubmit}
            className="w-full"
          >
            {connectMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Globe className="mr-2 h-4 w-4" />
                Connect Workspace
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
