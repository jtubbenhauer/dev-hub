"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type {
  LeaderBindingsMap,
  ActivationKeyConfig,
} from "@/types/leader-key";
import { DEFAULT_LEADER_BINDINGS } from "@/lib/leader-key-defaults";
import {
  DEFAULT_ACTIVATION_KEY,
  isValidActivationKeyConfig,
} from "@/lib/leader-key-utils";
import { DEFAULT_SOUND_SETTINGS } from "@/lib/sounds";
import type { WorkspaceProvider } from "@/types";

interface SelectedModel {
  providerID: string;
  modelID: string;
}

// Settings key constants
export const SETTINGS_KEYS = {
  MODEL_ALLOWLIST: "model-allowlist",
  MODEL_AGENT_BINDINGS: "model-agent-bindings",

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
  GITHUB_API_TOKEN: "github-api-token",
  LEADER_KEY_BINDINGS: "leader-key-bindings",
  LEADER_WHICH_KEY: "leader-which-key",
  CLICKUP_PINNED_VIEWS: "clickup-pinned-views",
  WORKSPACE_PROVIDERS: "workspace-providers",
  LEADER_TIMEOUT: "leader-timeout",
  LEADER_ACTIVATION_KEY: "leader-activation-key",
  THEME: "theme",
  SOUND_AGENT_ENABLED: "sound-agent-enabled",
  SOUND_AGENT_ID: "sound-agent-id",
  SOUND_PERMISSIONS_ENABLED: "sound-permissions-enabled",
  SOUND_PERMISSIONS_ID: "sound-permissions-id",
  SOUND_ERRORS_ENABLED: "sound-errors-enabled",
  SOUND_ERRORS_ID: "sound-errors-id",
  EDITOR_TYPE: "editor-type",
  NVIM_APPNAME: "nvim-appname",
  AUTO_COLOR_WORKSPACES: "auto-color-workspaces",
  PANEL_NAVIGATION: "panel-navigation", // deprecated — panel nav removed
  TERMINAL_SCROLLBACK: "terminal-scrollback",
  TERMINAL_FONT: "terminal-font",
  DISABLE_FILE_TABS: "disable-file-tabs",
  NOTIFICATIONS_SOUND_ENABLED: "notifications-sound-enabled",
  NOTIFICATIONS_PUSH_ENABLED: "notifications-push-enabled",
} as const;

export type EditorType = "monaco" | "neovim";
export const EDITOR_TYPE_OPTIONS: EditorType[] = ["monaco", "neovim"];
export const DEFAULT_EDITOR_TYPE: EditorType = "monaco";

export type NvimAppName = "devhub" | "personal" | string;
export const DEFAULT_NVIM_APPNAME: NvimAppName = "devhub";

export const FONT_SIZE_OPTIONS = [10, 12, 13, 14, 16] as const;
export type FontSize = (typeof FONT_SIZE_OPTIONS)[number];
export const DEFAULT_FONT_SIZE: FontSize = 13;

export type AppTheme =
  | "system"
  | "default-dark"
  | "default-light"
  | "catppuccin-latte"
  | "catppuccin-frappe"
  | "catppuccin-macchiato"
  | "catppuccin-mocha"
  | "dracula"
  | "github-dark";

export const APP_THEMES: Array<{
  value: AppTheme;
  label: string;
  isDark: boolean;
  flavorClass: string | null;
}> = [
  { value: "system", label: "System", isDark: true, flavorClass: null },
  {
    value: "default-dark",
    label: "Default Dark",
    isDark: true,
    flavorClass: null,
  },
  {
    value: "default-light",
    label: "Default Light",
    isDark: false,
    flavorClass: null,
  },
  {
    value: "catppuccin-latte",
    label: "Catppuccin Latte",
    isDark: false,
    flavorClass: "catppuccin-latte",
  },
  {
    value: "catppuccin-frappe",
    label: "Catppuccin Frappé",
    isDark: true,
    flavorClass: "catppuccin-frappe",
  },
  {
    value: "catppuccin-macchiato",
    label: "Catppuccin Macchiato",
    isDark: true,
    flavorClass: "catppuccin-macchiato",
  },
  {
    value: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    isDark: true,
    flavorClass: "catppuccin-mocha",
  },
  { value: "dracula", label: "Dracula", isDark: true, flavorClass: "dracula" },
  {
    value: "github-dark",
    label: "GitHub Dark",
    isDark: true,
    flavorClass: "github-dark",
  },
];

export const MOBILE_FONT_SIZE_OPTIONS = [8, 9, 10, 12, 13, 14] as const;
export type MobileFontSize = (typeof MOBILE_FONT_SIZE_OPTIONS)[number];
export const DEFAULT_MOBILE_FONT_SIZE: MobileFontSize = 10;

export const TAB_SIZE_OPTIONS = [2, 4] as const;
export type TabSize = (typeof TAB_SIZE_OPTIONS)[number];
export const DEFAULT_TAB_SIZE: TabSize = 2;

// "providerID::modelID" format
export type ModelAllowlist = string[];
export type ModelAgentBindings = Record<string, SelectedModel>;

type SettingsMap = Record<string, unknown>;

async function fetchSettings(): Promise<SettingsMap> {
  const res = await fetch("/api/settings");
  if (!res.ok) {
    let message = `Failed to fetch settings (${res.status})`;
    try {
      const err = await res.json();
      if (err.error) message = err.error;
    } catch {
      // Response body is not JSON (e.g. HTML error page or redirect)
    }
    throw new Error(message);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // Server returned a non-JSON response (e.g. auth redirect to login page)
    throw new Error("Session expired — please refresh the page");
  }
  return res.json();
}

async function putSetting(key: string, value: unknown): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) {
    let message = `Failed to save setting (${res.status})`;
    try {
      const err = await res.json();
      if (err.error) message = err.error;
    } catch {
      // Response body is not JSON (e.g. HTML error page or server crash)
    }
    throw new Error(message);
  }
}

export function useSettings() {
  return useQuery<SettingsMap>({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });
}

export function useSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      putSetting(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useModelAllowlist(): {
  allowlist: ModelAllowlist;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.MODEL_ALLOWLIST];
  const allowlist = Array.isArray(raw) ? (raw as ModelAllowlist) : [];
  return { allowlist, isLoading };
}

export function useModelAgentBindings(): {
  bindings: ModelAgentBindings;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.MODEL_AGENT_BINDINGS];
  const bindings = useMemo(
    () =>
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as ModelAgentBindings)
        : {},
    [raw],
  );
  return { bindings, isLoading };
}

export function useFontSizeSetting(): {
  fontSize: FontSize;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.FONT_SIZE];
  const isValid =
    typeof raw === "number" &&
    (FONT_SIZE_OPTIONS as readonly number[]).includes(raw);
  return {
    fontSize: isValid ? (raw as FontSize) : DEFAULT_FONT_SIZE,
    isLoading,
  };
}

export function useMobileFontSizeSetting(): {
  mobileFontSize: MobileFontSize;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.MOBILE_FONT_SIZE];
  const isValid =
    typeof raw === "number" &&
    (MOBILE_FONT_SIZE_OPTIONS as readonly number[]).includes(raw);
  return {
    mobileFontSize: isValid
      ? (raw as MobileFontSize)
      : DEFAULT_MOBILE_FONT_SIZE,
    isLoading,
  };
}

export function useTabSizeSetting(): {
  tabSize: TabSize;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.TAB_SIZE];
  const isValid =
    typeof raw === "number" &&
    (TAB_SIZE_OPTIONS as readonly number[]).includes(raw);
  return { tabSize: isValid ? (raw as TabSize) : DEFAULT_TAB_SIZE, isLoading };
}

export function useDefaultWorkspaceSetting(): {
  defaultWorkspaceId: string | null;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.DEFAULT_WORKSPACE];
  return {
    defaultWorkspaceId: typeof raw === "string" ? raw : null,
    isLoading,
  };
}

export function useWorktreeBaseDirSetting(): {
  worktreeBaseDir: string;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.WORKTREE_BASE_DIR];
  return { worktreeBaseDir: typeof raw === "string" ? raw : "", isLoading };
}

export function useCloneBaseDirSetting(): {
  cloneBaseDir: string;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.CLONE_BASE_DIR];
  return { cloneBaseDir: typeof raw === "string" ? raw : "~/dev/", isLoading };
}

export function useShellRcPathSetting(): {
  shellRcPath: string;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.SHELL_RC_PATH];
  return { shellRcPath: typeof raw === "string" ? raw : "~/.zshrc", isLoading };
}

export function useClickUpSettings(): {
  apiToken: string | null;
  teamId: string | null;
  userId: string | null;
  isConfigured: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const apiToken =
    typeof data?.[SETTINGS_KEYS.CLICKUP_API_TOKEN] === "string"
      ? (data[SETTINGS_KEYS.CLICKUP_API_TOKEN] as string)
      : null;
  const teamId =
    typeof data?.[SETTINGS_KEYS.CLICKUP_TEAM_ID] === "string"
      ? (data[SETTINGS_KEYS.CLICKUP_TEAM_ID] as string)
      : null;
  const userId =
    data?.[SETTINGS_KEYS.CLICKUP_USER_ID] != null
      ? String(data[SETTINGS_KEYS.CLICKUP_USER_ID])
      : null;
  return {
    apiToken,
    teamId,
    userId,
    isConfigured: !!(apiToken && teamId),
    isLoading,
  };
}

export function useLeaderKeyBindings(): {
  bindings: LeaderBindingsMap;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.LEADER_KEY_BINDINGS];
  const stored =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as LeaderBindingsMap)
      : {};
  // Merge stored overrides on top of defaults (memoize to keep a stable reference)
  const bindings: LeaderBindingsMap = useMemo(
    () => ({ ...DEFAULT_LEADER_BINDINGS, ...stored }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(stored)],
  );
  return { bindings, isLoading };
}

export const DEFAULT_LEADER_TIMEOUT = 2;

export function useLeaderTimeoutSetting(): {
  /** Seconds before auto-cancel, or null for "never hide" */
  leaderTimeout: number | null;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.LEADER_TIMEOUT];
  if (raw === null) return { leaderTimeout: null, isLoading };
  if (typeof raw === "number" && raw > 0)
    return { leaderTimeout: raw, isLoading };
  return { leaderTimeout: DEFAULT_LEADER_TIMEOUT, isLoading };
}

export function useLeaderWhichKeySetting(): {
  isWhichKeyEnabled: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.LEADER_WHICH_KEY];
  // Default: true (which-key popup is on by default)
  return { isWhichKeyEnabled: raw !== false, isLoading };
}

export function useLeaderActivationKey(): {
  activationKey: ActivationKeyConfig;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.LEADER_ACTIVATION_KEY];
  const activationKey = isValidActivationKeyConfig(raw)
    ? raw
    : DEFAULT_ACTIVATION_KEY;
  return { activationKey, isLoading };
}

export function useGitHubSettings(): {
  apiToken: string | null;
  isConfigured: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const apiToken =
    typeof data?.[SETTINGS_KEYS.GITHUB_API_TOKEN] === "string"
      ? (data[SETTINGS_KEYS.GITHUB_API_TOKEN] as string)
      : null;
  return {
    apiToken,
    isConfigured: !!apiToken,
    isLoading,
  };
}

function isWorkspaceProvider(value: unknown): value is WorkspaceProvider {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.binaryPath === "string" &&
    typeof obj.commands === "object" &&
    obj.commands !== null &&
    typeof (obj.commands as Record<string, unknown>).create === "string" &&
    typeof (obj.commands as Record<string, unknown>).destroy === "string" &&
    typeof (obj.commands as Record<string, unknown>).status === "string"
  );
}

export function useWorkspaceProviders(): {
  providers: WorkspaceProvider[];
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.WORKSPACE_PROVIDERS];
  const providers = Array.isArray(raw) ? raw.filter(isWorkspaceProvider) : [];
  return { providers, isLoading };
}

export function useThemeSetting(): { theme: AppTheme; isLoading: boolean } {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.THEME];
  const isValid =
    typeof raw === "string" && APP_THEMES.some((t) => t.value === raw);
  return { theme: isValid ? (raw as AppTheme) : "system", isLoading };
}

export function useSoundSettings(): {
  agentEnabled: boolean;
  agentSoundId: string;
  permissionsEnabled: boolean;
  permissionsSoundId: string;
  errorsEnabled: boolean;
  errorsSoundId: string;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const agentEnabled = data?.[SETTINGS_KEYS.SOUND_AGENT_ENABLED] === true;
  const agentSoundId =
    typeof data?.[SETTINGS_KEYS.SOUND_AGENT_ID] === "string"
      ? (data[SETTINGS_KEYS.SOUND_AGENT_ID] as string)
      : DEFAULT_SOUND_SETTINGS.agentSoundId;
  const permissionsEnabled =
    data?.[SETTINGS_KEYS.SOUND_PERMISSIONS_ENABLED] === true;
  const permissionsSoundId =
    typeof data?.[SETTINGS_KEYS.SOUND_PERMISSIONS_ID] === "string"
      ? (data[SETTINGS_KEYS.SOUND_PERMISSIONS_ID] as string)
      : DEFAULT_SOUND_SETTINGS.permissionsSoundId;
  const errorsEnabled = data?.[SETTINGS_KEYS.SOUND_ERRORS_ENABLED] === true;
  const errorsSoundId =
    typeof data?.[SETTINGS_KEYS.SOUND_ERRORS_ID] === "string"
      ? (data[SETTINGS_KEYS.SOUND_ERRORS_ID] as string)
      : DEFAULT_SOUND_SETTINGS.errorsSoundId;
  return {
    agentEnabled,
    agentSoundId,
    permissionsEnabled,
    permissionsSoundId,
    errorsEnabled,
    errorsSoundId,
    isLoading,
  };
}

export function useEditorTypeSetting(): {
  editorType: EditorType;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.EDITOR_TYPE];
  const isValid =
    typeof raw === "string" && EDITOR_TYPE_OPTIONS.includes(raw as EditorType);
  return {
    editorType: isValid ? (raw as EditorType) : DEFAULT_EDITOR_TYPE,
    isLoading,
  };
}

export function useNvimAppNameSetting(): {
  nvimAppName: NvimAppName;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.NVIM_APPNAME];
  return {
    nvimAppName:
      typeof raw === "string" && raw.length > 0 ? raw : DEFAULT_NVIM_APPNAME,
    isLoading,
  };
}

export function useAutoColorSetting(): {
  isAutoColorEnabled: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.AUTO_COLOR_WORKSPACES];
  // Default: true (auto-color is on by default)
  return { isAutoColorEnabled: raw !== false, isLoading };
}

export const DEFAULT_TERMINAL_SCROLLBACK = 5000;
export const TERMINAL_SCROLLBACK_OPTIONS = [
  1000, 2000, 5000, 10000, 25000, 50000,
] as const;

export function useTerminalScrollbackSetting(): {
  scrollback: number;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.TERMINAL_SCROLLBACK];
  const isValid = typeof raw === "number" && raw > 0;
  return { scrollback: isValid ? raw : DEFAULT_TERMINAL_SCROLLBACK, isLoading };
}

export type TerminalFont = "geist-mono" | "ibm-plex-mono-nerd";
export const TERMINAL_FONT_OPTIONS: Array<{
  value: TerminalFont;
  label: string;
  fontFamily: string;
}> = [
  {
    value: "geist-mono",
    label: "Geist Mono",
    fontFamily: "var(--font-geist-mono), monospace",
  },
  {
    value: "ibm-plex-mono-nerd",
    label: "IBM Plex Mono Nerd Font",
    fontFamily: "BlexMonoNerdFontMono, monospace",
  },
];
export const DEFAULT_TERMINAL_FONT: TerminalFont = "geist-mono";

export function terminalFontFamily(font: TerminalFont): string {
  return (
    TERMINAL_FONT_OPTIONS.find((o) => o.value === font)?.fontFamily ??
    TERMINAL_FONT_OPTIONS[0].fontFamily
  );
}

export function useTerminalFontSetting(): {
  terminalFont: TerminalFont;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.TERMINAL_FONT];
  const isValid =
    typeof raw === "string" &&
    TERMINAL_FONT_OPTIONS.some((o) => o.value === raw);
  return {
    terminalFont: isValid ? (raw as TerminalFont) : DEFAULT_TERMINAL_FONT,
    isLoading,
  };
}

export function useFileTabsSetting(): {
  isFileTabsDisabled: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.DISABLE_FILE_TABS];
  return { isFileTabsDisabled: raw === true, isLoading };
}

export function useNotificationSettings(): {
  isSoundEnabled: boolean;
  isPushEnabled: boolean;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const isSoundEnabled =
    data?.[SETTINGS_KEYS.NOTIFICATIONS_SOUND_ENABLED] !== false;
  const isPushEnabled =
    data?.[SETTINGS_KEYS.NOTIFICATIONS_PUSH_ENABLED] !== false;
  return { isSoundEnabled, isPushEnabled, isLoading };
}
