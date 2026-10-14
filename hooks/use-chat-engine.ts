"use client";

import {
  DEFAULT_CHAT_ENGINE,
  SETTINGS_KEYS,
  useSettings,
} from "@/hooks/use-settings";
import { isChatEngine, type ChatEngine } from "@/lib/engine/types";
import type { Workspace } from "@/types";

export const CHAT_ENGINE_LABELS: Record<ChatEngine, string> = {
  opencode: "OpenCode",
  omo: "OmO Native (omo)",
};

export function useChatEngineSetting(): {
  chatEngine: ChatEngine;
  isLoading: boolean;
} {
  const { data, isLoading } = useSettings();
  const raw = data?.[SETTINGS_KEYS.CHAT_ENGINE];
  return {
    chatEngine: isChatEngine(raw) ? raw : DEFAULT_CHAT_ENGINE,
    isLoading,
  };
}

// Mirrors resolveWorkspaceEngine: null inherits the global default, while an
// unrecognised stored value resolves to "opencode" regardless of the default.
export function getWorkspaceEngineOverride(
  workspace: Workspace,
): ChatEngine | null {
  const storedEngine = "engine" in workspace ? workspace.engine : null;
  if (storedEngine === null || storedEngine === undefined) return null;
  return isChatEngine(storedEngine) ? storedEngine : DEFAULT_CHAT_ENGINE;
}
