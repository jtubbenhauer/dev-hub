"use client";

import {
  DEFAULT_CHAT_ENGINE,
  SETTINGS_KEYS,
  useSettings,
} from "@/hooks/use-settings";
import { isChatEngine, type ChatEngine } from "@/lib/engine/types";
import { useChatStore } from "@/stores/chat-store";
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

async function purgeWorkspaceSessionCache(workspaceId: string): Promise<void> {
  const params = new URLSearchParams({ workspaceId });
  const response = await fetch(`/api/sessions/cache?${params}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Failed to clear cached sessions (${response.status})`);
  }
}

// Purges run before the resets so a refetch triggered by a reset cannot load
// cached sessions from the previous engine. Returns the ids whose purge failed.
export async function purgeAndResetWorkspaceChats(
  workspaceIds: readonly string[],
): Promise<string[]> {
  const purgeResults = await Promise.allSettled(
    workspaceIds.map(purgeWorkspaceSessionCache),
  );
  const { resetWorkspace } = useChatStore.getState();
  for (const workspaceId of workspaceIds) resetWorkspace(workspaceId);
  return workspaceIds.filter(
    (_, index) => purgeResults[index]?.status === "rejected",
  );
}
