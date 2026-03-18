"use client"

import { useState, useCallback } from "react"
import { Loader2, Plus, Trash2, CheckCircle2, XCircle, Terminal, Pencil } from "lucide-react"
import { toast } from "sonner"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useWorkspaceProviders, useSettingsMutation, SETTINGS_KEYS } from "@/hooks/use-settings"
import type { WorkspaceProvider } from "@/types"

interface ProviderFormState {
  name: string
  binaryPath: string
  createCommand: string
  destroyCommand: string
  statusCommand: string
  shellCommand: string
}

const EMPTY_FORM: ProviderFormState = {
  name: "",
  binaryPath: "",
  createCommand: "{binary} create --repo {repo} --branch {branch}",
  destroyCommand: "{binary} destroy --id {id}",
  statusCommand: "{binary} status --id {id}",
  shellCommand: "",
}

export function ProviderSettings() {
  const { providers, isLoading } = useWorkspaceProviders()
  const mutation = useSettingsMutation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [form, setForm] = useState<ProviderFormState>(EMPTY_FORM)
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "found" | "not-found">("idle")

  const openAddDialog = useCallback(() => {
    setEditingProviderId(null)
    setForm(EMPTY_FORM)
    setTestStatus("idle")
    setDialogOpen(true)
  }, [])

  const openEditDialog = useCallback((provider: WorkspaceProvider) => {
    setEditingProviderId(provider.id)
    setForm({
      name: provider.name,
      binaryPath: provider.binaryPath,
      createCommand: provider.commands.create,
      destroyCommand: provider.commands.destroy,
      statusCommand: provider.commands.status,
      shellCommand: provider.commands.shell ?? "",
    })
    setTestStatus("idle")
    setDialogOpen(true)
  }, [])

  const handleTest = useCallback(async () => {
    if (!form.binaryPath.trim()) return
    setTestStatus("testing")
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ binaryPath: form.binaryPath.trim() }),
      })
      const data = await res.json() as { ok?: boolean }
      setTestStatus(data.ok ? "found" : "not-found")
    } catch {
      setTestStatus("not-found")
    }
  }, [form.binaryPath])

  const handleSave = useCallback(() => {
    const trimmedName = form.name.trim()
    const trimmedBinary = form.binaryPath.trim()
    if (!trimmedName || !trimmedBinary) {
      toast.error("Name and binary path are required")
      return
    }

    const shellCmd = form.shellCommand.trim() || undefined
    const newProvider: WorkspaceProvider = {
      id: editingProviderId ?? crypto.randomUUID(),
      name: trimmedName,
      binaryPath: trimmedBinary,
      commands: {
        create: form.createCommand.trim() || EMPTY_FORM.createCommand,
        destroy: form.destroyCommand.trim() || EMPTY_FORM.destroyCommand,
        status: form.statusCommand.trim() || EMPTY_FORM.statusCommand,
        ...(shellCmd ? { shell: shellCmd } : {}),
      },
    }

    const updatedProviders = editingProviderId
      ? providers.map((p) => (p.id === editingProviderId ? newProvider : p))
      : [...providers, newProvider]

    mutation.mutate(
      { key: SETTINGS_KEYS.WORKSPACE_PROVIDERS, value: updatedProviders },
      {
        onSuccess: () => {
          setDialogOpen(false)
          toast.success(editingProviderId ? `Updated provider "${trimmedName}"` : `Added provider "${trimmedName}"`)
        },
      }
    )
  }, [form, editingProviderId, providers, mutation])

  const handleDelete = useCallback(
    (providerId: string) => {
      const provider = providers.find((p) => p.id === providerId)
      const updatedProviders = providers.filter((p) => p.id !== providerId)
      mutation.mutate(
        { key: SETTINGS_KEYS.WORKSPACE_PROVIDERS, value: updatedProviders },
        {
          onSuccess: () => {
            toast.success(`Removed provider "${provider?.name}"`)
          },
        }
      )
    },
    [providers, mutation]
  )

  const updateField = useCallback(
    <K extends keyof ProviderFormState>(field: K, value: ProviderFormState[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }))
      if (field === "binaryPath") setTestStatus("idle")
    },
    []
  )

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Workspace Providers</CardTitle>
              <CardDescription>
                Register external CLI tools that can create and manage remote
                workspaces (e.g. rig-cli for container-based development).
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={openAddDialog}>
              <Plus className="size-4 mr-1.5" />
              Add Provider
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Terminal className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No providers registered. Add a CLI provider to create remote
                workspaces automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Terminal className="size-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium text-sm">{provider.name}</span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {provider.binaryPath}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      onClick={() => openEditDialog(provider)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(provider.id)}
                      disabled={mutation.isPending}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {editingProviderId ? "Edit Provider" : "Add Provider"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="provider-name">Name</Label>
              <Input
                id="provider-name"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="rig-cli"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="provider-binary">Binary Path</Label>
              <div className="flex gap-2">
                <Input
                  id="provider-binary"
                  value={form.binaryPath}
                  onChange={(e) => updateField("binaryPath", e.target.value)}
                  placeholder="/usr/local/bin/rig"
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={handleTest}
                  disabled={!form.binaryPath.trim() || testStatus === "testing"}
                >
                  {testStatus === "testing" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Test"
                  )}
                </Button>
              </div>
              {testStatus === "found" && (
                <p className="flex items-center gap-1 text-xs text-green-500">
                  <CheckCircle2 className="size-3" />
                  Binary found and executable
                </p>
              )}
              {testStatus === "not-found" && (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <XCircle className="size-3" />
                  Binary not found or not executable
                </p>
              )}
            </div>

            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Command Templates
              </p>
              <p className="text-xs text-muted-foreground">
                Available placeholders: <code className="text-foreground">{"{binary}"}</code>,{" "}
                <code className="text-foreground">{"{repo}"}</code>,{" "}
                <code className="text-foreground">{"{branch}"}</code>,{" "}
                <code className="text-foreground">{"{name}"}</code>,{" "}
                <code className="text-foreground">{"{id}"}</code>,{" "}
                <code className="text-foreground">{"{context}"}</code>
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="cmd-create" className="text-xs">
                  Create
                </Label>
                <Input
                  id="cmd-create"
                  value={form.createCommand}
                  onChange={(e) => updateField("createCommand", e.target.value)}
                  placeholder="{binary} create --repo {repo} --branch {branch}"
                  className="font-mono text-xs h-8"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cmd-destroy" className="text-xs">
                  Destroy
                </Label>
                <Input
                  id="cmd-destroy"
                  value={form.destroyCommand}
                  onChange={(e) => updateField("destroyCommand", e.target.value)}
                  placeholder="{binary} destroy --id {id}"
                  className="font-mono text-xs h-8"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cmd-status" className="text-xs">
                  Status
                </Label>
                <Input
                  id="cmd-status"
                  value={form.statusCommand}
                  onChange={(e) => updateField("statusCommand", e.target.value)}
                  placeholder="{binary} status --id {id}"
                  className="font-mono text-xs h-8"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cmd-shell" className="text-xs">
                  Shell (optional)
                </Label>
                <Input
                  id="cmd-shell"
                  value={form.shellCommand}
                  onChange={(e) => updateField("shellCommand", e.target.value)}
                  placeholder="{binary} exec --id {id} sh"
                  className="font-mono text-xs h-8"
                />
                <p className="text-xs text-muted-foreground">
                  Command to open a terminal session. Leave blank to disable terminal access.
                </p>
              </div>
            </div>

            <Button
              onClick={handleSave}
              disabled={mutation.isPending || !form.name.trim() || !form.binaryPath.trim()}
              className="w-full"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : editingProviderId ? (
                "Update Provider"
              ) : (
                "Add Provider"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
