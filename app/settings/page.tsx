"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useAgents } from "@/components/chat/agent-selector"
import {
  useModelAllowlist,
  useModelAgentBindings,
  useSettingsMutation,
  SETTINGS_KEYS,
} from "@/hooks/use-settings"
import type { Provider, Model, Agent } from "@/lib/opencode/types"

interface ProviderWithModels {
  provider: Provider
  models: Model[]
}

interface ConfigProvidersResponse {
  providers: Provider[]
  default: Record<string, string>
}

interface SelectedModel {
  providerID: string
  modelID: string
}

export default function SettingsPage() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)

  return (
    <AuthenticatedLayout>
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Configure models, agent bindings, and preferences.
            </p>
          </div>

          {activeWorkspaceId ? (
            <ModelSettings workspaceId={activeWorkspaceId} />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">
                  Select a workspace from the sidebar to configure model settings.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AuthenticatedLayout>
  )
}

function ModelSettings({ workspaceId }: { workspaceId: string }) {
  const [providers, setProviders] = useState<ProviderWithModels[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = useState(false)
  const { allowlist, isLoading: isLoadingAllowlist } = useModelAllowlist()
  const { bindings, isLoading: isLoadingBindings } = useModelAgentBindings()
  const { primaryAgents, isLoading: isLoadingAgents } = useAgents(workspaceId)
  const mutation = useSettingsMutation()

  const fetchProviders = useCallback(async () => {
    setIsLoadingProviders(true)
    try {
      const params = new URLSearchParams({ workspaceId })
      const response = await fetch(`/api/opencode/config/providers?${params.toString()}`)
      if (!response.ok) return

      const data: ConfigProvidersResponse = await response.json()
      setProviders(
        data.providers.map((provider) => ({
          provider,
          models: Object.values(provider.models),
        }))
      )
    } catch {
      toast.error("Failed to load providers")
    } finally {
      setIsLoadingProviders(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const isLoading = isLoadingProviders || isLoadingAllowlist || isLoadingBindings || isLoadingAgents

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
    <>
      <AllowlistCard
        providers={providers}
        allowlist={allowlist}
        onSave={(next) =>
          mutation.mutate(
            { key: SETTINGS_KEYS.MODEL_ALLOWLIST, value: next },
            { onSuccess: () => toast.success("Model allowlist updated") }
          )
        }
        isSaving={mutation.isPending}
      />

      <AgentBindingsCard
        agents={primaryAgents}
        providers={providers}
        bindings={bindings}
        onSave={(next) =>
          mutation.mutate(
            { key: SETTINGS_KEYS.MODEL_AGENT_BINDINGS, value: next },
            { onSuccess: () => toast.success("Agent bindings updated") }
          )
        }
        isSaving={mutation.isPending}
      />
    </>
  )
}

function AllowlistCard({
  providers,
  allowlist,
  onSave,
  isSaving,
}: {
  providers: ProviderWithModels[]
  allowlist: string[]
  onSave: (allowlist: string[]) => void
  isSaving: boolean
}) {
  const [local, setLocal] = useState<Set<string>>(() => new Set(allowlist))

  // Sync when server data arrives after initial render
  useEffect(() => {
    setLocal(new Set(allowlist))
  }, [allowlist])

  const isDirty = (() => {
    if (local.size !== allowlist.length) return true
    return allowlist.some((key) => !local.has(key))
  })()

  const toggleModel = (key: string) => {
    setLocal((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const handleSave = () => {
    onSave(Array.from(local))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Allowlist</CardTitle>
        <CardDescription>
          Select which models appear in the model selector. Leave all unchecked to show everything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {providers.map((p) => (
          <div key={p.provider.id} className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              {p.provider.name || p.provider.id}
            </p>
            <div className="space-y-1.5 pl-1">
              {p.models.map((m) => {
                const key = `${p.provider.id}::${m.id}`
                return (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={`allowlist-${key}`}
                      checked={local.has(key)}
                      onCheckedChange={() => toggleModel(key)}
                    />
                    <Label
                      htmlFor={`allowlist-${key}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {m.name || m.id}
                    </Label>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {providers.length === 0 && (
          <p className="text-sm text-muted-foreground">No providers available.</p>
        )}

        <div className="flex justify-end pt-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Saving...
              </>
            ) : (
              "Save allowlist"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function AgentBindingsCard({
  agents,
  providers,
  bindings,
  onSave,
  isSaving,
}: {
  agents: Agent[]
  providers: ProviderWithModels[]
  bindings: Record<string, SelectedModel>
  onSave: (bindings: Record<string, SelectedModel>) => void
  isSaving: boolean
}) {
  const [local, setLocal] = useState<Record<string, SelectedModel>>(() => ({ ...bindings }))

  useEffect(() => {
    setLocal({ ...bindings })
  }, [bindings])

  const isDirty = JSON.stringify(local) !== JSON.stringify(bindings)

  const setBinding = (agentName: string, value: string) => {
    setLocal((prev) => {
      const next = { ...prev }
      if (value === "__none__") {
        delete next[agentName]
      } else {
        const [providerID, modelID] = value.split("::")
        if (providerID && modelID) {
          next[agentName] = { providerID, modelID }
        }
      }
      return next
    })
  }

  const handleSave = () => {
    onSave(local)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent → Model Bindings</CardTitle>
        <CardDescription>
          Automatically switch to a specific model when selecting an agent.
          Leave unset to use the last-selected model.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {agents.map((agent) => {
          const bound = local[agent.name]
          const currentValue = bound
            ? `${bound.providerID}::${bound.modelID}`
            : "__none__"

          return (
            <div key={agent.name} className="flex items-center gap-4">
              <Label className="w-28 shrink-0 text-sm font-medium">
                {agent.name}
              </Label>
              <Select value={currentValue} onValueChange={(v) => setBinding(agent.name, v)}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="No binding (use last selected)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No binding</SelectItem>
                  {providers.map((p) => (
                    <SelectGroup key={p.provider.id}>
                      <SelectLabel>{p.provider.name || p.provider.id}</SelectLabel>
                      {p.models.map((m) => (
                        <SelectItem
                          key={`${p.provider.id}::${m.id}`}
                          value={`${p.provider.id}::${m.id}`}
                        >
                          {m.name || m.id}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        })}

        {agents.length === 0 && (
          <p className="text-sm text-muted-foreground">No agents available.</p>
        )}

        <div className="flex justify-end pt-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                Saving...
              </>
            ) : (
              "Save bindings"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
