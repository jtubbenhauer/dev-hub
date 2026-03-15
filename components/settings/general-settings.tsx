"use client"

import { useState, useEffect, useRef } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
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
import { Switch } from "@/components/ui/switch"
import { useEditorStore } from "@/stores/editor-store"
import {
  useVimModeSetting,
  useFontSizeSetting,
  useMobileFontSizeSetting,
  useTabSizeSetting,
  useShellRcPathSetting,
  useSettingsMutation,
  useSoundSettings,
  SETTINGS_KEYS,
  FONT_SIZE_OPTIONS,
  MOBILE_FONT_SIZE_OPTIONS,
  TAB_SIZE_OPTIONS,
  DEFAULT_FONT_SIZE,
  DEFAULT_MOBILE_FONT_SIZE,
  DEFAULT_TAB_SIZE,
  APP_THEMES,
} from "@/hooks/use-settings"
import type { FontSize, MobileFontSize, TabSize, AppTheme } from "@/hooks/use-settings"
import { useTheme } from "@/components/providers/theme-provider"
import { SOUND_OPTIONS, soundSrc, playSound } from "@/lib/sounds"

export function GeneralSettings() {
  return (
    <div className="space-y-6">
      <AppearanceSettingsCard />
      <EditorSettingsCard />
      <CommandSettingsCard />
      <SoundSettingsCard />
    </div>
  )
}

const THEME_SWATCHES: Record<AppTheme, { bg: string; accent: string }> = {
  system: { bg: "linear-gradient(135deg, #1e1e2e 50%, #eff1f5 50%)", accent: "#cba6f7" },
  "default-dark": { bg: "#1a1a1a", accent: "#a0a0a0" },
  "default-light": { bg: "#f5f5f5", accent: "#333333" },
  "catppuccin-latte": { bg: "#eff1f5", accent: "#8839ef" },
  "catppuccin-frappe": { bg: "#303446", accent: "#ca9ee6" },
  "catppuccin-macchiato": { bg: "#24273a", accent: "#c6a0f6" },
  "catppuccin-mocha": { bg: "#1e1e2e", accent: "#cba6f7" },
  dracula: { bg: "#282a36", accent: "#bd93f9" },
}

function AppearanceSettingsCard() {
  const { theme: currentTheme, setTheme } = useTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Choose your color theme</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {APP_THEMES.map((t) => {
            const isActive = currentTheme === t.value
            const swatch = THEME_SWATCHES[t.value]
            return (
              <button
                key={t.value}
                data-testid={`theme-${t.value}`}
                onClick={() => setTheme(t.value)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors hover:bg-accent/50 ${
                  isActive ? "border-primary ring-2 ring-primary/30" : "border-border"
                }`}
              >
                <div
                  className="h-10 w-full rounded-md border border-border/50"
                  style={{ background: swatch.bg }}
                >
                  <div
                    className="ml-2 mt-2 h-3 w-3 rounded-full"
                    style={{ background: swatch.accent }}
                  />
                </div>
                <span className="font-medium truncate max-w-full">{t.label}</span>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function EditorSettingsCard() {
  const { isVimMode, isLoading: isLoadingVim } = useVimModeSetting()
  const { fontSize, isLoading: isLoadingFont } = useFontSizeSetting()
  const { mobileFontSize, isLoading: isLoadingMobileFont } = useMobileFontSizeSetting()
  const { tabSize, isLoading: isLoadingTab } = useTabSizeSetting()
  const setVimMode = useEditorStore((s) => s.setVimMode)
  const mutation = useSettingsMutation()

  const isLoading = isLoadingVim || isLoadingFont || isLoadingMobileFont || isLoadingTab

  useEffect(() => {
    if (!isLoadingVim) {
      setVimMode(isVimMode)
    }
  }, [isVimMode, isLoadingVim, setVimMode])

  const handleVimToggle = (checked: boolean) => {
    setVimMode(checked)
    mutation.mutate(
      { key: SETTINGS_KEYS.VIM_MODE, value: checked },
      { onSuccess: () => toast.success(checked ? "Vim mode enabled" : "Vim mode disabled") }
    )
  }

  const handleFontSizeChange = (value: string) => {
    const next = Number(value) as FontSize
    mutation.mutate(
      { key: SETTINGS_KEYS.FONT_SIZE, value: next },
      { onSuccess: () => toast.success(`Font size set to ${next}px`) }
    )
  }

  const handleMobileFontSizeChange = (value: string) => {
    const next = Number(value) as MobileFontSize
    mutation.mutate(
      { key: SETTINGS_KEYS.MOBILE_FONT_SIZE, value: next },
      { onSuccess: () => toast.success(`Mobile font size set to ${next}px`) }
    )
  }

  const handleTabSizeChange = (value: string) => {
    const next = Number(value) as TabSize
    mutation.mutate(
      { key: SETTINGS_KEYS.TAB_SIZE, value: next },
      { onSuccess: () => toast.success(`Tab size set to ${next} spaces`) }
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
    <Card>
      <CardHeader>
        <CardTitle>Editor</CardTitle>
        <CardDescription>
          Configure the code editor behavior and appearance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="vim-mode">Vim mode</Label>
            <p className="text-xs text-muted-foreground">
              Enable Vim keybindings in the code editor
            </p>
          </div>
          <Switch
            id="vim-mode"
            checked={isVimMode}
            onCheckedChange={handleVimToggle}
            disabled={mutation.isPending}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="font-size">Font size</Label>
            <p className="text-xs text-muted-foreground">
              Editor font size in pixels
            </p>
          </div>
          <Select
            value={String(fontSize)}
            onValueChange={handleFontSizeChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="font-size" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}px{size === DEFAULT_FONT_SIZE ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="mobile-font-size">Mobile font size</Label>
            <p className="text-xs text-muted-foreground">
              Editor font size on mobile devices
            </p>
          </div>
          <Select
            value={String(mobileFontSize)}
            onValueChange={handleMobileFontSizeChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="mobile-font-size" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MOBILE_FONT_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}px{size === DEFAULT_MOBILE_FONT_SIZE ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="tab-size">Tab size</Label>
            <p className="text-xs text-muted-foreground">
              Number of spaces per tab
            </p>
          </div>
          <Select
            value={String(tabSize)}
            onValueChange={handleTabSizeChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="tab-size" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAB_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} spaces{size === DEFAULT_TAB_SIZE ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}

function CommandSettingsCard() {
  const { shellRcPath, isLoading } = useShellRcPathSetting()
  const mutation = useSettingsMutation()
  const [localPath, setLocalPath] = useState("")

  useEffect(() => {
    if (!isLoading) setLocalPath(shellRcPath)
  }, [shellRcPath, isLoading])

  const handleSave = () => {
    mutation.mutate(
      { key: SETTINGS_KEYS.SHELL_RC_PATH, value: localPath },
      { onSuccess: () => toast.success("Shell RC path updated") }
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
    <Card>
      <CardHeader>
        <CardTitle>Commands</CardTitle>
        <CardDescription>
          Configure command runner and shell integration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="shell-rc-path">Shell RC file path</Label>
          <p className="text-xs text-muted-foreground">
            Path to your shell config file for alias parsing in command autocomplete
          </p>
          <div className="flex gap-2">
            <Input
              id="shell-rc-path"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="~/.zshrc"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSave}
              disabled={localPath === shellRcPath || mutation.isPending}
            >
              Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const SOUND_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "alerts", label: "Alerts" },
  { key: "bip-bops", label: "Bip Bops" },
  { key: "staplebops", label: "Staplebops" },
  { key: "nopes", label: "Nopes" },
  { key: "yups", label: "Yups" },
]

export function SoundSettingsCard() {
  const {
    agentEnabled,
    agentSoundId,
    permissionsEnabled,
    permissionsSoundId,
    errorsEnabled,
    errorsSoundId,
    isLoading,
  } = useSoundSettings()
  const mutation = useSettingsMutation()
  const previewCleanupRef = useRef<(() => void) | undefined>(undefined)

  const playPreview = (soundId: string) => {
    if (previewCleanupRef.current) {
      previewCleanupRef.current()
      previewCleanupRef.current = undefined
    }
    setTimeout(() => {
      previewCleanupRef.current = playSound(soundSrc(soundId)) ?? undefined
    }, 100)
  }

  const handleAgentSelect = (value: string) => {
    if (value === "none") {
      mutation.mutate(
        { key: SETTINGS_KEYS.SOUND_AGENT_ENABLED, value: false },
        { onSuccess: () => toast.success("Agent sound updated") }
      )
    } else {
      mutation.mutate({ key: SETTINGS_KEYS.SOUND_AGENT_ENABLED, value: true })
      mutation.mutate(
        { key: SETTINGS_KEYS.SOUND_AGENT_ID, value },
        { onSuccess: () => toast.success("Agent sound updated") }
      )
      playPreview(value)
    }
  }

  const handlePermissionsSelect = (value: string) => {
    if (value === "none") {
      mutation.mutate(
        { key: SETTINGS_KEYS.SOUND_PERMISSIONS_ENABLED, value: false },
        { onSuccess: () => toast.success("Permissions sound updated") }
      )
    } else {
      mutation.mutate({ key: SETTINGS_KEYS.SOUND_PERMISSIONS_ENABLED, value: true })
      mutation.mutate(
        { key: SETTINGS_KEYS.SOUND_PERMISSIONS_ID, value },
        { onSuccess: () => toast.success("Permissions sound updated") }
      )
      playPreview(value)
    }
  }

  const handleErrorsSelect = (value: string) => {
    if (value === "none") {
      mutation.mutate(
        { key: SETTINGS_KEYS.SOUND_ERRORS_ENABLED, value: false },
        { onSuccess: () => toast.success("Errors sound updated") }
      )
    } else {
      mutation.mutate({ key: SETTINGS_KEYS.SOUND_ERRORS_ENABLED, value: true })
      mutation.mutate(
        { key: SETTINGS_KEYS.SOUND_ERRORS_ID, value },
        { onSuccess: () => toast.success("Errors sound updated") }
      )
      playPreview(value)
    }
  }

  const handleAgentToggle = (checked: boolean) => {
    mutation.mutate(
      { key: SETTINGS_KEYS.SOUND_AGENT_ENABLED, value: checked },
      { onSuccess: () => toast.success(checked ? "Agent sound enabled" : "Agent sound disabled") }
    )
  }

  const handlePermissionsToggle = (checked: boolean) => {
    mutation.mutate(
      { key: SETTINGS_KEYS.SOUND_PERMISSIONS_ENABLED, value: checked },
      { onSuccess: () => toast.success(checked ? "Permissions sound enabled" : "Permissions sound disabled") }
    )
  }

  const handleErrorsToggle = (checked: boolean) => {
    mutation.mutate(
      { key: SETTINGS_KEYS.SOUND_ERRORS_ENABLED, value: checked },
      { onSuccess: () => toast.success(checked ? "Errors sound enabled" : "Errors sound disabled") }
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
    <Card>
      <CardHeader>
        <CardTitle>Sound Effects</CardTitle>
        <CardDescription>
          Configure notification sounds for different events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="sound-agent">Agent</Label>
            <p className="text-xs text-muted-foreground">
              Play sound when the agent completes or needs attention
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={agentEnabled ? agentSoundId : "none"}
              onValueChange={handleAgentSelect}
              disabled={mutation.isPending}
            >
              <SelectTrigger id="sound-agent" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {SOUND_CATEGORIES.map((cat) => (
                  <SelectGroup key={cat.key}>
                    <SelectLabel>{cat.label}</SelectLabel>
                    {SOUND_OPTIONS.filter((o) => o.category === cat.key).map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Switch
              checked={agentEnabled}
              onCheckedChange={handleAgentToggle}
              disabled={mutation.isPending}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="sound-permissions">Permissions</Label>
            <p className="text-xs text-muted-foreground">
              Play sound when a permission is required
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={permissionsEnabled ? permissionsSoundId : "none"}
              onValueChange={handlePermissionsSelect}
              disabled={mutation.isPending}
            >
              <SelectTrigger id="sound-permissions" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {SOUND_CATEGORIES.map((cat) => (
                  <SelectGroup key={cat.key}>
                    <SelectLabel>{cat.label}</SelectLabel>
                    {SOUND_OPTIONS.filter((o) => o.category === cat.key).map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Switch
              checked={permissionsEnabled}
              onCheckedChange={handlePermissionsToggle}
              disabled={mutation.isPending}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="sound-errors">Errors</Label>
            <p className="text-xs text-muted-foreground">
              Play sound when an error occurs
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select
              value={errorsEnabled ? errorsSoundId : "none"}
              onValueChange={handleErrorsSelect}
              disabled={mutation.isPending}
            >
              <SelectTrigger id="sound-errors" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {SOUND_CATEGORIES.map((cat) => (
                  <SelectGroup key={cat.key}>
                    <SelectLabel>{cat.label}</SelectLabel>
                    {SOUND_OPTIONS.filter((o) => o.category === cat.key).map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Switch
              checked={errorsEnabled}
              onCheckedChange={handleErrorsToggle}
              disabled={mutation.isPending}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
