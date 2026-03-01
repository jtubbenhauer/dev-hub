"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

interface SelectedModel {
  providerID: string
  modelID: string
}

// Settings key constants
export const SETTINGS_KEYS = {
  MODEL_ALLOWLIST: "model-allowlist",
  MODEL_AGENT_BINDINGS: "model-agent-bindings",
} as const

// "providerID::modelID" format
export type ModelAllowlist = string[]
export type ModelAgentBindings = Record<string, SelectedModel>

type SettingsMap = Record<string, unknown>

async function fetchSettings(): Promise<SettingsMap> {
  const res = await fetch("/api/settings")
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || "Failed to fetch settings")
  }
  return res.json()
}

async function putSetting(key: string, value: unknown): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || "Failed to save setting")
  }
}

export function useSettings() {
  return useQuery<SettingsMap>({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  })
}

export function useSettingsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      putSetting(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] })
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}

export function useModelAllowlist(): {
  allowlist: ModelAllowlist
  isLoading: boolean
} {
  const { data, isLoading } = useSettings()
  const raw = data?.[SETTINGS_KEYS.MODEL_ALLOWLIST]
  const allowlist = Array.isArray(raw) ? (raw as ModelAllowlist) : []
  return { allowlist, isLoading }
}

export function useModelAgentBindings(): {
  bindings: ModelAgentBindings
  isLoading: boolean
} {
  const { data, isLoading } = useSettings()
  const raw = data?.[SETTINGS_KEYS.MODEL_AGENT_BINDINGS]
  const bindings =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as ModelAgentBindings)
      : {}
  return { bindings, isLoading }
}
