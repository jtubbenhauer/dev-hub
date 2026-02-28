"use client"

import { useState, useEffect, useCallback } from "react"
import { ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Provider, Model } from "@/lib/opencode/types"

interface SelectedModel {
  providerID: string
  modelID: string
}

interface ModelSelectorProps {
  workspaceId: string | null
  selectedModel: SelectedModel | null
  onModelChange: (model: SelectedModel) => void
}

interface ProviderWithModels {
  provider: Provider
  models: Model[]
}

export function ModelSelector({
  workspaceId,
  selectedModel,
  onModelChange,
}: ModelSelectorProps) {
  const [providers, setProviders] = useState<ProviderWithModels[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const fetchProviders = useCallback(async () => {
    if (!workspaceId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ workspaceId })
      const response = await fetch(
        `/api/opencode/config/providers?${params.toString()}`
      )
      if (!response.ok) return

      const data: Record<string, Provider> = await response.json()
      const providerList: ProviderWithModels[] = Object.values(data).map(
        (provider) => ({
          provider,
          models: Object.values(provider.models),
        })
      )
      setProviders(providerList)

      // Auto-select first model if none selected
      if (!selectedModel && providerList.length > 0) {
        const firstProvider = providerList[0]
        if (firstProvider.models.length > 0) {
          const firstModel = firstProvider.models[0]
          onModelChange({
            providerID: firstProvider.provider.id,
            modelID: firstModel.id,
          })
        }
      }
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, selectedModel, onModelChange])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const modelOptions = providers.flatMap((p) =>
    p.models.map((m) => ({
      value: `${p.provider.id}::${m.id}`,
      label: m.name || m.id,
      providerName: p.provider.name || p.provider.id,
      providerID: p.provider.id,
      modelID: m.id,
    }))
  )

  const currentValue = selectedModel
    ? `${selectedModel.providerID}::${selectedModel.modelID}`
    : undefined

  if (isLoading || modelOptions.length === 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        className="gap-1.5 text-xs"
      >
        <ChevronsUpDown className="size-3" />
        {isLoading ? "Loading models..." : "No models"}
      </Button>
    )
  }

  return (
    <Select
      value={currentValue}
      onValueChange={(value) => {
        const option = modelOptions.find((o) => o.value === value)
        if (option) {
          onModelChange({
            providerID: option.providerID,
            modelID: option.modelID,
          })
        }
      }}
    >
      <SelectTrigger className="h-8 w-auto gap-1.5 text-xs">
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent>
        {modelOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="text-muted-foreground">
              {option.providerName} /
            </span>{" "}
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
