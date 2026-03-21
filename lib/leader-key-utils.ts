import type {
  ActivationKeyConfig,
  ActivationKeyPreset,
} from "@/types/leader-key";
import { getIsMac } from "@/lib/utils";

export const DEFAULT_ACTIVATION_KEY: ActivationKeyConfig = {
  key: " ",
  ctrlKey: true,
};

export const ACTIVATION_KEY_PRESETS: ActivationKeyPreset[] = [
  { id: "ctrl+space", config: { key: " ", ctrlKey: true } },
  { id: "ctrl+.", config: { key: ".", ctrlKey: true } },
  { id: "ctrl+;", config: { key: ";", ctrlKey: true } },
  { id: "alt+space", config: { key: " ", altKey: true } },
  {
    id: "ctrl+shift+space",
    config: { key: " ", ctrlKey: true, shiftKey: true },
  },
];

const DISPLAY_KEY_NAMES: Record<string, string> = {
  " ": "Space",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Escape: "Esc",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

export function matchesActivationKey(
  e: KeyboardEvent,
  config: ActivationKeyConfig,
): boolean {
  if (e.key !== config.key) return false;
  if (!!config.ctrlKey !== e.ctrlKey) return false;
  if (!!config.altKey !== e.altKey) return false;
  if (!!config.shiftKey !== e.shiftKey) return false;
  if (!!config.metaKey !== e.metaKey) return false;
  return true;
}

export function formatActivationKey(
  config: ActivationKeyConfig,
  isMac?: boolean,
): string {
  const mac = isMac ?? getIsMac();
  const keyDisplay = DISPLAY_KEY_NAMES[config.key] ?? config.key.toUpperCase();

  if (mac) {
    const parts: string[] = [];
    if (config.ctrlKey) parts.push("⌃");
    if (config.altKey) parts.push("⌥");
    if (config.shiftKey) parts.push("⇧");
    if (config.metaKey) parts.push("⌘");
    parts.push(keyDisplay);
    return parts.join("");
  }

  const parts: string[] = [];
  if (config.ctrlKey) parts.push("Ctrl");
  if (config.altKey) parts.push("Alt");
  if (config.shiftKey) parts.push("Shift");
  if (config.metaKey) parts.push("Super");
  parts.push(keyDisplay);
  return parts.join("+");
}

export function isActivationKeyEqual(
  a: ActivationKeyConfig,
  b: ActivationKeyConfig,
): boolean {
  return (
    a.key === b.key &&
    !!a.ctrlKey === !!b.ctrlKey &&
    !!a.altKey === !!b.altKey &&
    !!a.shiftKey === !!b.shiftKey &&
    !!a.metaKey === !!b.metaKey
  );
}

export function findMatchingPresetId(
  config: ActivationKeyConfig,
): string | null {
  const match = ACTIVATION_KEY_PRESETS.find((p) =>
    isActivationKeyEqual(p.config, config),
  );
  return match?.id ?? null;
}

export function isValidActivationKeyConfig(
  value: unknown,
): value is ActivationKeyConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.key !== "string" || obj.key.length === 0) return false;
  const hasModifier =
    !!obj.ctrlKey || !!obj.altKey || !!obj.shiftKey || !!obj.metaKey;
  return hasModifier;
}
