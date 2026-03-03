"use client"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useEditorStore } from "@/stores/editor-store"
import {
  useVimModeSetting,
  useFontSizeSetting,
  useMobileFontSizeSetting,
  useTabSizeSetting,
  useShellRcPathSetting,
  useSettingsMutation,
  SETTINGS_KEYS,
  FONT_SIZE_OPTIONS,
  MOBILE_FONT_SIZE_OPTIONS,
  TAB_SIZE_OPTIONS,
  DEFAULT_FONT_SIZE,
  DEFAULT_MOBILE_FONT_SIZE,
  DEFAULT_TAB_SIZE,
} from "@/hooks/use-settings"
import type { FontSize, MobileFontSize, TabSize } from "@/hooks/use-settings"

export function GeneralSettings() {
  return (
    <div className="space-y-6">
      <EditorSettingsCard />
      <CommandSettingsCard />
    </div>
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
            <SelectTrigger id="font-size" className="w-24">
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
            <SelectTrigger id="mobile-font-size" className="w-24">
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
            <SelectTrigger id="tab-size" className="w-24">
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
