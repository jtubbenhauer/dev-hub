"use client"

import { useState, useCallback, useMemo } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Terminal, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useWorkspaceProviders } from "@/hooks/use-settings"

export function CreateProviderWorkspaceDialog() {
  const queryClient = useQueryClient()
  const { providers } = useWorkspaceProviders()
  const [open, setOpen] = useState(false)
  const [providerId, setProviderId] = useState("")
  const [repo, setRepo] = useState("")
  const [branch, setBranch] = useState("")
  const [name, setName] = useState("")
  const [context, setContext] = useState("")

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId]
  )

  const canSubmit = !!providerId && !!repo.trim()

  const createMutation = useMutation({
    mutationFn: async (data: {
      providerId: string
      repo: string
      branch?: string
      name?: string
      context?: string
    }) => {
      const res = await fetch("/api/providers/create-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error || "Failed to create workspace")
      }
      return res.json()
    },
    onSuccess: (workspace) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      setOpen(false)
      resetState()
      toast.success(`Created workspace "${workspace.name}" via ${selectedProvider?.name}`)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  function handleCreate() {
    if (!canSubmit) return
    createMutation.mutate({
      providerId,
      repo: repo.trim(),
      branch: branch.trim() || undefined,
      name: name.trim() || undefined,
      context: context.trim() || undefined,
    })
  }

  function resetState() {
    setProviderId("")
    setRepo("")
    setBranch("")
    setName("")
    setContext("")
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && canSubmit && !createMutation.isPending) handleCreate()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canSubmit, createMutation.isPending, providerId, repo, branch, name, context]
  )

  if (providers.length === 0) return null

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
          <Terminal className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">Create via Provider</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Workspace via Provider</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="provider-select">Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger id="provider-select">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-repo">Repository URL</Label>
            <Input
              id="provider-repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="https://github.com/org/repo.git"
              className="font-mono text-sm"
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-branch" className="text-xs text-muted-foreground">
              Branch (optional, defaults to main)
            </Label>
            <Input
              id="provider-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="text-sm"
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-name" className="text-xs text-muted-foreground">
              Display name (optional)
            </Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Derived from repo URL"
              className="text-sm"
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="provider-context" className="text-xs text-muted-foreground">
              Extra context (optional)
            </Label>
            <Input
              id="provider-context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Docker context, env vars, etc."
              className="text-sm"
              onKeyDown={handleKeyDown}
            />
          </div>

          {selectedProvider && repo.trim() && (
            <div className="space-y-1.5 rounded-md border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Terminal className="size-3" />
                <span>Will run:</span>
              </div>
              <p className="font-mono text-xs break-all">
                {selectedProvider.commands.create
                  .replaceAll("{binary}", selectedProvider.binaryPath)
                  .replaceAll("{repo}", repo.trim())
                  .replaceAll("{branch}", branch.trim() || "main")
                  .replaceAll("{name}", name.trim() || repo.split("/").pop()?.replace(/\.git$/, "") || "workspace")
                  .replaceAll("{context}", context.trim())}
              </p>
            </div>
          )}

          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending || !canSubmit}
            className="w-full"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating workspace...
              </>
            ) : (
              <>
                <Terminal className="mr-2 h-4 w-4" />
                Create Workspace
              </>
            )}
          </Button>

          {createMutation.isPending && (
            <p className="text-center text-xs text-muted-foreground">
              This may take a minute while the container starts up...
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
