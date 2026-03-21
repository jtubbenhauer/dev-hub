"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, RotateCcw, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useLeaderKeyBindings,
  useLeaderWhichKeySetting,
  useLeaderTimeoutSetting,
  useLeaderActivationKey,
  useSettingsMutation,
  SETTINGS_KEYS,
  DEFAULT_LEADER_TIMEOUT,
} from "@/hooks/use-settings";
import {
  BUILTIN_ACTIONS,
  DEFAULT_LEADER_BINDINGS,
} from "@/lib/leader-key-defaults";
import {
  ACTIVATION_KEY_PRESETS,
  DEFAULT_ACTIVATION_KEY,
  formatActivationKey,
  findMatchingPresetId,
  isActivationKeyEqual,
  isValidActivationKeyConfig,
} from "@/lib/leader-key-utils";
import type {
  LeaderAction,
  LeaderBindingsMap,
  ActivationKeyConfig,
} from "@/types/leader-key";

const PAGE_LABELS: Record<string, string> = {
  global: "Global",
  chat: "Chat",
  files: "Files",
  git: "Git",
};

const PAGE_ORDER = ["global", "chat", "files", "git"];

export function KeybindingsSettings() {
  const { bindings, isLoading: isLoadingBindings } = useLeaderKeyBindings();
  const { isWhichKeyEnabled, isLoading: isLoadingWhichKey } =
    useLeaderWhichKeySetting();
  const { leaderTimeout, isLoading: isLoadingTimeout } =
    useLeaderTimeoutSetting();
  const { activationKey, isLoading: isLoadingActivationKey } =
    useLeaderActivationKey();
  const mutation = useSettingsMutation();

  const [localBindings, setLocalBindings] = useState<LeaderBindingsMap>({});
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [capturedKeys, setCapturedKeys] = useState<string>("");
  const [conflictActionId, setConflictActionId] = useState<string | null>(null);

  // Sync local bindings from server data (during render)
  const [prevBindings, setPrevBindings] = useState(bindings);
  if (prevBindings !== bindings && !isLoadingBindings) {
    setPrevBindings(bindings);
    setLocalBindings({ ...bindings });
  }

  const isLoading =
    isLoadingBindings ||
    isLoadingWhichKey ||
    isLoadingTimeout ||
    isLoadingActivationKey;
  const activationKeyDisplay = formatActivationKey(activationKey);

  const handleWhichKeyToggle = (checked: boolean) => {
    mutation.mutate(
      { key: SETTINGS_KEYS.LEADER_WHICH_KEY, value: checked },
      {
        onSuccess: () =>
          toast.success(
            checked ? "Which-key popup enabled" : "Which-key popup disabled",
          ),
      },
    );
  };

  const handleTimeoutChange = (value: string) => {
    const next = value === "never" ? null : Number(value);
    mutation.mutate(
      { key: SETTINGS_KEYS.LEADER_TIMEOUT, value: next },
      {
        onSuccess: () =>
          toast.success(
            next === null
              ? "Leader key will never auto-hide"
              : `Leader key timeout set to ${next}s`,
          ),
      },
    );
  };

  const startEditing = (actionId: string) => {
    setEditingActionId(actionId);
    setCapturedKeys("");
    setConflictActionId(null);
  };

  const cancelEditing = () => {
    setEditingActionId(null);
    setCapturedKeys("");
    setConflictActionId(null);
  };

  const findConflict = (actionId: string, keys: string): string | null => {
    if (!keys) return null;
    for (const [otherActionId, otherKeys] of Object.entries(localBindings)) {
      if (otherActionId === actionId) continue;
      if (otherKeys === keys) return otherActionId;
    }
    return null;
  };

  const saveBinding = (actionId: string, keys: string) => {
    const conflict = findConflict(actionId, keys);
    if (conflict) {
      setConflictActionId(conflict);
      return;
    }

    const next: LeaderBindingsMap = { ...localBindings, [actionId]: keys };
    setLocalBindings(next);
    setEditingActionId(null);
    setCapturedKeys("");
    setConflictActionId(null);

    // Persist only the overrides (keys that differ from defaults)
    const overrides: LeaderBindingsMap = {};
    for (const [id, binding] of Object.entries(next)) {
      if (binding !== DEFAULT_LEADER_BINDINGS[id]) {
        overrides[id] = binding;
      }
    }
    mutation.mutate(
      { key: SETTINGS_KEYS.LEADER_KEY_BINDINGS, value: overrides },
      { onSuccess: () => toast.success("Keybinding saved") },
    );
  };

  const resetBinding = (actionId: string) => {
    const defaultKeys = DEFAULT_LEADER_BINDINGS[actionId];
    if (!defaultKeys) return;

    const next: LeaderBindingsMap = {
      ...localBindings,
      [actionId]: defaultKeys,
    };
    setLocalBindings(next);

    const overrides: LeaderBindingsMap = {};
    for (const [id, binding] of Object.entries(next)) {
      if (binding !== DEFAULT_LEADER_BINDINGS[id]) {
        overrides[id] = binding;
      }
    }
    mutation.mutate(
      { key: SETTINGS_KEYS.LEADER_KEY_BINDINGS, value: overrides },
      { onSuccess: () => toast.success("Keybinding reset to default") },
    );
  };

  const resetAllBindings = () => {
    setLocalBindings({ ...DEFAULT_LEADER_BINDINGS });
    mutation.mutate(
      { key: SETTINGS_KEYS.LEADER_KEY_BINDINGS, value: {} },
      { onSuccess: () => toast.success("All keybindings reset to defaults") },
    );
  };

  const groupedActions = PAGE_ORDER.reduce<Record<string, LeaderAction[]>>(
    (acc, page) => {
      acc[page] = BUILTIN_ACTIONS.filter((a) => a.page === page);
      return acc;
    },
    {},
  );

  const handleActivationKeyPresetChange = (presetId: string) => {
    const preset = ACTIVATION_KEY_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    mutation.mutate(
      { key: SETTINGS_KEYS.LEADER_ACTIVATION_KEY, value: preset.config },
      {
        onSuccess: () =>
          toast.success(
            `Leader activation key set to ${formatActivationKey(preset.config)}`,
          ),
      },
    );
  };

  const handleCustomActivationKey = (config: ActivationKeyConfig) => {
    mutation.mutate(
      { key: SETTINGS_KEYS.LEADER_ACTIVATION_KEY, value: config },
      {
        onSuccess: () =>
          toast.success(
            `Leader activation key set to ${formatActivationKey(config)}`,
          ),
      },
    );
  };

  const resetActivationKey = () => {
    mutation.mutate(
      {
        key: SETTINGS_KEYS.LEADER_ACTIVATION_KEY,
        value: DEFAULT_ACTIVATION_KEY,
      },
      {
        onSuccess: () =>
          toast.success("Leader activation key reset to default"),
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
    <div className="space-y-6">
      <ActivationKeyCard
        activationKey={activationKey}
        onPresetChange={handleActivationKeyPresetChange}
        onCustomChange={handleCustomActivationKey}
        onReset={resetActivationKey}
        isSaving={mutation.isPending}
      />

      <Card>
        <CardHeader>
          <CardTitle>Which-key Popup</CardTitle>
          <CardDescription>
            Show a popup after pressing the leader key ({activationKeyDisplay})
            that lists available bindings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="which-key-toggle">Enable which-key popup</Label>
            <Switch
              id="which-key-toggle"
              checked={isWhichKeyEnabled}
              onCheckedChange={handleWhichKeyToggle}
              disabled={mutation.isPending}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="leader-timeout">Auto-hide timeout</Label>
              <p className="text-muted-foreground text-xs">
                How long the leader key popup stays visible before auto-closing
              </p>
            </div>
            <Select
              value={leaderTimeout === null ? "never" : String(leaderTimeout)}
              onValueChange={handleTimeoutChange}
              disabled={mutation.isPending}
            >
              <SelectTrigger id="leader-timeout" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 second</SelectItem>
                <SelectItem value="2">
                  2 seconds{DEFAULT_LEADER_TIMEOUT === 2 ? " (default)" : ""}
                </SelectItem>
                <SelectItem value="3">3 seconds</SelectItem>
                <SelectItem value="5">5 seconds</SelectItem>
                <SelectItem value="10">10 seconds</SelectItem>
                <SelectItem value="never">Never</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>Leader Key Bindings</CardTitle>
              <CardDescription>
                Customize the key sequences triggered after{" "}
                {activationKeyDisplay}. Click a row to edit.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground shrink-0"
              onClick={resetAllBindings}
              disabled={mutation.isPending}
            >
              <RotateCcw className="size-3.5" />
              Reset all
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {PAGE_ORDER.map((page, pageIndex) => (
            <div key={page}>
              {pageIndex > 0 && <Separator className="mb-6" />}
              <div className="space-y-1">
                <p className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
                  {PAGE_LABELS[page] ?? page}
                </p>
                {groupedActions[page]?.map((action) => (
                  <BindingRow
                    key={action.id}
                    action={action}
                    keys={localBindings[action.id] ?? ""}
                    defaultKeys={DEFAULT_LEADER_BINDINGS[action.id] ?? ""}
                    isEditing={editingActionId === action.id}
                    capturedKeys={capturedKeys}
                    conflictActionId={conflictActionId}
                    onStartEdit={() => startEditing(action.id)}
                    onCancelEdit={cancelEditing}
                    onSave={(keys) => saveBinding(action.id, keys)}
                    onReset={() => resetBinding(action.id)}
                    onKeyCapture={setCapturedKeys}
                    onConflictClear={() => setConflictActionId(null)}
                    isSaving={mutation.isPending}
                  />
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

interface ActivationKeyCardProps {
  activationKey: ActivationKeyConfig;
  onPresetChange: (presetId: string) => void;
  onCustomChange: (config: ActivationKeyConfig) => void;
  onReset: () => void;
  isSaving: boolean;
}

function ActivationKeyCard({
  activationKey,
  onPresetChange,
  onCustomChange,
  onReset,
  isSaving,
}: ActivationKeyCardProps) {
  const [isCapturingCustom, setIsCapturingCustom] = useState(false);
  const [customCapture, setCustomCapture] =
    useState<ActivationKeyConfig | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  const currentPresetId = findMatchingPresetId(activationKey);
  const isCustom = currentPresetId === null;
  const isModified = !isActivationKeyEqual(
    activationKey,
    DEFAULT_ACTIVATION_KEY,
  );

  useEffect(() => {
    if (isCapturingCustom) captureRef.current?.focus();
  }, [isCapturingCustom]);

  const handleSelectChange = (value: string) => {
    if (value === "custom") {
      setIsCapturingCustom(true);
      setCustomCapture(null);
      return;
    }
    setIsCapturingCustom(false);
    setCustomCapture(null);
    onPresetChange(value);
  };

  const handleCustomKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
    const hasModifier = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey;
    if (!hasModifier) return;
    const config: ActivationKeyConfig = { key: e.key };
    if (e.ctrlKey) config.ctrlKey = true;
    if (e.altKey) config.altKey = true;
    if (e.shiftKey) config.shiftKey = true;
    if (e.metaKey) config.metaKey = true;
    setCustomCapture(config);
  }, []);

  const confirmCustom = () => {
    if (!customCapture || !isValidActivationKeyConfig(customCapture)) return;
    onCustomChange(customCapture);
    setIsCapturingCustom(false);
    setCustomCapture(null);
  };

  const cancelCustom = () => {
    setIsCapturingCustom(false);
    setCustomCapture(null);
  };

  const selectValue = isCapturingCustom
    ? "custom"
    : (currentPresetId ?? "custom");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>Leader Activation Key</CardTitle>
            <CardDescription>
              The key combo that activates leader mode. Currently set to{" "}
              <Badge
                variant="outline"
                className="px-1.5 py-0 font-mono text-xs"
              >
                {formatActivationKey(activationKey)}
              </Badge>
            </CardDescription>
          </div>
          {isModified && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground shrink-0"
              onClick={onReset}
              disabled={isSaving}
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="activation-key-select">Activation combo</Label>
            <p className="text-muted-foreground text-xs">
              Choose a preset or define a custom combo
            </p>
          </div>
          <Select
            value={selectValue}
            onValueChange={handleSelectChange}
            disabled={isSaving}
          >
            <SelectTrigger id="activation-key-select" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIVATION_KEY_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {formatActivationKey(preset.config)}
                  {isActivationKeyEqual(preset.config, DEFAULT_ACTIVATION_KEY)
                    ? " (default)"
                    : ""}
                </SelectItem>
              ))}
              <SelectItem value="custom">Custom…</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isCapturingCustom && (
          <div className="bg-muted/30 flex items-center gap-3 rounded-md border p-3">
            <div
              ref={captureRef}
              tabIndex={0}
              onKeyDown={handleCustomKeyDown}
              className="border-ring bg-background focus:ring-ring flex min-w-32 cursor-text items-center gap-1 rounded border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none"
            >
              {customCapture ? (
                <Badge
                  variant="outline"
                  className="px-1.5 py-0 font-mono text-xs"
                >
                  {formatActivationKey(customCapture)}
                </Badge>
              ) : (
                <span className="text-muted-foreground italic">
                  press modifier + key…
                </span>
              )}
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={confirmCustom}
              disabled={!customCapture || isSaving}
              title="Confirm"
            >
              <Check className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={cancelCustom}
              title="Cancel"
            >
              <X className="size-4" />
            </Button>
          </div>
        )}

        {isCustom && !isCapturingCustom && (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <span>Custom combo:</span>
            <Badge variant="outline" className="px-1.5 py-0 font-mono text-xs">
              {formatActivationKey(activationKey)}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface BindingRowProps {
  action: LeaderAction;
  keys: string;
  defaultKeys: string;
  isEditing: boolean;
  capturedKeys: string;
  conflictActionId: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (keys: string) => void;
  onReset: () => void;
  onKeyCapture: (keys: string) => void;
  onConflictClear: () => void;
  isSaving: boolean;
}

function BindingRow({
  action,
  keys,
  defaultKeys,
  isEditing,
  capturedKeys,
  conflictActionId,
  onStartEdit,
  onCancelEdit,
  onSave,
  onReset,
  onKeyCapture,
  onConflictClear,
  isSaving,
}: BindingRowProps) {
  const captureRef = useRef<HTMLDivElement>(null);
  const isModified = keys !== defaultKeys;

  useEffect(() => {
    if (isEditing) {
      captureRef.current?.focus();
    }
  }, [isEditing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Ignore pure modifier keypresses
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;

      const parts: string[] = [];
      if (e.ctrlKey) parts.push("ctrl");
      if (e.altKey) parts.push("alt");
      if (e.shiftKey && e.key.length > 1) parts.push("shift");

      const key = e.key === " " ? "space" : e.key;
      parts.push(key);

      const chord = parts.join("+");
      const existing = capturedKeys ? `${capturedKeys} ${chord}` : chord;
      onKeyCapture(existing);
      onConflictClear();
    },
    [capturedKeys, onKeyCapture, onConflictClear],
  );

  const conflictLabel = conflictActionId
    ? (BUILTIN_ACTIONS.find((a) => a.id === conflictActionId)?.label ??
      conflictActionId)
    : null;

  return (
    <div className="group hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors">
      <span className="flex-1 text-sm">{action.label}</span>

      {isEditing ? (
        <div className="flex items-center gap-2">
          <div
            ref={captureRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="border-ring bg-background flex min-w-24 cursor-text items-center gap-1 rounded border px-2 py-1 text-xs focus:outline-none"
          >
            {capturedKeys ? (
              capturedKeys
                .split(" ")
                .map((chord, i) => <KeyChip key={i} chord={chord} />)
            ) : (
              <span className="text-muted-foreground italic">press keys…</span>
            )}
          </div>

          {conflictLabel && (
            <span className="text-destructive text-xs">
              conflicts with &quot;{conflictLabel}&quot;
            </span>
          )}

          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={() => onSave(capturedKeys)}
            disabled={!capturedKeys || isSaving}
            title="Confirm"
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={onCancelEdit}
            title="Cancel"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {keys ? (
              keys
                .split(" ")
                .map((chord, i) => <KeyChip key={i} chord={chord} />)
            ) : (
              <span className="text-muted-foreground text-xs italic">
                unbound
              </span>
            )}
          </div>

          <Button
            size="icon"
            variant="ghost"
            className="size-6 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={onStartEdit}
            title="Edit binding"
          >
            <Pencil className="size-3" />
          </Button>

          {isModified && (
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground size-6 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={onReset}
              disabled={isSaving}
              title="Reset to default"
            >
              <RotateCcw className="size-3" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function KeyChip({ chord }: { chord: string }) {
  return (
    <Badge variant="outline" className="px-1.5 py-0 font-mono text-xs">
      {chord}
    </Badge>
  );
}
