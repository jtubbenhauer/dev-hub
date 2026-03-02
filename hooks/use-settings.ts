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
  VIM_MODE: "vim-mode",
  FONT_SIZE: "font-size",
  MOBILE_FONT_SIZE: "mobile-font-size",
  TAB_SIZE: "tab-size",
  DEFAULT_WORKSPACE: "default-workspace",
  WORKTREE_BASE_DIR: "worktree-base-dir",
  CLONE_BASE_DIR: "clone-base-dir",
  SHELL_RC_PATH: "shell-rc-path",
  CLICKUP_API_TOKEN: "clickup-api-token",
  CLICKUP_TEAM_ID: "clickup-team-id",
  CLICKUP_USER_ID: "clickup-user-id",
} as const

export const FONT_SIZE_OPTIONS = [10, 12, 13, 14, 16] as const
export type FontSize = (typeof FONT_SIZE_OPTIONS)[number]
export const DEFAULT_FONT_SIZE: FontSize = 13

export const MOBILE_FONT_SIZE_OPTIONS = [8, 9, 10, 12, 13, 14] as const
export type MobileFontSize = (typeof MOBILE_FONT_SIZE_OPTIONS)[number]
export const DEFAULT_MOBILE_FONT_SIZE: MobileFontSize = 10

export const TAB_SIZE_OPTIONS = [2, 4] as const
export type TabSize = (typeof TAB_SIZE_OPTIONS)[number]
export const DEFAULT_TAB_SIZE: TabSize = 2

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

export function useVimModeSetting(): {
  isVimMode: boolean
  isLoading: boolean
} {
  const { data, isLoading } = useSettings()
  const raw = data?.[SETTINGS_KEYS.VIM_MODE]
  return { isVimMode: raw === true, isLoading }
}

export function useFontSizeSetting(): {
  fontSize: FontSize
  isLoading: boolean
} {
  const { data, isLoading } = useSettings()
  const raw = data?.[SETTINGS_KEYS.FONT_SIZE]
  const isValid = typeof raw === "number" && (FONT_SIZE_OPTIONS as readonly number[]).includes(raw)
  return { fontSize: isValid ? (raw as FontSize) : DEFAULT_FONT_SIZE, isLoading }
}

export function useMobileFontSizeSetting(): {
  mobileFontSize: MobileFontSize
  isLoading: boolean
} {
  const { data, isLoading } = useSettings()
  const raw = data?.[SETTINGS_KEYS.MOBILE_FONT_SIZE]
  const isValid = typeof raw === "number" && (MOBILE_FONT_SIZE_OPTIONS as readonly number[]).includes(raw)
  return { mobileFontSize: isValid ? (raw as MobileFontSize) : DEFAULT_MOBILE_FONT_SIZE, isLoading }
}

export function useTabSizeSetting(): {
  tabSize: TabSize
  isLoading: boolean
} {
  const { data, isLoading } = useSettings()
  const raw = data?.[SETTINGS_KEYS.TAB_SIZE]
  const isValid = typeof raw === "number" && (TAB_SIZE_OPTIONS as readonly number[]).includes(raw)
  return { tabSize: isValid ? (raw as TabSize) : DEFAULT_TAB_SIZE, isLoading }
}

export function useDefaultWorkspaceSetting(): {
  defaultWorkspaceId: string | null
  isLoading: boolean
} {
  const { data, isLoading } = useSettings()
  const raw = data?.[SETTINGS_KEYS.DEFAULT_WORKSPACE]
  return { defaultWorkspaceId: typeof raw === "string" ? raw : null, isLoading }
}

export function useWorktreeBaseDirSetting(): {
  worktreeBaseDir: string
  isLoading: boolean
} {
  const { data, isLoading } = useSettings()
  const raw = data?.[SETTINGS_KEYS.WORKTREE_BASE_DIR]
  return { worktreeBaseDir: typeof raw === "string" ? raw : "", isLoading }
}

export function useCloneBaseDirSetting(): {
  cloneBaseDir: string
  isLoading: boolean
} {
  const { data, isLoading } = useSettings()
  const raw = data?.[SETTINGS_KEYS.CLONE_BASE_DIR]
  return { cloneBaseDir: typeof raw === "string" ? raw : "~/dev/", isLoading }
}

export function useShellRcPathSetting(): {
  shellRcPath: string
  isLoading: boolean
} {
  const { data, isLoading } = useSettings()
  const raw = data?.[SETTINGS_KEYS.SHELL_RC_PATH]
  return { shellRcPath: typeof raw === "string" ? raw : "~/.zshrc", isLoading }
}

export function useClickUpSettings(): {
  apiToken: string | null
  teamId: string | null
  userId: string | null
  isConfigured: boolean
  isLoading: boolean
} {
  const { data, isLoading } = useSettings()
  const apiToken = typeof data?.[SETTINGS_KEYS.CLICKUP_API_TOKEN] === "string"
    ? (data[SETTINGS_KEYS.CLICKUP_API_TOKEN] as string)
    : null
  const teamId = typeof data?.[SETTINGS_KEYS.CLICKUP_TEAM_ID] === "string"
    ? (data[SETTINGS_KEYS.CLICKUP_TEAM_ID] as string)
    : null
  const userId = data?.[SETTINGS_KEYS.CLICKUP_USER_ID] != null
    ? String(data[SETTINGS_KEYS.CLICKUP_USER_ID])
    : null
  return {
    apiToken,
    teamId,
    userId,
    isConfigured: !!(apiToken && teamId),
    isLoading,
  }
}
