"use client";

import { useState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  useFontSizeSetting,
  useMobileFontSizeSetting,
  useTabSizeSetting,
  useEditorTypeSetting,
  useNvimAppNameSetting,
  useShellRcPathSetting,
  useTerminalScrollbackSetting,
  useTerminalFontSetting,
  useSettingsMutation,
  useSoundSettings,
  useFileTabsSetting,
  useNotificationSettings,
  SETTINGS_KEYS,
  FONT_SIZE_OPTIONS,
  MOBILE_FONT_SIZE_OPTIONS,
  TAB_SIZE_OPTIONS,
  EDITOR_TYPE_OPTIONS,
  TERMINAL_SCROLLBACK_OPTIONS,
  TERMINAL_FONT_OPTIONS,
  DEFAULT_FONT_SIZE,
  DEFAULT_MOBILE_FONT_SIZE,
  DEFAULT_TAB_SIZE,
  DEFAULT_EDITOR_TYPE,
  DEFAULT_NVIM_APPNAME,
  DEFAULT_TERMINAL_SCROLLBACK,
  DEFAULT_TERMINAL_FONT,
  APP_THEMES,
} from "@/hooks/use-settings";
import type {
  FontSize,
  MobileFontSize,
  TabSize,
  EditorType,
  AppTheme,
  TerminalFont,
} from "@/hooks/use-settings";
import { useTheme } from "@/components/providers/theme-provider";
import { SOUND_OPTIONS, soundSrc, playSound } from "@/lib/sounds";

export function GeneralSettings() {
  return (
    <div className="space-y-6">
      <AppearanceSettingsCard />
      <EditorSettingsCard />
      <TerminalSettingsCard />
      <CommandSettingsCard />
      <NotificationSettingsCard />
      <SoundSettingsCard />
    </div>
  );
}

const THEME_SWATCHES: Record<AppTheme, { bg: string; accent: string }> = {
  system: {
    bg: "linear-gradient(135deg, #1e1e2e 50%, #eff1f5 50%)",
    accent: "#cba6f7",
  },
  "default-dark": { bg: "#1a1a1a", accent: "#a0a0a0" },
  "default-light": { bg: "#f5f5f5", accent: "#333333" },
  "catppuccin-latte": { bg: "#eff1f5", accent: "#8839ef" },
  "catppuccin-frappe": { bg: "#303446", accent: "#ca9ee6" },
  "catppuccin-macchiato": { bg: "#24273a", accent: "#c6a0f6" },
  "catppuccin-mocha": { bg: "#1e1e2e", accent: "#cba6f7" },
  dracula: { bg: "#282a36", accent: "#bd93f9" },
  "github-dark": { bg: "#0d1117", accent: "#58a6ff" },
};

function AppearanceSettingsCard() {
  const { theme: currentTheme, setTheme } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Choose your color theme</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {APP_THEMES.map((t) => {
            const isActive = currentTheme === t.value;
            const swatch = THEME_SWATCHES[t.value];
            return (
              <button
                key={t.value}
                data-testid={`theme-${t.value}`}
                onClick={() => setTheme(t.value)}
                className={`hover:bg-accent/50 flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors ${
                  isActive
                    ? "border-primary ring-primary/30 ring-2"
                    : "border-border"
                }`}
              >
                <div
                  className="border-border/50 h-10 w-full rounded-md border"
                  style={{ background: swatch.bg }}
                >
                  <div
                    className="mt-2 ml-2 h-3 w-3 rounded-full"
                    style={{ background: swatch.accent }}
                  />
                </div>
                <span className="max-w-full truncate font-medium">
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function EditorSettingsCard() {
  const { fontSize, isLoading: isLoadingFont } = useFontSizeSetting();
  const { mobileFontSize, isLoading: isLoadingMobileFont } =
    useMobileFontSizeSetting();
  const { tabSize, isLoading: isLoadingTab } = useTabSizeSetting();
  const { editorType, isLoading: isLoadingEditorType } = useEditorTypeSetting();
  const { nvimAppName, isLoading: isLoadingNvim } = useNvimAppNameSetting();
  const { isFileTabsDisabled, isLoading: isLoadingFileTabs } =
    useFileTabsSetting();
  const mutation = useSettingsMutation();
  const [customNvimAppName, setCustomNvimAppName] = useState("");

  const isLoading =
    isLoadingFont ||
    isLoadingMobileFont ||
    isLoadingTab ||
    isLoadingEditorType ||
    isLoadingNvim ||
    isLoadingFileTabs;

  // Sync custom nvim app name from server (during render)
  const [prevNvimAppName, setPrevNvimAppName] = useState(nvimAppName);
  if (prevNvimAppName !== nvimAppName && !isLoadingNvim) {
    setPrevNvimAppName(nvimAppName);
    if (nvimAppName !== "devhub" && nvimAppName !== "personal") {
      setCustomNvimAppName(nvimAppName);
    }
  }

  const editorTypeLabel = (type: EditorType): string => {
    if (type === "monaco") return "Monaco (VS Code)";
    if (type === "neovim") return "Neovim (terminal)";
    return type;
  };

  const handleEditorTypeChange = (value: string) => {
    const next = value as EditorType;
    mutation.mutate(
      { key: SETTINGS_KEYS.EDITOR_TYPE, value: next },
      {
        onSuccess: () =>
          toast.success(`Editor set to ${editorTypeLabel(next)}`),
      },
    );
  };

  const handleFontSizeChange = (value: string) => {
    const next = Number(value) as FontSize;
    mutation.mutate(
      { key: SETTINGS_KEYS.FONT_SIZE, value: next },
      { onSuccess: () => toast.success(`Font size set to ${next}px`) },
    );
  };

  const handleMobileFontSizeChange = (value: string) => {
    const next = Number(value) as MobileFontSize;
    mutation.mutate(
      { key: SETTINGS_KEYS.MOBILE_FONT_SIZE, value: next },
      { onSuccess: () => toast.success(`Mobile font size set to ${next}px`) },
    );
  };

  const handleTabSizeChange = (value: string) => {
    const next = Number(value) as TabSize;
    mutation.mutate(
      { key: SETTINGS_KEYS.TAB_SIZE, value: next },
      { onSuccess: () => toast.success(`Tab size set to ${next} spaces`) },
    );
  };

  const handleNvimAppNameChange = (value: string) => {
    if (value === "custom") return;
    mutation.mutate(
      { key: SETTINGS_KEYS.NVIM_APPNAME, value },
      {
        onSuccess: () =>
          toast.success(
            `Neovim config set to ${value === "devhub" ? "bundled (devhub)" : value === "personal" ? "personal (~/.config/nvim)" : value}`,
          ),
      },
    );
  };

  const handleFileTabsToggle = (checked: boolean) => {
    mutation.mutate(
      { key: SETTINGS_KEYS.DISABLE_FILE_TABS, value: checked },
      {
        onSuccess: () =>
          toast.success(checked ? "File tabs disabled" : "File tabs enabled"),
      },
    );
  };

  const handleCustomNvimAppNameSave = () => {
    if (!customNvimAppName.trim()) return;
    mutation.mutate(
      { key: SETTINGS_KEYS.NVIM_APPNAME, value: customNvimAppName.trim() },
      {
        onSuccess: () =>
          toast.success(`Neovim config set to ${customNvimAppName.trim()}`),
      },
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </CardContent>
      </Card>
    );
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
            <Label htmlFor="editor-type">Editor engine</Label>
            <p className="text-muted-foreground text-xs">
              Monaco (VS Code) or Neovim (terminal PTY)
            </p>
          </div>
          <Select
            value={editorType}
            onValueChange={handleEditorTypeChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="editor-type" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EDITOR_TYPE_OPTIONS.map((type) => (
                <SelectItem key={type} value={type}>
                  {editorTypeLabel(type)}
                  {type === DEFAULT_EDITOR_TYPE ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {editorType === "neovim" && (
          <div className="border-border/50 bg-muted/30 space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="nvim-appname">Neovim config</Label>
                <p className="text-muted-foreground text-xs">
                  Which neovim config to use (sets NVIM_APPNAME)
                </p>
              </div>
              <Select
                value={
                  nvimAppName === "devhub" || nvimAppName === "personal"
                    ? nvimAppName
                    : "custom"
                }
                onValueChange={handleNvimAppNameChange}
                disabled={mutation.isPending}
              >
                <SelectTrigger id="nvim-appname" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="devhub">
                    Bundled (devhub)
                    {nvimAppName === DEFAULT_NVIM_APPNAME ? " (default)" : ""}
                  </SelectItem>
                  <SelectItem value="personal">
                    Personal (~/.config/nvim)
                  </SelectItem>
                  <SelectItem value="custom">Custom NVIM_APPNAME</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {nvimAppName !== "devhub" && nvimAppName !== "personal" && (
              <div className="flex gap-2">
                <Input
                  id="nvim-appname-custom"
                  value={customNvimAppName}
                  onChange={(e) => setCustomNvimAppName(e.target.value)}
                  placeholder="e.g. astronvim"
                  className="text-sm"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleCustomNvimAppNameSave}
                  disabled={
                    !customNvimAppName.trim() ||
                    customNvimAppName.trim() === nvimAppName ||
                    mutation.isPending
                  }
                >
                  Save
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="font-size">Font size</Label>
            <p className="text-muted-foreground text-xs">
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
            <p className="text-muted-foreground text-xs">
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
                  {size}px
                  {size === DEFAULT_MOBILE_FONT_SIZE ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="tab-size">Tab size</Label>
            <p className="text-muted-foreground text-xs">
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

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="disable-file-tabs">Disable file tabs</Label>
            <p className="text-muted-foreground text-xs">
              Only show one file at a time with no tab bar
            </p>
          </div>
          <Switch
            id="disable-file-tabs"
            checked={isFileTabsDisabled}
            onCheckedChange={handleFileTabsToggle}
            disabled={mutation.isPending}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function TerminalSettingsCard() {
  const { scrollback, isLoading: isLoadingScrollback } =
    useTerminalScrollbackSetting();
  const { terminalFont, isLoading: isLoadingFont } = useTerminalFontSetting();
  const mutation = useSettingsMutation();

  const isLoading = isLoadingScrollback || isLoadingFont;

  const handleScrollbackChange = (value: string) => {
    const next = Number(value);
    mutation.mutate(
      { key: SETTINGS_KEYS.TERMINAL_SCROLLBACK, value: next },
      {
        onSuccess: () =>
          toast.success(
            `Terminal scrollback set to ${next.toLocaleString()} lines`,
          ),
      },
    );
  };

  const handleFontChange = (value: string) => {
    const next = value as TerminalFont;
    const label =
      TERMINAL_FONT_OPTIONS.find((o) => o.value === next)?.label ?? next;
    mutation.mutate(
      { key: SETTINGS_KEYS.TERMINAL_FONT, value: next },
      {
        onSuccess: () => toast.success(`Terminal font set to ${label}`),
      },
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Terminal</CardTitle>
        <CardDescription>Configure the embedded terminal.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="terminal-font">Font</Label>
            <p className="text-muted-foreground text-xs">
              Font family used in terminal and neovim editors
            </p>
          </div>
          <Select
            value={terminalFont}
            onValueChange={handleFontChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="terminal-font" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINAL_FONT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                  {opt.value === DEFAULT_TERMINAL_FONT ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="terminal-scrollback">Scrollback lines</Label>
            <p className="text-muted-foreground text-xs">
              Number of lines to keep in the terminal buffer
            </p>
          </div>
          <Select
            value={String(scrollback)}
            onValueChange={handleScrollbackChange}
            disabled={mutation.isPending}
          >
            <SelectTrigger id="terminal-scrollback" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERMINAL_SCROLLBACK_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size.toLocaleString()} lines
                  {size === DEFAULT_TERMINAL_SCROLLBACK ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function CommandSettingsCard() {
  const { shellRcPath, isLoading } = useShellRcPathSetting();
  const mutation = useSettingsMutation();
  const [localPath, setLocalPath] = useState("");

  // Sync local path from server data (during render)
  const [prevShellRcPath, setPrevShellRcPath] = useState(shellRcPath);
  if (prevShellRcPath !== shellRcPath && !isLoading) {
    setPrevShellRcPath(shellRcPath);
    setLocalPath(shellRcPath);
  }

  const handleSave = () => {
    mutation.mutate(
      { key: SETTINGS_KEYS.SHELL_RC_PATH, value: localPath },
      { onSuccess: () => toast.success("Shell RC path updated") },
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </CardContent>
      </Card>
    );
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
          <p className="text-muted-foreground text-xs">
            Path to your shell config file for alias parsing in command
            autocomplete
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
  );
}

function NotificationSettingsCard() {
  const { isSoundEnabled, isPushEnabled, isLoading } =
    useNotificationSettings();
  const mutation = useSettingsMutation();

  const handleSoundToggle = (checked: boolean) => {
    mutation.mutate(
      { key: SETTINGS_KEYS.NOTIFICATIONS_SOUND_ENABLED, value: checked },
      {
        onSuccess: () =>
          toast.success(
            checked
              ? "Notification sounds enabled"
              : "Notification sounds disabled",
          ),
      },
    );
  };

  const handlePushToggle = (checked: boolean) => {
    mutation.mutate(
      { key: SETTINGS_KEYS.NOTIFICATIONS_PUSH_ENABLED, value: checked },
      {
        onSuccess: () =>
          toast.success(
            checked
              ? "Push notifications enabled"
              : "Push notifications disabled",
          ),
      },
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Control notification sounds and browser push notifications.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="notifications-sound">Notification sounds</Label>
            <p className="text-muted-foreground text-xs">
              Play sound effects for agent events, permissions, and errors
            </p>
          </div>
          <Switch
            id="notifications-sound"
            checked={isSoundEnabled}
            onCheckedChange={handleSoundToggle}
            disabled={mutation.isPending}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="notifications-push">Push notifications</Label>
            <p className="text-muted-foreground text-xs">
              Show browser notifications when the tab is not focused
            </p>
          </div>
          <Switch
            id="notifications-push"
            checked={isPushEnabled}
            onCheckedChange={handlePushToggle}
            disabled={mutation.isPending}
          />
        </div>
      </CardContent>
    </Card>
  );
}

const SOUND_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "alerts", label: "Alerts" },
  { key: "bip-bops", label: "Bip Bops" },
  { key: "staplebops", label: "Staplebops" },
  { key: "nopes", label: "Nopes" },
  { key: "yups", label: "Yups" },
];

export function SoundSettingsCard() {
  const {
    agentEnabled,
    agentSoundId,
    permissionsEnabled,
    permissionsSoundId,
    errorsEnabled,
    errorsSoundId,
    isLoading,
  } = useSoundSettings();
  const mutation = useSettingsMutation();
  const previewCleanupRef = useRef<(() => void) | undefined>(undefined);

  const playPreview = (soundId: string) => {
    if (previewCleanupRef.current) {
      previewCleanupRef.current();
      previewCleanupRef.current = undefined;
    }
    setTimeout(() => {
      previewCleanupRef.current = playSound(soundSrc(soundId)) ?? undefined;
    }, 100);
  };

  const handleAgentSelect = (value: string) => {
    if (value === "none") {
      mutation.mutate(
        { key: SETTINGS_KEYS.SOUND_AGENT_ENABLED, value: false },
        { onSuccess: () => toast.success("Agent sound updated") },
      );
    } else {
      mutation.mutate({ key: SETTINGS_KEYS.SOUND_AGENT_ENABLED, value: true });
      mutation.mutate(
        { key: SETTINGS_KEYS.SOUND_AGENT_ID, value },
        { onSuccess: () => toast.success("Agent sound updated") },
      );
      playPreview(value);
    }
  };

  const handlePermissionsSelect = (value: string) => {
    if (value === "none") {
      mutation.mutate(
        { key: SETTINGS_KEYS.SOUND_PERMISSIONS_ENABLED, value: false },
        { onSuccess: () => toast.success("Permissions sound updated") },
      );
    } else {
      mutation.mutate({
        key: SETTINGS_KEYS.SOUND_PERMISSIONS_ENABLED,
        value: true,
      });
      mutation.mutate(
        { key: SETTINGS_KEYS.SOUND_PERMISSIONS_ID, value },
        { onSuccess: () => toast.success("Permissions sound updated") },
      );
      playPreview(value);
    }
  };

  const handleErrorsSelect = (value: string) => {
    if (value === "none") {
      mutation.mutate(
        { key: SETTINGS_KEYS.SOUND_ERRORS_ENABLED, value: false },
        { onSuccess: () => toast.success("Errors sound updated") },
      );
    } else {
      mutation.mutate({ key: SETTINGS_KEYS.SOUND_ERRORS_ENABLED, value: true });
      mutation.mutate(
        { key: SETTINGS_KEYS.SOUND_ERRORS_ID, value },
        { onSuccess: () => toast.success("Errors sound updated") },
      );
      playPreview(value);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </CardContent>
      </Card>
    );
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
            <p className="text-muted-foreground text-xs">
              Play sound when the agent completes or needs attention
            </p>
          </div>
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
                  {SOUND_OPTIONS.filter((o) => o.category === cat.key).map(
                    (o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ),
                  )}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="sound-permissions">Permissions</Label>
            <p className="text-muted-foreground text-xs">
              Play sound when a permission is required
            </p>
          </div>
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
                  {SOUND_OPTIONS.filter((o) => o.category === cat.key).map(
                    (o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ),
                  )}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="sound-errors">Errors</Label>
            <p className="text-muted-foreground text-xs">
              Play sound when an error occurs
            </p>
          </div>
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
                  {SOUND_OPTIONS.filter((o) => o.category === cat.key).map(
                    (o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ),
                  )}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
