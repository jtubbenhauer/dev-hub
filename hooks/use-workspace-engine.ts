"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import {
  DEFAULT_CHAT_ENGINE,
  SETTINGS_KEYS,
  useSettings,
} from "@/hooks/use-settings";
import { isChatEngine, type ChatEngine } from "@/lib/engine/types";

interface UseWorkspaceEngineResult {
  engine: ChatEngine;
  isLoading: boolean;
}

// Nested under ["workspaces"] so every existing workspace-list invalidation
// (workspace edits, engine changes) also refreshes the engine override.
export function workspaceEngineQueryKey(workspaceId: string | null) {
  return ["workspaces", workspaceId, "engine"] as const;
}

// Same precedence as the server's resolveWorkspaceEngine: an explicit
// workspace value wins (even an invalid one, which falls back to the
// default), then the global chat-engine setting, then the default.
export function resolveEffectiveEngine(
  workspaceEngine: unknown,
  globalEngine: unknown,
): ChatEngine {
  const selectedEngine = workspaceEngine ?? globalEngine ?? DEFAULT_CHAT_ENGINE;
  return isChatEngine(selectedEngine) ? selectedEngine : DEFAULT_CHAT_ENGINE;
}

function readWorkspaceEngineOverride(workspace: unknown): string | null {
  if (
    typeof workspace !== "object" ||
    workspace === null ||
    !("engine" in workspace)
  ) {
    return null;
  }
  return typeof workspace.engine === "string" ? workspace.engine : null;
}

async function fetchWorkspaceEngineOverride(
  workspaceId: string,
): Promise<string | null> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load workspace (${response.status})`);
  }
  const workspace: unknown = await response.json();
  return readWorkspaceEngineOverride(workspace);
}

export function useWorkspaceEngine(
  workspaceId: string | null,
): UseWorkspaceEngineResult {
  const { data: settings, isLoading: isSettingsLoading } = useSettings();
  const { data: workspaceEngineOverride, isLoading: isWorkspaceLoading } =
    useQuery({
      queryKey: workspaceEngineQueryKey(workspaceId),
      queryFn:
        workspaceId === null
          ? skipToken
          : () => fetchWorkspaceEngineOverride(workspaceId),
      staleTime: 60_000,
    });

  return {
    engine: resolveEffectiveEngine(
      workspaceEngineOverride,
      settings?.[SETTINGS_KEYS.CHAT_ENGINE],
    ),
    isLoading: isSettingsLoading || isWorkspaceLoading,
  };
}
