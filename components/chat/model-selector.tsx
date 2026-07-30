"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useModelAllowlist } from "@/hooks/use-settings";
import type { Provider, Model } from "@/lib/opencode/types";

const STORAGE_KEY = "dev-hub:selected-model";

interface SelectedModel {
  providerID: string;
  modelID: string;
}

interface ModelSelectorProps {
  workspaceId: string | null;
  selectedModel: SelectedModel | null;
  onModelChange: (model: SelectedModel) => void;
  onVariantsChange?: (variants: string[]) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface ConfigProvidersResponse {
  providers: Provider[];
  default: Record<string, string>;
}

interface ProviderWithModels {
  provider: Provider;
  models: Model[];
}

export function loadPersistedModel(): SelectedModel | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (
      parsed &&
      typeof parsed === "object" &&
      "providerID" in parsed &&
      "modelID" in parsed &&
      typeof (parsed as SelectedModel).providerID === "string" &&
      typeof (parsed as SelectedModel).modelID === "string"
    ) {
      return parsed as SelectedModel;
    }
  } catch {
    // Corrupted storage
  }
  return null;
}

function persistModel(model: SelectedModel) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
  } catch {
    // Storage full or unavailable
  }
}

export function ModelSelector({
  workspaceId,
  selectedModel,
  onModelChange,
  onVariantsChange,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ModelSelectorProps) {
  const [providers, setProviders] = useState<ProviderWithModels[]>([]);
  const [defaultModels, setDefaultModels] = useState<Record<string, string>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen =
    controlledOnOpenChange !== undefined
      ? controlledOnOpenChange
      : setInternalOpen;
  const { allowlist } = useModelAllowlist();
  const allowlistSet = useMemo(
    () => (allowlist.length > 0 ? new Set(allowlist) : null),
    [allowlist],
  );

  const fetchProviders = useCallback(async () => {
    if (!workspaceId) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ workspaceId });
      const response = await fetch(
        `/api/opencode/config/providers?${params.toString()}`,
      );
      if (!response.ok) return;

      const data: ConfigProvidersResponse = await response.json();
      const providerList: ProviderWithModels[] = data.providers.map(
        (provider) => ({
          provider,
          models: Object.values(provider.models),
        }),
      );
      setProviders(providerList);
      setDefaultModels(data.default ?? {});
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Emit available variants for the currently selected model
  const variantsForSelectedModel = useMemo(() => {
    if (!selectedModel || providers.length === 0) return [];
    const provider = providers.find(
      (p) => p.provider.id === selectedModel.providerID,
    );
    if (!provider) return [];
    const model = provider.models.find((m) => m.id === selectedModel.modelID);
    if (!model) return [];
    const raw = (model as Record<string, unknown>).variants;
    if (!raw || typeof raw !== "object") return [];
    return Object.entries(raw as Record<string, Record<string, unknown>>)
      .filter(([, v]) => !v.disabled)
      .map(([key]) => key);
  }, [selectedModel, providers]);

  useEffect(() => {
    onVariantsChange?.(variantsForSelectedModel);
  }, [variantsForSelectedModel, onVariantsChange]);

  const modelOptions = useMemo(
    () =>
      providers.flatMap((p) =>
        p.models
          .map((m) => ({
            value: `${p.provider.id}::${m.id}`,
            label: m.name || m.id,
            providerName: p.provider.name || p.provider.id,
            providerID: p.provider.id,
            modelID: m.id,
          }))
          .filter((option) => !allowlistSet || allowlistSet.has(option.value)),
      ),
    [allowlistSet, providers],
  );

  const currentValue = selectedModel
    ? `${selectedModel.providerID}::${selectedModel.modelID}`
    : undefined;

  const currentOption = modelOptions.find((o) => o.value === currentValue);

  useEffect(() => {
    if (isLoading || modelOptions.length === 0 || currentOption) return;

    const defaultOption = modelOptions.find(
      (option) =>
        defaultModels[option.providerID] === option.modelID ||
        defaultModels.code === `${option.providerID}/${option.modelID}`,
    );
    const fallbackOption = defaultOption ?? modelOptions[0];
    const fallback = {
      providerID: fallbackOption.providerID,
      modelID: fallbackOption.modelID,
    };
    onModelChange(fallback);
    persistModel(fallback);
  }, [currentOption, defaultModels, isLoading, modelOptions, onModelChange]);

  if (isLoading || modelOptions.length === 0) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1.5 text-xs">
        <ChevronsUpDown className="size-3" />
        {isLoading ? "Loading models..." : "No models"}
      </Button>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={isOpen}
          className="max-w-[160px] min-w-0 shrink gap-1.5 overflow-hidden text-xs md:max-w-[260px]"
        >
          <span className="truncate">
            {currentOption
              ? `${currentOption.providerName} / ${currentOption.label}`
              : "Select model"}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models..." />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            {providers.map((p) => {
              const filteredModels = allowlistSet
                ? p.models.filter((m) =>
                    allowlistSet.has(`${p.provider.id}::${m.id}`),
                  )
                : p.models;
              if (filteredModels.length === 0) return null;
              return (
                <CommandGroup
                  key={p.provider.id}
                  heading={p.provider.name || p.provider.id}
                >
                  {filteredModels.map((m) => {
                    const optionValue = `${p.provider.id}::${m.id}`;
                    const isSelected = currentValue === optionValue;
                    return (
                      <CommandItem
                        key={optionValue}
                        value={`${p.provider.name || p.provider.id} ${m.name || m.id}`}
                        onSelect={() => {
                          const next = {
                            providerID: p.provider.id,
                            modelID: m.id,
                          };
                          onModelChange(next);
                          persistModel(next);
                          setIsOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "size-3",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="truncate">{m.name || m.id}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
