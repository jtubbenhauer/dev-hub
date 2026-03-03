"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { ChevronsUpDown, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { useModelAllowlist } from "@/hooks/use-settings"
import type { Provider, Model } from "@/lib/opencode/types"

const STORAGE_KEY = "dev-hub:selected-model"

interface SelectedModel {
  providerID: string
  modelID: string
}

interface ModelSelectorProps {
  workspaceId: string | null
  selectedModel: SelectedModel | null
  onModelChange: (model: SelectedModel) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface ConfigProvidersResponse {
  providers: Provider[]
  default: Record<string, string>
}

interface ProviderWithModels {
  provider: Provider
  models: Model[]
}

interface ModelOption {
  value: string
  label: string
  providerName: string
  providerID: string
  modelID: string
}

export function loadPersistedModel(): SelectedModel | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)
    if (
      parsed &&
      typeof parsed === "object" &&
      "providerID" in parsed &&
      "modelID" in parsed &&
      typeof (parsed as SelectedModel).providerID === "string" &&
      typeof (parsed as SelectedModel).modelID === "string"
    ) {
      return parsed as SelectedModel
    }
  } catch {
    // Corrupted storage
  }
  return null
}

function persistModel(model: SelectedModel) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model))
  } catch {
    // Storage full or unavailable
  }
}

export function ModelSelector({
  workspaceId,
  selectedModel,
  onModelChange,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ModelSelectorProps) {
  const [providers, setProviders] = useState<ProviderWithModels[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [internalOpen, setInternalOpen] = useState(false)
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen
  const setIsOpen = controlledOnOpenChange !== undefined
    ? controlledOnOpenChange
    : setInternalOpen
  const { allowlist } = useModelAllowlist()
  const allowlistSet = allowlist.length > 0 ? new Set(allowlist) : null

  const fetchProviders = useCallback(async () => {
    if (!workspaceId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ workspaceId })
      const response = await fetch(
        `/api/opencode/config/providers?${params.toString()}`
      )
      if (!response.ok) return

      const data: ConfigProvidersResponse = await response.json()
      const providerList: ProviderWithModels[] = data.providers.map(
        (provider) => ({
          provider,
          models: Object.values(provider.models),
        })
      )
      setProviders(providerList)

      if (selectedModelRef.current) {
        // Validate persisted selection still exists
        const isValid = providerList.some((p) =>
          p.provider.id === selectedModelRef.current!.providerID &&
          p.models.some((m) => m.id === selectedModelRef.current!.modelID)
        )
        if (isValid) return
        // Persisted model no longer available — fall through to defaults
      }

      // Fall back to server default
      const defaultModelKey = data.default?.["code"] ?? Object.values(data.default ?? {})[0]
      if (defaultModelKey) {
        const [providerID, modelID] = defaultModelKey.split("/")
        if (providerID && modelID) {
          onModelChange({ providerID, modelID })
          persistModel({ providerID, modelID })
          return
        }
      }

      // Last resort: first available
      const firstProvider = providerList[0]
      if (firstProvider?.models.length > 0) {
        const fallback = {
          providerID: firstProvider.provider.id,
          modelID: firstProvider.models[0].id,
        }
        onModelChange(fallback)
        persistModel(fallback)
      }
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, onModelChange])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const allModelOptions: ModelOption[] = providers.flatMap((p) =>
    p.models.map((m) => ({
      value: `${p.provider.id}::${m.id}`,
      label: m.name || m.id,
      providerName: p.provider.name || p.provider.id,
      providerID: p.provider.id,
      modelID: m.id,
    }))
  )

  // Empty allowlist = show all; non-empty = restrict to listed models
  const modelOptions = allowlistSet
    ? allModelOptions.filter((o) => allowlistSet.has(o.value))
    : allModelOptions

  const currentValue = selectedModel
    ? `${selectedModel.providerID}::${selectedModel.modelID}`
    : undefined

  const currentOption = modelOptions.find((o) => o.value === currentValue)

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
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={isOpen}
          className="max-w-[160px] gap-1.5 text-xs sm:max-w-[260px]"
        >
          <span className="truncate">
            {currentOption
              ? `${currentOption.providerName} / ${currentOption.label}`
              : "Select model"}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="end">
        <Command>
          <CommandInput placeholder="Search models..." />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            {providers.map((p) => {
              const filteredModels = allowlistSet
                ? p.models.filter((m) => allowlistSet.has(`${p.provider.id}::${m.id}`))
                : p.models
              if (filteredModels.length === 0) return null
              return (
                <CommandGroup key={p.provider.id} heading={p.provider.name || p.provider.id}>
                  {filteredModels.map((m) => {
                    const optionValue = `${p.provider.id}::${m.id}`
                    const isSelected = currentValue === optionValue
                    return (
                      <CommandItem
                        key={optionValue}
                        value={`${p.provider.name || p.provider.id} ${m.name || m.id}`}
                        onSelect={() => {
                          const next = { providerID: p.provider.id, modelID: m.id }
                          onModelChange(next)
                          persistModel(next)
                          setIsOpen(false)
                        }}
                      >
                        <Check className={cn("size-3", isSelected ? "opacity-100" : "opacity-0")} />
                        <span className="truncate">{m.name || m.id}</span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
