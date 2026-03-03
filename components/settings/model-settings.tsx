"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Loader2, ChevronDown, ChevronRight, Search } from "lucide-react"
import { toast } from "sonner"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useModelAllowlist, useModelAgentBindings, useSettingsMutation, SETTINGS_KEYS } from "@/hooks/use-settings"
import { useAgents } from "@/components/chat/agent-selector"
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

interface ModelSettingsProps {
  workspaceId: string | null
}

export function ModelSettings({ workspaceId }: ModelSettingsProps) {
  const [providers, setProviders] = useState<ProviderWithModels[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = useState(false)
  const { allowlist, isLoading: isLoadingAllowlist } = useModelAllowlist()
  const { bindings, isLoading: isLoadingBindings } = useModelAgentBindings()
  const { primaryAgents, isLoading: isLoadingAgents } = useAgents(workspaceId ?? "")
  const mutation = useSettingsMutation()

  const fetchProviders = useCallback(async () => {
    if (!workspaceId) return
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

  if (!workspaceId) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Select a workspace from the sidebar to configure model settings.
          </p>
        </CardContent>
      </Card>
    )
  }

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
    </div>
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
  const [search, setSearch] = useState("")
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLocal(new Set(allowlist))
  }, [allowlist])

  const isDirty = (() => {
    if (local.size !== allowlist.length) return true
    return allowlist.some((key) => !local.has(key))
  })()

  const filteredProviders = useMemo(() => {
    const query = search.toLowerCase().trim()
    if (!query) return providers
    return providers
      .map((p) => ({
        ...p,
        models: p.models.filter(
          (m) =>
            (m.name || m.id).toLowerCase().includes(query) ||
            p.provider.name?.toLowerCase().includes(query) ||
            p.provider.id.toLowerCase().includes(query)
        ),
      }))
      .filter((p) => p.models.length > 0)
  }, [providers, search])

  const toggleModel = (key: string) => {
    setLocal((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleProvider = (providerWithModels: ProviderWithModels, selectAll: boolean) => {
    setLocal((prev) => {
      const next = new Set(prev)
      for (const model of providerWithModels.models) {
        const key = `${providerWithModels.provider.id}::${model.id}`
        if (selectAll) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  const toggleCollapse = (providerId: string) => {
    setCollapsedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
  }

  const selectedCount = local.size

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>Model Allowlist</CardTitle>
            <CardDescription>
              Select which models appear in the model selector. Leave all unchecked to show everything.
            </CardDescription>
          </div>
          {selectedCount > 0 && (
            <Badge variant="secondary" className="shrink-0 mt-0.5">
              {selectedCount} selected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models..."
            className="pl-8"
          />
        </div>

        {filteredProviders.map((p) => {
          const isCollapsed = collapsedProviders.has(p.provider.id)
          const providerKeys = p.models.map((m) => `${p.provider.id}::${m.id}`)
          const selectedInProvider = providerKeys.filter((k) => local.has(k)).length
          const allSelected = selectedInProvider === providerKeys.length
          const providerLabel = p.provider.name || p.provider.id

          return (
            <div key={p.provider.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => toggleCollapse(p.provider.id)}
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                  {providerLabel}
                  {selectedInProvider > 0 && (
                    <Badge variant="outline" className="text-xs">
                      {selectedInProvider}/{providerKeys.length}
                    </Badge>
                  )}
                </button>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => toggleProvider(p, !allSelected)}
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              </div>

              {!isCollapsed && (
                <div className="space-y-1.5 pl-5">
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
              )}
            </div>
          )
        })}

        {filteredProviders.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {search ? "No models match your search." : "No providers available."}
          </p>
        )}

        <div className="flex justify-end pt-2">
          <Button size="sm" onClick={() => onSave(Array.from(local))} disabled={!isDirty || isSaving}>
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
          const currentValue = bound ? `${bound.providerID}::${bound.modelID}` : "__none__"

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
          <Button size="sm" onClick={() => onSave(local)} disabled={!isDirty || isSaving}>
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
